import type { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import db from '../db/knex';
import { SESSION_ABSOLUTE_TIMEOUT } from './config';
import type { UserRow } from './types';

const logger = pino({ name: 'auth-middleware' });

/**
 * Requires a valid authenticated session.
 * Attaches `req.user` on success.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Absolute session timeout
    const sessionCreatedAt = req.session.createdAt;
    if (!sessionCreatedAt || Date.now() - sessionCreatedAt > SESSION_ABSOLUTE_TIMEOUT) {
      logger.info({ userId }, 'Session expired (absolute timeout)');
      req.session.destroy((err) => { if (err) logger.warn({ err }, 'Failed to destroy session'); });
      res.status(401).json({ error: 'Session expired' });
      return;
    }

    // Look up the user
    const user = await db('users').where({ id: userId }).first() as UserRow | undefined;
    if (!user) {
      logger.warn({ userId }, 'Session references nonexistent user');
      req.session.destroy((err) => { if (err) logger.warn({ err }, 'Failed to destroy session'); });
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Invalidate session if password was changed after session creation
    if (
      user.password_changed_at &&
      req.session.passwordChangedAt !== user.password_changed_at
    ) {
      logger.info({ userId }, 'Session invalidated due to password change');
      req.session.destroy((err) => { if (err) logger.warn({ err }, 'Failed to destroy session'); });
      res.status(401).json({ error: 'Session expired' });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    logger.error(err, 'Auth middleware error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Requires admin role. Must be used after requireAuth.
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuth(req, res, () => {
    if (req.user?.must_change_password) {
      res.status(403).json({ error: 'Password change required before accessing this resource' });
      return;
    }
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  });
}

/**
 * Blocks access to application features until the user completes initial
 * password/account setup.
 */
export function requireCompletedSetup(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.user?.must_change_password) {
    res.status(403).json({ error: 'Password change required before accessing this resource' });
    return;
  }

  next();
}

/**
 * CSRF protection for state-changing requests.
 * Validates Origin header against the expected origin. When Origin is absent,
 * falls back to checking the Referer header. Rejects requests that provide
 * neither header to defend against cross-origin form submissions.
 */
export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Skip safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  const expectedOrigin = getExpectedOrigin(req);
  const origin = req.get('Origin');

  // Primary check: validate Origin header when present
  if (origin) {
    if (origin !== expectedOrigin) {
      logger.warn({ origin, expectedOrigin }, 'CSRF origin mismatch');
      res.status(403).json({ error: 'Origin mismatch' });
      return;
    }
    next();
    return;
  }

  // Fallback: validate Referer header when Origin is absent
  const referer = req.get('Referer');
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (refererOrigin !== expectedOrigin) {
        logger.warn({ refererOrigin, expectedOrigin }, 'CSRF referer mismatch');
        res.status(403).json({ error: 'Origin mismatch' });
        return;
      }
      next();
      return;
    } catch {
      logger.warn({ referer }, 'CSRF malformed Referer header');
      res.status(403).json({ error: 'Invalid Referer header' });
      return;
    }
  }

  // Neither Origin nor Referer present — reject the request
  logger.warn(
    { method: req.method, path: req.path },
    'CSRF rejected: missing Origin and Referer headers',
  );
  res.status(403).json({ error: 'Missing Origin or Referer header' });
}

/**
 * Determines the expected origin for CSRF validation.
 * In production, uses ALLOWED_ORIGIN env var if set (hardened against Host
 * header manipulation), otherwise derives from the request.
 * In development, uses FRONTEND_URL env var or defaults to localhost:5173.
 */
function getExpectedOrigin(req: Request): string {
  if (process.env.NODE_ENV === 'production') {
    return process.env.ALLOWED_ORIGIN || `${req.protocol}://${req.get('host')}`;
  }
  return process.env.FRONTEND_URL || 'http://localhost:5173';
}
