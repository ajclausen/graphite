import type { SessionOptions } from 'express-session';
import session from 'express-session';
import BetterSqlite3SessionStore from 'better-sqlite3-session-store';
import type BetterSqlite3 from 'better-sqlite3';
import { resolveSessionSecret } from './sessionSecret';

const SqliteStore = BetterSqlite3SessionStore(session);

export function createSessionConfig(sqliteClient: BetterSqlite3.Database): SessionOptions {
  const { secret } = resolveSessionSecret();

  return {
    secret,
    name: 'graphite.sid',
    resave: false,
    saveUninitialized: false,
    store: new SqliteStore({
      client: sqliteClient,
      expired: {
        clear: true,
        intervalMs: 15 * 60 * 1000, // Clean up every 15 minutes
      },
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    },
  };
}

/** Argon2id hashing parameters (OWASP recommended) */
export const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/** Session absolute timeout in milliseconds (24 hours) */
export const SESSION_ABSOLUTE_TIMEOUT = 24 * 60 * 60 * 1000;

/** Progressive lockout thresholds */
export const LOCKOUT_THRESHOLDS = [
  { attempts: 3, delayMs: 30 * 1000 },       // 30 seconds
  { attempts: 5, delayMs: 5 * 60 * 1000 },   // 5 minutes
  { attempts: 10, delayMs: 30 * 60 * 1000 },  // 30 minutes
] as const;
