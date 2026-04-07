import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { z } from 'zod';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import rateLimit from 'express-rate-limit';
import db from '../db/knex';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { ARGON2_OPTIONS, LOCKOUT_THRESHOLDS } from '../auth/config';
import { toUserInfo } from '../auth/types';
import type { UserRow } from '../auth/types';

const router = express.Router();
const logger = pino({ name: 'auth' });

// ─── Rate limiters ───────────────────────────────────────────────────────────

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: false,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});


// ─── Validation schemas ──────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});


const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'Password must be at least 12 characters').max(128, 'Password must be at most 128 characters'),
  newEmail: z.string().email().optional(),
  newDisplayName: z.string().max(200).optional(),
});


const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Password must be at least 12 characters').max(128, 'Password must be at most 128 characters'),
  displayName: z.string().max(200).optional(),
  role: z.enum(['admin', 'user']).optional(),
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  displayName: z.string().max(200).nullable().optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ARGON2_FULL_OPTIONS = { ...ARGON2_OPTIONS, algorithm: Algorithm.Argon2id };

/**
 * Pre-computed dummy hash for timing-safe comparison when user is not found.
 * Initialized at startup with a real Argon2id hash so verification timing
 * is identical to a real password check, fully preventing user enumeration.
 */
let DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dW5rbm93bnNhbHQ$dW5rbm93bmhhc2g';

export async function initAuth(): Promise<void> {
  DUMMY_HASH = await hash('not-a-real-password', ARGON2_FULL_OPTIONS);
}

async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_FULL_OPTIONS);
}

async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  return verify(storedHash, password);
}

function regenerateSession(req: express.Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function destroySession(req: express.Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getLockoutDelay(attempts: number): number {
  let delay = 0;
  for (const threshold of LOCKOUT_THRESHOLDS) {
    if (attempts >= threshold.attempts) {
      delay = threshold.delayMs;
    }
  }
  return delay;
}

export function generateBootstrapPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}

function cleanupBootstrapCredentialsFile(): void {
  const dataDir = process.env.DATA_DIR || './data';
  const credentialsPath = path.join(dataDir, 'initial-admin-credentials.txt');

  try {
    fs.unlinkSync(credentialsPath);
    logger.info({ credentialsPath }, 'Removed bootstrap credentials file after initial password change');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      logger.warn({ err, credentialsPath }, 'Failed to remove bootstrap credentials file');
    }
  }
}

