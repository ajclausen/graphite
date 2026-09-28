import type { SessionOptions } from 'express-session';
import session from 'express-session';
import BetterSqlite3SessionStore from 'better-sqlite3-session-store';
import type BetterSqlite3 from 'better-sqlite3';
import { resolveSessionSecret } from './sessionSecret';

const SqliteStore = BetterSqlite3SessionStore(session);

export type CookieSecureMode = 'auto' | 'true' | 'false';

/**
 * Resolves COOKIE_SECURE:
 *   auto  (default) Secure on HTTPS requests only. Behind a TLS-terminating
 *                   proxy this relies on TRUST_PROXY so X-Forwarded-Proto counts.
 *   true            Always Secure. Sign-in will not work over plain HTTP.
 *   false           Never Secure. Only for HTTP-only setups that must not
 *                   depend on request detection.
 */
export function resolveCookieSecureMode(value = process.env.COOKIE_SECURE): CookieSecureMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'auto') return 'auto';
  if (normalized === 'true' || normalized === '1') return 'true';
  if (normalized === 'false' || normalized === '0') return 'false';
  throw new Error(`COOKIE_SECURE must be "auto", "true" or "false" (got "${value}")`);
}

function toCookieSecure(mode: CookieSecureMode): boolean | 'auto' {
  if (mode === 'true') return true;
  if (mode === 'false') return false;
  return 'auto';
}

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
      // 'auto' (the default) marks the cookie Secure only on HTTPS requests,
      // so plain-HTTP self-hosting (localhost, LAN IP) can sign in while
      // HTTPS deployments still get Secure cookies. A hard `true` here made
      // express-session drop the cookie entirely over HTTP.
      secure: toCookieSecure(resolveCookieSecureMode()),
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
