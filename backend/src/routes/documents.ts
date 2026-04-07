import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import db from '../db/knex';

const logger = pino({ name: 'documents' });

const ALLOWED_MIME_SET = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

class UnsupportedFileTypeError extends Error {
  statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFileTypeError';
  }
}

/**
 * Safely remove an uploaded file, logging but not throwing on failure.
 */
function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to clean up uploaded file');
  }
}

/**
 * Validate that the actual file content matches an allowed MIME type.
 * Uses magic-byte detection via `file-type` with a manual fallback for PDFs
 * whose header is preceded by whitespace.
 */
async function validateMagicBytes(
  filePath: string,
  declaredMime: string,
): Promise<{ valid: boolean; detectedMime?: string }> {
  // Dynamic import because file-type v22 is ESM-only
  // @ts-ignore -- ESM-only package; dynamic import resolves at runtime despite TS moduleResolution mismatch
  const { fileTypeFromFile } = await import('file-type');
  const detected = await fileTypeFromFile(filePath);

  if (detected) {
    if (ALLOWED_MIME_SET.has(detected.mime) && detected.mime === declaredMime) {
      return { valid: true, detectedMime: detected.mime };
    }
    // file-type detected something, but it doesn't match the declared type
    if (detected.mime !== declaredMime) {
      return { valid: false, detectedMime: detected.mime };
    }
  }

  // file-type may return undefined for some valid PDFs (e.g. leading whitespace
  // before the %PDF magic marker). Do a manual check for PDFs.
  if (declaredMime === 'application/pdf') {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(64);
      fs.readSync(fd, buf, 0, 64, 0);
      const header = buf.toString('ascii');
      if (header.includes('%PDF-')) {
        return { valid: true, detectedMime: 'application/pdf' };
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  return { valid: false, detectedMime: detected?.mime };
}

function detectEmbeddedPdfJavaScript(filePath: string): string[] {
  const pdfText = fs.readFileSync(filePath, 'latin1');
  const actionMarkers = [/\/OpenAction\b/i, /\/AA\b/i];
  const scriptMarkers = [/\/S\s*\/JavaScript\b/i, /\/JavaScript\b/i, /\/JS\b/i];

  if (!actionMarkers.some((pattern) => pattern.test(pdfText))) {
    return [];
  }

  const findings = scriptMarkers
    .filter((pattern) => pattern.test(pdfText))
    .map((pattern) => pattern.source);

  return [...new Set(findings)];
}

function serializeDocument(doc: Record<string, unknown>) {
  const { file_path: _filePath, user_id: _userId, ...publicDoc } = doc;
  return publicDoc;
}

function runUploadMiddleware(middleware: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    middleware(req, res, (err?: unknown) => {
      if (!err) {
        next();
        return;
      }

      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'Uploaded file exceeds the size limit' });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }

      if (err instanceof UnsupportedFileTypeError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }

      next(err);
    });
  };
}

const router = express.Router();

const DATA_DIR = process.env.DATA_DIR || './data';
const FILES_DIR = path.join(DATA_DIR, 'pdfs');
const THUMBNAIL_DIR = path.join(DATA_DIR, 'thumbnails');

fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

// File upload via multer (PDFs and images)

const fileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, FILES_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '';
    cb(null, `${uniqueSuffix}${safeExt}`);
  },
});

const fileUpload = multer({
  storage: fileStorage,
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_SET.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new UnsupportedFileTypeError('Only PDF and image files (JPEG, PNG, WebP) are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

const thumbnailUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new UnsupportedFileTypeError('Only JPEG/PNG images are allowed'));
    }
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});

function resolveWithin(baseDir: string, relativePath: string): string | null {
  const basePath = path.resolve(baseDir);
  const resolved = path.resolve(basePath, relativePath);
  if (!resolved.startsWith(`${basePath}${path.sep}`) && resolved !== basePath) {
    return null;
  }
  return resolved;
}

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: false,
  legacyHeaders: false,
  message: { error: 'Too many uploads, please try again later' },
});

