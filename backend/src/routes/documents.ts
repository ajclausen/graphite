import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import { PDFDocument, degrees as pdfDegrees } from 'pdf-lib';
import type { Knex } from 'knex';
import db from '../db/knex';
import {
  FILES_DIR,
  THUMBNAIL_DIR,
  DATA_DIR,
  cleanupFile,
  resolveWithin,
  resolveDocumentFiles,
  deleteDocumentRows,
} from '../storage/documentStorage';

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

async function getPdfPageCount(filePath: string): Promise<number | null> {
  try {
    const pdfDoc = await PDFDocument.load(fs.readFileSync(filePath));
    return pdfDoc.getPageCount();
  } catch (err) {
    logger.warn({ err, filePath }, 'Failed to read PDF page count');
    return null;
  }
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

const sourcePdfUpload = multer({
  storage: fileStorage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new UnsupportedFileTypeError('Only PDF files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

function parsePageRange(value: string, pageCount: number): { pages: number[]; error?: string } {
  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return { pages: [], error: 'Enter at least one page or range' };
  }

  const pages: number[] = [];
  const seen = new Set<number>();

  for (const token of tokens) {
    const match = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) {
      return { pages: [], error: 'Use pages like 1, 3-5, 8' };
    }

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;

    if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
      return { pages: [], error: `Pages must be between 1 and ${pageCount}` };
    }

    if (end < start) {
      return { pages: [], error: 'Page ranges must go from low to high' };
    }

    for (let page = start; page <= end; page += 1) {
      if (!seen.has(page)) {
        seen.add(page);
        pages.push(page);
      }
    }
  }

  return { pages };
}

async function clearThumbnail(thumbnailPath: string | null): Promise<void> {
  if (!thumbnailPath) return;

  const thumbPath = resolveWithin(THUMBNAIL_DIR, path.basename(thumbnailPath));
  if (thumbPath) cleanupFile(thumbPath);
}

async function shiftAnnotationPages(
  trx: Knex.Transaction,
  documentId: string,
  fromPage: number,
  amount: number,
): Promise<void> {
  if (amount === 0) return;

  const tempOffset = 100000;

  if (amount > 0) {
    await trx('annotations')
      .where({ document_id: documentId })
      .andWhere('page_number', '>=', fromPage)
      .update({ page_number: trx.raw('page_number + ?', [tempOffset]) });

    await trx('annotations')
      .where({ document_id: documentId })
      .andWhere('page_number', '>=', fromPage + tempOffset)
      .update({ page_number: trx.raw('page_number - ?', [tempOffset - amount]) });
    return;
  }

  const deleteCount = Math.abs(amount);

  await trx('annotations')
    .where({ document_id: documentId })
    .andWhere('page_number', '>', fromPage)
    .update({ page_number: trx.raw('page_number + ?', [tempOffset]) });

  await trx('annotations')
    .where({ document_id: documentId })
    .andWhere('page_number', '>', fromPage + tempOffset)
    .update({ page_number: trx.raw('page_number - ?', [tempOffset + deleteCount]) });
}

async function remapAnnotationPages(
  trx: Knex.Transaction,
  documentId: string,
  pageMap: Map<number, number>,
): Promise<void> {
  const tempOffset = 100000;
  const oldPages = [...pageMap.keys()];

  if (oldPages.length === 0) {
    await trx('annotations').where({ document_id: documentId }).del();
    return;
  }

  await trx('annotations')
    .where({ document_id: documentId })
    .whereNotIn('page_number', oldPages)
    .del();

  await trx('annotations')
    .where({ document_id: documentId })
    .whereIn('page_number', oldPages)
    .update({ page_number: trx.raw('page_number + ?', [tempOffset]) });

  for (const [oldPage, newPage] of pageMap.entries()) {
    await trx('annotations')
      .where({ document_id: documentId, page_number: oldPage + tempOffset })
      .update({ page_number: newPage });
  }
}

function uniquePageNumbers(pageNumbers: number[]): number[] {
  const seen = new Set<number>();
  const pages: number[] = [];

  for (const pageNumber of pageNumbers) {
    if (!seen.has(pageNumber)) {
      seen.add(pageNumber);
      pages.push(pageNumber);
    }
  }

  return pages;
}

function validatePageNumbers(pageNumbers: number[], pageCount: number): string | null {
  if (pageNumbers.length === 0) return 'Select at least one page';

  for (const pageNumber of pageNumbers) {
    if (pageNumber < 1 || pageNumber > pageCount) {
      return `Pages must be between 1 and ${pageCount}`;
    }
  }

  return null;
}

function createPdfFilename(): string {
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
}

function getExtractedPdfName(originalName: string, pageNumbers: number[]): string {
  const baseName = originalName.replace(/\.pdf$/i, '');
  const pageLabel = pageNumbers.length === 1
    ? String(pageNumbers[0])
    : `${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}`;
  return `${baseName}_pages_${pageLabel}.pdf`;
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
const handleSourcePdfUpload = runUploadMiddleware(sourcePdfUpload.single('sourcePdf'));

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
    const pageCount = isPdf ? await getPdfPageCount(uploadedFilePath) : 1;
    const doc = {
      id,
      filename: req.file.filename,
      original_name: req.file.originalname,
      file_path: path.join('pdfs', req.file.filename),
      file_size: req.file.size,
      page_count: pageCount,
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

    // Annotation saves don't touch documents.updated_at (it doubles as a
    // render-cache key for the file itself), so surface the latest activity
    // separately for "recently edited" sorting in the library.
    const annotationTimes = docs.length === 0 ? [] : await db('annotations')
      .whereIn('document_id', docs.map((doc) => doc.id))
      .groupBy('document_id')
      .select('document_id')
      .max({ last_annotated_at: 'updated_at' }) as Array<{ document_id: string; last_annotated_at: string | null }>;
    const lastAnnotated = new Map(annotationTimes.map((row) => [row.document_id, row.last_annotated_at]));

    res.json(docs.map((doc) => {
      const annotatedAt = lastAnnotated.get(doc.id);
      const lastEditedAt = annotatedAt && annotatedAt > doc.updated_at ? annotatedAt : doc.updated_at;
      return { ...serializeDocument(doc), last_edited_at: lastEditedAt };
    }));
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

const editPdfPagesSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('delete'),
    pageNumber: z.number().int().min(1).max(10000),
  }),
  z.object({
    action: z.literal('insertBlank'),
    pageNumber: z.number().int().min(1).max(10000),
    placement: z.enum(['before', 'after']).default('after'),
  }),
]);

