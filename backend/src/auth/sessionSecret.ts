import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

const logger = pino({ name: 'session-secret' });

const MIN_SECRET_LENGTH = 32;

export interface ResolvedSessionSecret {
  secret: string;
  source: 'env' | 'file' | 'generated';
  filePath: string;
}

function getSecretFilePath(): string {
  const dataDir = process.env.DATA_DIR || './data';
  return process.env.SESSION_SECRET_FILE || path.join(dataDir, 'session-secret');
}

function validateSecret(secret: string | undefined | null): string | null {
  const normalized = secret?.trim();
  if (!normalized) return null;
  if (normalized.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters long`);
  }
  return normalized;
}

const KNOWN_WEAK_SECRETS = [
  'dev-only-secret-do-not-use-in-production-change-me',
];

export function resolveSessionSecret(): ResolvedSessionSecret {
  const filePath = getSecretFilePath();
  let result: ResolvedSessionSecret;

  const envSecret = validateSecret(process.env.SESSION_SECRET);
  if (envSecret) {
    result = { secret: envSecret, source: 'env', filePath };
  } else if (fs.existsSync(filePath)) {
    const fileSecret = validateSecret(fs.readFileSync(filePath, 'utf8'));
    if (!fileSecret) {
      throw new Error(`Session secret file exists but is empty: ${filePath}`);
    }

    process.env.SESSION_SECRET = fileSecret;
    result = { secret: fileSecret, source: 'file', filePath };
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const generatedSecret = crypto.randomBytes(48).toString('base64');
    fs.writeFileSync(filePath, `${generatedSecret}\n`, { mode: 0o600 });

    process.env.SESSION_SECRET = generatedSecret;
    logger.warn({ filePath }, 'SESSION_SECRET not set; generated and persisted one-time secret');

    result = { secret: generatedSecret, source: 'generated', filePath };
  }

  if (process.env.NODE_ENV === 'production' && KNOWN_WEAK_SECRETS.includes(result.secret)) {
    throw new Error(
      'Refusing to start: SESSION_SECRET is a known-weak development value. ' +
      'Generate a strong secret with: openssl rand -base64 32'
    );
  }

  return result;
}