const handleDocumentUpload = runUploadMiddleware(fileUpload.single('file'));
const handleThumbnailUpload = runUploadMiddleware(thumbnailUpload.single('thumbnail'));

// POST / -- Upload a PDF or image
router.post('/', uploadLimiter, handleDocumentUpload, async (req, res): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const uploadedFilePath = path.join(FILES_DIR, req.file.filename);

    // Validate filename length (consistent with PATCH endpoint's 500-char limit)
    if (req.file.originalname.length > 500) {
      cleanupFile(uploadedFilePath);
      res.status(400).json({ error: 'Filename must not exceed 500 characters' });
      return;
    }

    // Validate magic bytes match the declared MIME type
    const { valid, detectedMime } = await validateMagicBytes(
      uploadedFilePath,
      req.file.mimetype,
    );
    if (!valid) {
      cleanupFile(uploadedFilePath);
      res.status(400).json({
        error: `File content does not match declared type. Declared: ${req.file.mimetype}, detected: ${detectedMime || 'unknown'}`,
      });
      return;
    }

    if (req.file.mimetype === 'application/pdf') {
      const embeddedJavaScriptFindings = detectEmbeddedPdfJavaScript(uploadedFilePath);
      if (embeddedJavaScriptFindings.length > 0) {
        cleanupFile(uploadedFilePath);
        res.status(400).json({ error: 'PDFs containing embedded JavaScript actions are not allowed' });
        return;
      }
    }

    // Check per-user storage quota (default 500MB)
    const MAX_USER_STORAGE = parseInt(process.env.MAX_USER_STORAGE_MB || '500', 10) * 1024 * 1024;
    const currentUsage = await db('documents')
      .where({ user_id: req.session.userId })
      .sum('file_size as total')
      .first();
    const totalUsage = Number(currentUsage?.total || 0) + req.file.size;
    if (totalUsage > MAX_USER_STORAGE) {
      // Clean up the uploaded file
      fs.unlinkSync(path.join(FILES_DIR, req.file.filename));
      res.status(413).json({ error: 'Storage quota exceeded' });
      return;
    }

    const id = crypto.randomUUID();
    const isPdf = req.file.mimetype === 'application/pdf';
    const doc = {
      id,
      filename: req.file.filename,
      original_name: req.file.originalname,
      file_path: path.join('pdfs', req.file.filename),
      file_size: req.file.size,
      page_count: isPdf ? null : 1,
      thumbnail_path: null,
      user_id: req.session.userId,
      file_type: isPdf ? 'pdf' : 'image',
      mime_type: req.file.mimetype,
    };

    try {
      await db('documents').insert(doc);
    } catch (dbError) {
      // Database insert failed -- remove the orphaned file from disk
      cleanupFile(uploadedFilePath);
      throw dbError;
    }

    const inserted = await db('documents').where({ id }).first();
    res.status(201).json(serializeDocument(inserted));
  } catch (error) {
    logger.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// GET / -- List all documents for the authenticated user
router.get('/', async (req, res) => {
  try {
    const userId = req.session.userId;
    const docs = await db('documents')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc');
    res.json(docs.map((doc) => serializeDocument(doc)));
  } catch (error) {
    logger.error('List error:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// GET /:id -- Get single document
router.get('/:id', async (req, res): Promise<void> => {
  try {
    const doc = await db('documents')
      .where({ id: req.params.id, user_id: req.session.userId })
      .first();
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json(serializeDocument(doc));
  } catch (error) {
    logger.error('Get error:', error);
    res.status(500).json({ error: 'Failed to get document' });
  }
});

// PATCH /:id -- Update document metadata
const updateDocumentSchema = z.object({
  page_count: z.number().int().min(1).max(10000).optional(),
  original_name: z.string().min(1, 'Document name cannot be empty').max(500).trim().optional(),
});

router.patch('/:id', async (req, res): Promise<void> => {
  try {
    const parsed = updateDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      res.status(400).json({ error: firstError?.message || 'Invalid input' });
      return;
    }

    const { page_count, original_name } = parsed.data;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (page_count !== undefined) updates.page_count = page_count;
    if (original_name !== undefined) updates.original_name = original_name;

    const count = await db('documents')
      .where({ id: req.params.id, user_id: req.session.userId })
      .update(updates);
    if (count === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const doc = await db('documents').where({ id: req.params.id, user_id: req.session.userId }).first();
    res.json(serializeDocument(doc));
  } catch (error) {
    logger.error('Update error:', error);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

// DELETE /:id -- Delete document + file + annotations
router.delete('/:id', async (req, res): Promise<void> => {
  try {
    const doc = await db('documents')
      .where({ id: req.params.id, user_id: req.session.userId })
      .first();
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Delete the stored file (PDF or image)
    const filePath = resolveWithin(DATA_DIR, doc.file_path);
    if (!filePath) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete thumbnail if exists
    if (doc.thumbnail_path) {
      const thumbPath = resolveWithin(THUMBNAIL_DIR, path.basename(doc.thumbnail_path));
      if (!thumbPath) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (fs.existsSync(thumbPath)) {
        fs.unlinkSync(thumbPath);
      }
    }

    // Delete DB record (annotations cascade)
    await db('documents').where({ id: req.params.id, user_id: req.session.userId }).del();

    res.status(204).send();
  } catch (error) {
    logger.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// GET /:id/file -- Serve the document file (PDF or image)
// GET /:id/pdf  -- Backward-compatible alias
const serveFile = async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const doc = await db('documents')
      .where({ id: req.params.id, user_id: req.session.userId })
      .first();
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Path traversal containment check
    const filePath = resolveWithin(DATA_DIR, doc.file_path);
    if (!filePath) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const contentType = doc.mime_type || 'application/pdf';
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Download-Options', 'noopen');
    const safeName = doc.original_name.replace(/["\\\r\n]/g, '_');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.sendFile(filePath);
  } catch (error) {
    logger.error('File serve error:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
};

router.get('/:id/file', serveFile);
router.get('/:id/pdf', serveFile);

// POST /:id/thumbnail -- Upload client-generated thumbnail
router.post('/:id/thumbnail', uploadLimiter, handleThumbnailUpload, async (req, res): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No thumbnail uploaded' });
      return;
    }

    const doc = await db('documents')
      .where({ id: req.params.id, user_id: req.session.userId })
      .first();
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const thumbnailExtension = req.file.mimetype === 'image/png' ? '.png' : '.jpg';
    const thumbnailFilename = `${req.params.id}${thumbnailExtension}`;
    const diskPath = resolveWithin(THUMBNAIL_DIR, thumbnailFilename);
    if (!diskPath) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    fs.writeFileSync(diskPath, req.file.buffer, { mode: 0o600 });
    const thumbnailPath = path.join('thumbnails', thumbnailFilename);
    await db('documents')
      .where({ id: req.params.id, user_id: req.session.userId })
      .update({ thumbnail_path: thumbnailPath, updated_at: new Date().toISOString() });

    const updatedDoc = await db('documents').where({ id: req.params.id, user_id: req.session.userId }).first();
    res.json(serializeDocument(updatedDoc));
  } catch (error) {
    logger.error('Thumbnail upload error:', error);
    res.status(500).json({ error: 'Failed to upload thumbnail' });
  }
});

// GET /:id/thumbnail -- Serve thumbnail image
router.get('/:id/thumbnail', async (req, res): Promise<void> => {
  try {
    const doc = await db('documents')
      .where({ id: req.params.id, user_id: req.session.userId })
      .first();
    if (!doc || !doc.thumbnail_path) {
      res.status(404).json({ error: 'Thumbnail not found' });
      return;
    }

    const thumbPath = resolveWithin(THUMBNAIL_DIR, path.basename(doc.thumbnail_path));
    if (!thumbPath) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (!fs.existsSync(thumbPath)) {
      res.status(404).json({ error: 'Thumbnail file not found' });
      return;
    }

    res.setHeader('Content-Type', path.extname(thumbPath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg');
    res.sendFile(thumbPath);
  } catch (error) {
    logger.error('Thumbnail serve error:', error);
    res.status(500).json({ error: 'Failed to serve thumbnail' });
  }
});

export default router;