// POST /:id/pages -- Insert or delete pages in a PDF document
router.post('/:id/pages', async (req, res): Promise<void> => {
  try {
    const parsed = editPdfPagesSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      res.status(400).json({ error: firstError?.message || 'Invalid page edit request' });
      return;
    }

    const doc = await db('documents')
      .where({ id: req.params.id, user_id: req.session.userId })
      .first();
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (doc.file_type !== 'pdf' && doc.mime_type !== 'application/pdf') {
      res.status(400).json({ error: 'Page editing is only available for PDFs' });
      return;
    }

    const filePath = resolveWithin(DATA_DIR, doc.file_path);
    if (!filePath) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    let pdfDoc: PDFDocument;
    try {
      pdfDoc = await PDFDocument.load(fs.readFileSync(filePath));
    } catch (error) {
      logger.warn({ error, documentId: doc.id }, 'Failed to load PDF for page edit');
      res.status(400).json({ error: 'This PDF cannot be edited' });
      return;
    }

    const pageCount = pdfDoc.getPageCount();
    const operation = parsed.data;
    let nextPageNumber: number;
    let nextPageCount: number;

    if (operation.pageNumber > pageCount) {
      res.status(400).json({ error: `Page number must be between 1 and ${pageCount}` });
      return;
    }

    if (operation.action === 'delete') {
      if (pageCount <= 1) {
        res.status(400).json({ error: 'A PDF must keep at least one page' });
        return;
      }

      pdfDoc.removePage(operation.pageNumber - 1);
      nextPageCount = pageCount - 1;
      nextPageNumber = Math.min(operation.pageNumber, nextPageCount);
    } else {
      const referencePage = pdfDoc.getPage(operation.pageNumber - 1);
      const { width, height } = referencePage.getSize();
      const insertIndex = operation.placement === 'before'
        ? operation.pageNumber - 1
        : operation.pageNumber;

      pdfDoc.insertPage(insertIndex, [width, height]);
      nextPageCount = pageCount + 1;
      nextPageNumber = insertIndex + 1;
    }

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(filePath, pdfBytes, { mode: 0o600 });
    await clearThumbnail(doc.thumbnail_path);

    const now = new Date().toISOString();
    await db.transaction(async (trx) => {
      if (operation.action === 'delete') {
        await trx('annotations')
          .where({ document_id: doc.id, page_number: operation.pageNumber })
          .del();
        await shiftAnnotationPages(trx, doc.id, operation.pageNumber, -1);
      } else {
        await shiftAnnotationPages(trx, doc.id, nextPageNumber, 1);
      }

      await trx('documents')
        .where({ id: doc.id, user_id: req.session.userId })
        .update({
          file_size: pdfBytes.length,
          page_count: nextPageCount,
          thumbnail_path: null,
          updated_at: now,
        });
    });

    const updatedDoc = await db('documents')
      .where({ id: doc.id, user_id: req.session.userId })
      .first();

    res.json({
      document: serializeDocument(updatedDoc),
      pageNumber: nextPageNumber,
    });
  } catch (error) {
    logger.error('Page edit error:', error);
    res.status(500).json({ error: 'Failed to edit PDF pages' });
  }
});