// ─── Public routes ───────────────────────────────────────────────────────────

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid email or password format' });
      return;
    }

    const { email, password } = parsed.data;
    const user = await db('users').where({ email: email.toLowerCase() }).first() as UserRow | undefined;

    if (!user) {
      // Timing-safe: still verify against dummy hash
      await verifyPassword(DUMMY_HASH, password).catch(() => {});
      logger.info({ email: email.toLowerCase() }, 'Login failed: user not found');
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Check lockout
    if (user.locked_until) {
      const lockedUntil = new Date(user.locked_until).getTime();
      const remaining = lockedUntil - Date.now();
      if (remaining > 0) {
        logger.info({ userId: user.id }, 'Login blocked: account locked');
        res.status(429).json({
          error: 'Account temporarily locked',
          retryAfterMs: remaining,
        });
        return;
      }
    }

    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) {
      const newAttempts = user.failed_login_attempts + 1;
      const lockDelay = getLockoutDelay(newAttempts);
      const lockUntil = lockDelay > 0
        ? new Date(Date.now() + lockDelay).toISOString()
        : null;

      await db('users').where({ id: user.id }).update({
        failed_login_attempts: newAttempts,
        locked_until: lockUntil,
        updated_at: new Date().toISOString(),
      });

      logger.info({ userId: user.id, attempts: newAttempts }, 'Login failed: wrong password');
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Success — reset lockout state
    await db('users').where({ id: user.id }).update({
      failed_login_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    });

    // Regenerate session to prevent fixation
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.createdAt = Date.now();
    req.session.passwordChangedAt = user.password_changed_at;

    logger.info({ userId: user.id }, 'Login successful');
    res.json({ user: toUserInfo(user) });
  } catch (err) {
    logger.error(err, 'Login error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    await destroySession(req);
    res.clearCookie('graphite.sid', { path: '/' });
    if (userId) {
      logger.info({ userId }, 'Logout successful');
    }
    res.json({ status: 'ok' });
  } catch (err) {
    logger.error(err, 'Logout error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res): Promise<void> => {
  res.json({ user: toUserInfo(req.user!) });
});


// ─── Authenticated routes ────────────────────────────────────────────────────

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res): Promise<void> => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      res.status(400).json({ error: firstError?.message || 'Invalid input' });
      return;
    }

    const { currentPassword, newPassword, newEmail, newDisplayName } = parsed.data;
    const user = req.user!;
    const wasForcedReset = Boolean(user.must_change_password);

    const valid = await verifyPassword(user.password_hash, currentPassword);
    if (!valid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    // If changing email, check uniqueness
    if (newEmail) {
      const normalizedEmail = newEmail.toLowerCase();
      const existing = await db('users')
        .where({ email: normalizedEmail })
        .whereNot({ id: user.id })
        .first();
      if (existing) {
        res.status(409).json({ error: 'Email already in use' });
        return;
      }
    }

    const now = new Date().toISOString();
    const newHash = await hashPassword(newPassword);

    const updates: Record<string, unknown> = {
      password_hash: newHash,
      password_changed_at: now,
      must_change_password: false,
      updated_at: now,
    };
    if (newEmail) updates.email = newEmail.toLowerCase();
    if (newDisplayName !== undefined) updates.display_name = newDisplayName || null;

    await db('users').where({ id: user.id }).update(updates);

    // Destroy all other sessions for this user
    const currentSid = req.sessionID;
    const allSessions = await db('sessions').select('sid', 'sess') as Array<{ sid: string; sess: string }>;

    for (const row of allSessions) {
      if (row.sid === currentSid) continue;
      try {
        const sessData = JSON.parse(row.sess);
        if (sessData.userId === user.id) {
          await db('sessions').where({ sid: row.sid }).del();
        }
      } catch (_) { /* skip malformed session */ }
    }

    // Regenerate current session with updated timestamp
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.createdAt = Date.now();
    req.session.passwordChangedAt = now;

    if (wasForcedReset) {
      cleanupBootstrapCredentialsFile();
    }

    const updatedUser = await db('users').where({ id: user.id }).first() as UserRow;
    logger.info({ userId: user.id }, 'Password changed');
    res.json({ user: toUserInfo(updatedUser) });
  } catch (err) {
    logger.error(err, 'Change password error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin routes ────────────────────────────────────────────────────────────

// GET /api/auth/admin/users
router.get('/admin/users', requireAdmin, async (_req, res): Promise<void> => {
  try {
    const users = await db('users')
      .select('*')
      .orderBy('created_at', 'asc') as UserRow[];

    res.json(users.map((u) => toUserInfo(u)));
  } catch (err) {
    logger.error(err, 'List users error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/admin/users
router.post('/admin/users', requireAdmin, async (req, res): Promise<void> => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      res.status(400).json({ error: firstError?.message || 'Invalid input' });
      return;
    }

    const { email, password, displayName, role } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const existing = await db('users').where({ email: normalizedEmail }).first();
    if (existing) {
      res.status(409).json({ error: 'A user with this email already exists' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(password);

    await db('users').insert({
      id,
      email: normalizedEmail,
      password_hash: passwordHash,
      display_name: displayName || null,
      role: role || 'user',
      must_change_password: true,
      failed_login_attempts: 0,
      locked_until: null,
      password_changed_at: now,
      created_at: now,
      updated_at: now,
    });

    const user = await db('users').where({ id }).first() as UserRow;
    logger.info({ userId: id, adminId: req.user!.id }, 'Admin created user');
    res.status(201).json({ user: toUserInfo(user) });
  } catch (err) {
    logger.error(err, 'Create user error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/auth/admin/users/:id
router.patch('/admin/users/:id', requireAdmin, async (req, res): Promise<void> => {
  try {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      res.status(400).json({ error: firstError?.message || 'Invalid input' });
      return;
    }

    const targetId = req.params.id;

    // Prevent admins from changing their own role
    if (parsed.data.role !== undefined && targetId === req.user!.id) {
      res.status(400).json({ error: 'Cannot change your own role' });
      return;
    }

    const user = await db('users').where({ id: targetId }).first();
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Ensure at least one admin remains when demoting an admin
    if (parsed.data.role !== undefined && parsed.data.role !== 'admin' && user.role === 'admin') {
      const adminCount = await db('users').where({ role: 'admin' }).count('* as count').first();
      if (Number(adminCount?.count || 0) <= 1) {
        res.status(400).json({ error: 'Cannot remove the last admin' });
        return;
      }
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.role !== undefined) updates.role = parsed.data.role;
    if (parsed.data.displayName !== undefined) updates.display_name = parsed.data.displayName;

    await db('users').where({ id: targetId }).update(updates);
    const updated = await db('users').where({ id: targetId }).first() as UserRow;

    logger.info({ targetId, adminId: req.user!.id }, 'Admin updated user');
    res.json({ user: toUserInfo(updated) });
  } catch (err) {
    logger.error(err, 'Update user error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/auth/admin/users/:id
router.delete('/admin/users/:id', requireAdmin, async (req, res): Promise<void> => {
  try {
    const targetId = req.params.id;

    if (targetId === req.user!.id) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }

    const user = await db('users').where({ id: targetId }).first();
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await db('users').where({ id: targetId }).del();

    // Destroy all sessions for deleted user
    const allSessions = await db('sessions').select('sid', 'sess') as Array<{ sid: string; sess: string }>;

    for (const row of allSessions) {
      try {
        const sessData = JSON.parse(row.sess);
        if (sessData.userId === targetId) {
          await db('sessions').where({ sid: row.sid }).del();
        }
      } catch (_) { /* skip malformed session */ }
    }

    logger.info({ targetId, adminId: req.user!.id }, 'Admin deleted user');
    res.status(204).send();
  } catch (err) {
    logger.error(err, 'Delete user error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/admin/users/:id/reset-password
router.post('/admin/users/:id/reset-password', requireAdmin, async (req, res): Promise<void> => {
  try {
    const targetId = req.params.id;
    const parsed = z.object({
      password: z.string().min(12, 'Password must be at least 12 characters').max(128, 'Password must be at most 128 characters'),
    }).safeParse(req.body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      res.status(400).json({ error: firstError?.message || 'Invalid input' });
      return;
    }

    const { password } = parsed.data;

    const user = await db('users').where({ id: targetId }).first();
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const now = new Date().toISOString();
    const passwordHash = await hashPassword(password);

    await db('users').where({ id: targetId }).update({
      password_hash: passwordHash,
      password_changed_at: now,
      must_change_password: true,
      updated_at: now,
    });

    // Destroy all sessions for this user
    const allSessions = await db('sessions').select('sid', 'sess') as Array<{ sid: string; sess: string }>;

    for (const row of allSessions) {
      try {
        const sessData = JSON.parse(row.sess);
        if (sessData.userId === targetId) {
          await db('sessions').where({ sid: row.sid }).del();
        }
      } catch (_) { /* skip malformed session */ }
    }

    logger.info({ targetId, adminId: req.user!.id }, 'Admin reset user password');
    res.json({ status: 'ok' });
  } catch (err) {
    logger.error(err, 'Reset password error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
