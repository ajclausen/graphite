import fs from 'fs';
import path from 'path';
import pino from 'pino';
import type { Knex } from 'knex';

const logger = pino({ name: 'document-storage' });

export const DATA_DIR = process.env.DATA_DIR || './data';
export const FILES_DIR = path.join(DATA_DIR, 'pdfs');
export const THUMBNAIL_DIR = path.join(DATA_DIR, 'thumbnails');

fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

export function resolveWithin(baseDir: string, relativePath: string): string | null {
  const basePath = path.resolve(baseDir);
  const resolved = path.resolve(basePath, relativePath);
  if (!resolved.startsWith(`${basePath}${path.sep}`) && resolved !== basePath) {
    return null;
  }
  return resolved;
}

/**
 * Safely remove a file, logging but not throwing on failure.
 */
export function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to clean up file');
  }
}

interface StoredDocument {
  id: string;
  file_path: string;
  thumbnail_path: string | null;
}

/**
 * Resolves a document's on-disk file and thumbnail paths, refusing any path
 * that escapes the storage directories. Returns null if either path is unsafe.
 */
export function resolveDocumentFiles(doc: StoredDocument): string[] | null {
  const files: string[] = [];

  const filePath = resolveWithin(DATA_DIR, doc.file_path);
  if (!filePath) return null;
  files.push(filePath);

  if (doc.thumbnail_path) {
    const thumbPath = resolveWithin(THUMBNAIL_DIR, path.basename(doc.thumbnail_path));
    if (!thumbPath) return null;
    files.push(thumbPath);
  }

  return files;
}

/**
 * Deletes document rows (matched by id or owner) and their annotations.
 * Annotations are removed explicitly because SQLite only honours
 * ON DELETE CASCADE when the foreign_keys pragma is enabled, which this
 * database does not do.
 */
export async function deleteDocumentRows(
  trx: Knex | Knex.Transaction,
  match: { id: string } | { user_id: string },
): Promise<void> {
  await trx('annotations')
    .whereIn('document_id', trx('documents').select('id').where(match))
    .del();
  await trx('documents').where(match).del();
}