const pageNumbersSchema = z.object({
  pageNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(1000),
});

const reorderPagesSchema = z.object({
  pageOrder: z.array(z.number().int().min(1).max(10000)).min(1).max(10000),
});

const rotatePagesSchema = pageNumbersSchema.extend({
  degrees: z.union([z.literal(90), z.literal(180), z.literal(270), z.literal(-90)]).default(90),
});

const duplicatePagesSchema = pageNumbersSchema.extend({
  insertAfterPage: z.number().int().min(0).max(10000).optional(),
});

async function getEditablePdfDocument(
  req: express.Request,
  res: express.Response,
): Promise<{ doc: Record<string, any>; filePath: string; pdfDoc: PDFDocument } | null> {
  const doc = await db('documents')
    .where({ id: req.params.id, user_id: req.session.userId })
    .first();
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return null;
  }

  if (doc.file_type !== 'pdf' && doc.mime_type !== 'application/pdf') {
    res.status(400).json({ error: 'Page editing is only available for PDFs' });
    return null;
  }

  const filePath = resolveWithin(DATA_DIR, doc.file_path);
  if (!filePath) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }

  try {
    return {
      doc,
      filePath,
      pdfDoc: await PDFDocument.load(fs.readFileSync(filePath)),
    };
  } catch (error) {
    logger.warn({ error, documentId: doc.id }, 'Failed to load PDF for page edit');
    res.status(400).json({ error: 'This PDF cannot be edited' });
    return null;
  }
}

async function updatePdfDocumentRecord(
  doc: Record<string, any>,
  filePath: string,
  pdfBytes: Uint8Array,
  pageCount: number,
  userId: string | undefined,
): Promise<Record<string, unknown>> {
  fs.writeFileSync(filePath, pdfBytes, { mode: 0o600 });
  await clearThumbnail(doc.thumbnail_path);

  await db('documents')
    .where({ id: doc.id, user_id: userId })
    .update({
      file_size: pdfBytes.length,
      page_count: pageCount,
      thumbnail_path: null,
      updated_at: new Date().toISOString(),
    });

  return db('documents').where({ id: doc.id, user_id: userId }).first();
}

