import express from 'express';
import cors from 'cors';
import fs from 'fs';
import helmet from 'helmet';
import path from 'path';
import crypto from 'crypto';
import pino from 'pino';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import { hash, Algorithm } from '@node-rs/argon2';
import { initializeDatabase } from './db/knex';
import db from './db/knex';
import { createSessionConfig, ARGON2_OPTIONS } from './auth/config';
import { resolveSessionSecret } from './auth/sessionSecret';
import { requireAuth, requireCompletedSetup, csrfProtection } from './auth/middleware';
import { generateBootstrapPassword } from './routes/auth';

dotenv.config();

// Set restrictive umask for file creation
process.umask(0o077);

const logger = process.env.NODE_ENV === 'production'
  ? pino()
  : pino({
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    });

const sessionSecret = resolveSessionSecret();
if (sessionSecret.source !== 'env') {
  logger.warn(
    { source: sessionSecret.source, filePath: sessionSecret.filePath },
    'Using persisted session secret because SESSION_SECRET is not set explicitly'
  );
}

if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGIN) {
  logger.warn(
    'ALLOWED_ORIGIN is not set. CSRF origin validation will derive from the Host header, ' +
    'which may be unreliable behind misconfigured proxies. Set ALLOWED_ORIGIN to your public URL.'
  );
}

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy configuration
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy === '1' || trustProxy === 'true') {
  app.set('trust proxy', 1);
} else if (trustProxy) {
  app.set('trust proxy', trustProxy);
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      scriptSrc: ["'self'", "'unsafe-eval'"], // Required: PDF.js and Excalidraw both use new Function()
      workerSrc: ["'self'", "blob:"], // Required for PDF.js web worker
      connectSrc: ["'self'"],
    },
  },
}));
if (process.env.NODE_ENV !== 'production') {
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Import routes
import documentsRouter from './routes/documents';
import annotationsRouter from './routes/annotations';
import authRouter, { initAuth } from './routes/auth';

// Health check endpoint (no auth required)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function startServer(): Promise<void> {
  await initializeDatabase();

  // Initialize auth module (generates real dummy hash for timing-safe comparisons)
  await initAuth();

  // Set up session middleware — requires DB to be initialized first
  const sqliteClient = await db.client.acquireRawConnection();
  const sessionConfig = createSessionConfig(sqliteClient);
  app.use(session(sessionConfig));

  // Prevent caching of authenticated API responses
  app.use('/api/', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // CSRF protection (after session, before routes)
  app.use('/api/', csrfProtection);

  // Auth routes (some are public, some are protected internally)
  app.use('/api/auth', authRouter);

  // Protected API routes
  app.use('/api/documents', requireAuth, requireCompletedSetup, documentsRouter);
  app.use('/api/documents', requireAuth, requireCompletedSetup, annotationsRouter);

  // In production, serve the frontend build
  if (process.env.NODE_ENV === 'production') {
    const frontendPath = path.join(__dirname, '../../frontend/dist');
    app.use(express.static(frontendPath));

    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(frontendPath, 'index.html'));
    });
  }

  // Catch-all 404 for unmatched API routes
  app.use('/api/', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handling middleware
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // First-run bootstrap: create default admin if no users exist
  await bootstrapFirstRun();

  app.listen(PORT, () => {
    logger.info(
      {
        port: PORT,
        sessionSecretSource: sessionSecret.source,
      },
      'Server running'
    );
  });
}

async function bootstrapFirstRun(): Promise<void> {
  const userCount = await db('users').count('* as count').first();
  const count = Number(userCount?.count || 0);

  if (count > 0) return;

  // Create default admin account — user must change credentials on first login
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || generateBootstrapPassword();
  const passwordHash = await hash(bootstrapPassword, {
    ...ARGON2_OPTIONS,
    algorithm: Algorithm.Argon2id,
  });

  await db('users').insert({
    id,
    email: 'admin@graphite.local',
    password_hash: passwordHash,
    display_name: 'Admin',
    role: 'admin',
    must_change_password: true,
    failed_login_attempts: 0,
    locked_until: null,
    password_changed_at: now,
    created_at: now,
    updated_at: now,
  });

  // Assign any orphaned documents to the new admin user
  const orphanedCount = await db('documents').whereNull('user_id').update({ user_id: id });
  if (orphanedCount > 0) {
    logger.info({ count: orphanedCount }, 'Assigned orphaned documents to admin user');
  }

  const DATA_DIR = process.env.DATA_DIR || './data';
  const credentialsPath = path.join(DATA_DIR, 'initial-admin-credentials.txt');
  fs.writeFileSync(credentialsPath, [
    'Graphite Initial Admin Credentials',
    '===================================',
    `Email:    admin@graphite.local`,
    `Password: ${bootstrapPassword}`,
    '',
    'Change these credentials on first login.',
    'Delete this file after noting the password.',
    '',
  ].join('\n'), { mode: 0o600 });

  logger.info('='.repeat(60));
  logger.info('Default admin account created: admin@graphite.local');
  logger.info(`Credentials written to: ${credentialsPath}`);
  logger.info('You will be required to change these on first login.');
  logger.info('='.repeat(60));
}

startServer().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