router.post('/:id/pages/reorder', async (req, res): Promise<void> => {
  try {
    const parsed = reorderPagesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid page order' });
      return;
    }

    const loaded = await getEditablePdfDocument(req, res);
    if (!loaded) return;

    const { doc, filePath, pdfDoc } = loaded;
    const pageCount = pdfDoc.getPageCount();
    const pageOrder = parsed.data.pageOrder;
    const uniquePages = uniquePageNumbers(pageOrder);

    if (
      pageOrder.length !== pageCount ||
      uniquePages.length !== pageCount ||
      validatePageNumbers(pageOrder, pageCount)
    ) {
      res.status(400).json({ error: `Page order must include each page from 1 to ${pageCount} exactly once` });
      return;
    }

    const nextPdf = await PDFDocument.create();
    const copiedPages = await nextPdf.copyPages(pdfDoc, pageOrder.map((pageNumber) => pageNumber - 1));
    copiedPages.forEach((page) => nextPdf.addPage(page));
    const pdfBytes = await nextPdf.save();

    const pageMap = new Map<number, number>();
    pageOrder.forEach((oldPage, index) => pageMap.set(oldPage, index + 1));

    fs.writeFileSync(filePath, pdfBytes, { mode: 0o600 });
    await clearThumbnail(doc.thumbnail_path);

    await db.transaction(async (trx) => {
      await remapAnnotationPages(trx, doc.id, pageMap);
      await trx('documents')
        .where({ id: doc.id, user_id: req.session.userId })
        .update({
          file_size: pdfBytes.length,
          page_count: pageCount,
          thumbnail_path: null,
          updated_at: new Date().toISOString(),
        });
    });

    const updatedDoc = await db('documents').where({ id: doc.id, user_id: req.session.userId }).first();
    res.json({ document: serializeDocument(updatedDoc), pageNumber: 1 });
  } catch (error) {
    logger.error('Page reorder error:', error);
    res.status(500).json({ error: 'Failed to reorder PDF pages' });
  }
});

router.post('/:id/pages/delete', async (req, res): Promise<void> => {
  try {
    const parsed = pageNumbersSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid page selection' });
      return;
    }

    const loaded = await getEditablePdfDocument(req, res);
    if (!loaded) return;

    const { doc, filePath, pdfDoc } = loaded;
    const pageCount = pdfDoc.getPageCount();
    const pageNumbers = uniquePageNumbers(parsed.data.pageNumbers).sort((a, b) => a - b);
    const validationError = validatePageNumbers(pageNumbers, pageCount);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
    if (pageNumbers.length >= pageCount) {
      res.status(400).json({ error: 'A PDF must keep at least one page' });
      return;
    }

    [...pageNumbers].sort((a, b) => b - a).forEach((pageNumber) => {
      pdfDoc.removePage(pageNumber - 1);
    });

    const deleted = new Set(pageNumbers);
    const pageMap = new Map<number, number>();
    let nextIndex = 1;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (!deleted.has(pageNumber)) {
        pageMap.set(pageNumber, nextIndex);
        nextIndex += 1;
      }
    }

    const nextPageCount = pageCount - pageNumbers.length;
    const nextPageNumber = Math.min(pageNumbers[0], nextPageCount);
    const pdfBytes = await pdfDoc.save();

    fs.writeFileSync(filePath, pdfBytes, { mode: 0o600 });
    await clearThumbnail(doc.thumbnail_path);

    await db.transaction(async (trx) => {
      await remapAnnotationPages(trx, doc.id, pageMap);
      await trx('documents')
        .where({ id: doc.id, user_id: req.session.userId })
        .update({
          file_size: pdfBytes.length,
          page_count: nextPageCount,
          thumbnail_path: null,
          updated_at: new Date().toISOString(),
        });
    });

    const updatedDoc = await db('documents').where({ id: doc.id, user_id: req.session.userId }).first();
    res.json({ document: serializeDocument(updatedDoc), pageNumber: nextPageNumber });
  } catch (error) {
    logger.error('Page delete error:', error);
    res.status(500).json({ error: 'Failed to delete PDF pages' });
  }
});

router.post('/:id/pages/rotate', async (req, res): Promise<void> => {
  try {
    const parsed = rotatePagesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid rotation request' });
      return;
    }

    const loaded = await getEditablePdfDocument(req, res);
    if (!loaded) return;

    const { doc, filePath, pdfDoc } = loaded;
    const pageCount = pdfDoc.getPageCount();
    const pageNumbers = uniquePageNumbers(parsed.data.pageNumbers);
    const validationError = validatePageNumbers(pageNumbers, pageCount);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    for (const pageNumber of pageNumbers) {
      const page = pdfDoc.getPage(pageNumber - 1);
      const nextAngle = (page.getRotation().angle + parsed.data.degrees + 360) % 360;
      page.setRotation(pdfDegrees(nextAngle));
    }

    const pdfBytes = await pdfDoc.save();
    const updatedDoc = await updatePdfDocumentRecord(doc, filePath, pdfBytes, pageCount, req.session.userId);
    res.json({ document: serializeDocument(updatedDoc), pageNumber: pageNumbers[0] });
  } catch (error) {
    logger.error('Page rotate error:', error);
    res.status(500).json({ error: 'Failed to rotate PDF pages' });
  }
});

router.post('/:id/pages/duplicate', async (req, res): Promise<void> => {
  try {
    const parsed = duplicatePagesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid duplicate request' });
      return;
    }

    const loaded = await getEditablePdfDocument(req, res);
    if (!loaded) return;

    const { doc, filePath, pdfDoc } = loaded;
    const pageCount = pdfDoc.getPageCount();
    const pageNumbers = uniquePageNumbers(parsed.data.pageNumbers);
    const validationError = validatePageNumbers(pageNumbers, pageCount);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const insertAfterPage = parsed.data.insertAfterPage ?? Math.max(...pageNumbers);
    if (insertAfterPage < 0 || insertAfterPage > pageCount) {
      res.status(400).json({ error: `Insert position must be between 0 and ${pageCount}` });
      return;
    }

    const copiedPages = await pdfDoc.copyPages(pdfDoc, pageNumbers.map((pageNumber) => pageNumber - 1));
    copiedPages.forEach((page, offset) => {
      pdfDoc.insertPage(insertAfterPage + offset, page);
    });

    const nextPageNumber = insertAfterPage + 1;
    const nextPageCount = pageCount + copiedPages.length;
    const pdfBytes = await pdfDoc.save();

    fs.writeFileSync(filePath, pdfBytes, { mode: 0o600 });
    await clearThumbnail(doc.thumbnail_path);

    await db.transaction(async (trx) => {
      const annotationRows = await trx('annotations')
        .where({ document_id: doc.id })
        .whereIn('page_number', pageNumbers);
      const rowByPage = new Map<number, any>();
      annotationRows.forEach((row) => rowByPage.set(row.page_number, row));

      await shiftAnnotationPages(trx, doc.id, nextPageNumber, copiedPages.length);

      for (const [index, pageNumber] of pageNumbers.entries()) {
        const row = rowByPage.get(pageNumber);
        if (!row) continue;
        await trx('annotations').insert({
          document_id: doc.id,
          page_number: nextPageNumber + index,
          elements_json: row.elements_json,
          page_metrics_json: row.page_metrics_json,
          user_id: req.session.userId || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      await trx('documents')
        .where({ id: doc.id, user_id: req.session.userId })
        .update({
          file_size: pdfBytes.length,
          page_count: nextPageCount,
          thumbnail_path: null,
          updated_at: new Date().toISOString(),
        });
    });

    const updatedDoc = await db('documents').where({ id: doc.id, user_id: req.session.userId }).first();
    res.json({ document: serializeDocument(updatedDoc), pageNumber: nextPageNumber });
  } catch (error) {
    logger.error('Page duplicate error:', error);
    res.status(500).json({ error: 'Failed to duplicate PDF pages' });
  }
});

router.post('/:id/pages/extract', async (req, res): Promise<void> => {
  try {
    const parsed = pageNumbersSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid extraction request' });
      return;
    }

    const loaded = await getEditablePdfDocument(req, res);
    if (!loaded) return;

    const { doc, pdfDoc } = loaded;
    const pageCount = pdfDoc.getPageCount();
    const pageNumbers = uniquePageNumbers(parsed.data.pageNumbers);
    const validationError = validatePageNumbers(pageNumbers, pageCount);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const nextPdf = await PDFDocument.create();
    const copiedPages = await nextPdf.copyPages(pdfDoc, pageNumbers.map((pageNumber) => pageNumber - 1));
    copiedPages.forEach((page) => nextPdf.addPage(page));
    const pdfBytes = await nextPdf.save();

    const MAX_USER_STORAGE = parseInt(process.env.MAX_USER_STORAGE_MB || '500', 10) * 1024 * 1024;
    const currentUsage = await db('documents')
      .where({ user_id: req.session.userId })
      .sum('file_size as total')
      .first();
    if (Number(currentUsage?.total || 0) + pdfBytes.length > MAX_USER_STORAGE) {
      res.status(413).json({ error: 'Storage quota exceeded' });
      return;
    }

    const filename = createPdfFilename();
    const filePath = path.join(FILES_DIR, filename);
    fs.writeFileSync(filePath, pdfBytes, { mode: 0o600 });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.transaction(async (trx) => {
      await trx('documents').insert({
        id,
        filename,
        original_name: getExtractedPdfName(doc.original_name, pageNumbers),
        file_path: path.join('pdfs', filename),
        file_size: pdfBytes.length,
        page_count: pageNumbers.length,
        thumbnail_path: null,
        user_id: req.session.userId,
        file_type: 'pdf',
        mime_type: 'application/pdf',
        created_at: now,
        updated_at: now,
      });

      const annotationRows = await trx('annotations')
        .where({ document_id: doc.id })
        .whereIn('page_number', pageNumbers);
      const rowByPage = new Map<number, any>();
      annotationRows.forEach((row) => rowByPage.set(row.page_number, row));

      for (const [index, pageNumber] of pageNumbers.entries()) {
        const row = rowByPage.get(pageNumber);
        if (!row) continue;
        await trx('annotations').insert({
          document_id: id,
          page_number: index + 1,
          elements_json: row.elements_json,
          page_metrics_json: row.page_metrics_json,
          user_id: req.session.userId || null,
          created_at: now,
          updated_at: now,
        });
      }
    });

    const newDoc = await db('documents').where({ id, user_id: req.session.userId }).first();
    res.status(201).json({ document: serializeDocument(newDoc) });
  } catch (error) {
    logger.error('Page extract error:', error);
    res.status(500).json({ error: 'Failed to extract PDF pages' });
  }
});

const importPdfPagesSchema = z.object({
  pageNumber: z.coerce.number().int().min(1).max(10000),
  placement: z.enum(['before', 'after']).default('after'),
  pageRange: z.string().min(1).max(200),
});

// POST /:id/pages/import -- Insert selected pages from another PDF
router.post('/:id/pages/import', uploadLimiter, handleSourcePdfUpload, async (req, res): Promise<void> => {
  const sourceFilePath = req.file ? path.join(FILES_DIR, req.file.filename) : null;

  try {
    if (!req.file || !sourceFilePath) {
      res.status(400).json({ error: 'No source PDF uploaded' });
      return;
    }

    const parsed = importPdfPagesSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      res.status(400).json({ error: firstError?.message || 'Invalid page import request' });
      return;
    }

    const { valid, detectedMime } = await validateMagicBytes(sourceFilePath, req.file.mimetype);
    if (!valid) {
      res.status(400).json({
        error: `Source PDF content does not match declared type. Declared: ${req.file.mimetype}, detected: ${detectedMime || 'unknown'}`,
      });
      return;
    }

    const embeddedJavaScriptFindings = detectEmbeddedPdfJavaScript(sourceFilePath);
    if (embeddedJavaScriptFindings.length > 0) {
      res.status(400).json({ error: 'PDFs containing embedded JavaScript actions are not allowed' });
      return;
    }

    const doc = await db('documents')
      .where({ id: req.params.id, user_id: req.session.userId })
      .first();
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (doc.file_type !== 'pdf' && doc.mime_type !== 'application/pdf') {
      res.status(400).json({ error: 'Page importing is only available for PDFs' });
      return;
    }

    const targetFilePath = resolveWithin(DATA_DIR, doc.file_path);
    if (!targetFilePath) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    let targetPdf: PDFDocument;
    let sourcePdf: PDFDocument;
    try {
      targetPdf = await PDFDocument.load(fs.readFileSync(targetFilePath));
      sourcePdf = await PDFDocument.load(fs.readFileSync(sourceFilePath));
    } catch (error) {
      logger.warn({ error, documentId: doc.id }, 'Failed to load PDFs for page import');
      res.status(400).json({ error: 'One of these PDFs cannot be edited' });
      return;
    }

    const operation = parsed.data;
    const targetPageCount = targetPdf.getPageCount();
    if (operation.pageNumber > targetPageCount) {
      res.status(400).json({ error: `Page number must be between 1 and ${targetPageCount}` });
      return;
    }

    const sourcePageCount = sourcePdf.getPageCount();
    const { pages, error } = parsePageRange(operation.pageRange, sourcePageCount);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const copiedPages = await targetPdf.copyPages(sourcePdf, pages.map((page) => page - 1));
    const insertIndex = operation.placement === 'before'
      ? operation.pageNumber - 1
      : operation.pageNumber;

    copiedPages.forEach((page, offset) => {
      targetPdf.insertPage(insertIndex + offset, page);
    });

    const nextPageNumber = insertIndex + 1;
    const nextPageCount = targetPageCount + copiedPages.length;
    const pdfBytes = await targetPdf.save();

    const MAX_USER_STORAGE = parseInt(process.env.MAX_USER_STORAGE_MB || '500', 10) * 1024 * 1024;
    const currentUsage = await db('documents')
      .where({ user_id: req.session.userId })
      .sum('file_size as total')
      .first();
    const totalUsage = Number(currentUsage?.total || 0) - Number(doc.file_size || 0) + pdfBytes.length;
    if (totalUsage > MAX_USER_STORAGE) {
      res.status(413).json({ error: 'Storage quota exceeded' });
      return;
    }

    fs.writeFileSync(targetFilePath, pdfBytes, { mode: 0o600 });
    await clearThumbnail(doc.thumbnail_path);

    const now = new Date().toISOString();
    await db.transaction(async (trx) => {
      await shiftAnnotationPages(trx, doc.id, nextPageNumber, copiedPages.length);

      await trx('documents')
        .where({ id: doc.id, user_id: req.session.userId })
        .update({
          file_size: pdfBytes.length,
          page_count: nextPageCount,
          thumbnail_path: null,
          updated_at: now,
        });
    });

    const updatedDoc = await db('documents')
      .where({ id: doc.id, user_id: req.session.userId })
      .first();

    res.json({
      document: serializeDocument(updatedDoc),
      pageNumber: nextPageNumber,
    });
  } catch (error) {
    logger.error('Page import error:', error);
    res.status(500).json({ error: 'Failed to import PDF pages' });
  } finally {
    if (sourceFilePath) cleanupFile(sourceFilePath);
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

    const files = resolveDocumentFiles(doc);
    if (!files) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    await deleteDocumentRows(db, { id: doc.id });
    files.forEach(cleanupFile);

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
