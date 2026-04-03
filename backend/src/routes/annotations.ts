import express from 'express';
import pino from 'pino';
import { z } from 'zod';
import db from '../db/knex';

const router = express.Router();
const logger = pino({ name: 'annotations' });

const pageMetricsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  sceneX: z.number().finite().optional(),
  sceneY: z.number().finite().optional(),
  sceneWidth: z.number().positive().optional(),
  sceneHeight: z.number().positive().optional(),
});

const annotationSchema = z.object({
  elements: z.array(z.record(z.unknown())).max(10000, 'Too many elements'),
  pageMetrics: pageMetricsSchema.nullable().optional(),
});

function parsePageNumber(value: string): number | null {
  const page = parseInt(value, 10);
  if (!Number.isFinite(page) || page < 1 || page > 10000) return null;
  return page;
}

// Helper to verify document ownership
async function verifyDocumentOwnership(
  documentId: string,
  userId: string | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const doc = await db('documents').where({ id: documentId, user_id: userId }).first();
  return !!doc;
}

// GET /:id/annotations -- All annotations for a document
router.get('/:id/annotations', async (req, res) => {
  try {
    if (!await verifyDocumentOwnership(req.params.id, req.session.userId)) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const rows = await db('annotations')
      .where({ document_id: req.params.id })
      .orderBy('page_number');

    const annotations = rows.map((row) => ({
      id: row.id,
      document_id: row.document_id,
      page_number: row.page_number,
      elements: JSON.parse(row.elements_json),
      pageMetrics: row.page_metrics_json ? JSON.parse(row.page_metrics_json) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json(annotations);
  } catch (error) {
    logger.error('Get annotations error:', error);
    res.status(500).json({ error: 'Failed to get annotations' });
  }
});

// GET /:id/annotations/:page -- Single page annotation
router.get('/:id/annotations/:page', async (req, res): Promise<void> => {
  try {
    const pageNumber = parsePageNumber(req.params.page);
    if (pageNumber === null) {
      res.status(400).json({ error: 'Invalid page number (must be 1-10000)' });
      return;
    }

    if (!await verifyDocumentOwnership(req.params.id, req.session.userId)) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const row = await db('annotations')
      .where({
        document_id: req.params.id,
        page_number: pageNumber,
      })
      .first();

    if (!row) {
      res.status(404).json({ error: 'No annotation for this page' });
      return;
    }

    res.json({
      id: row.id,
      document_id: row.document_id,
      page_number: row.page_number,
      elements: JSON.parse(row.elements_json),
      pageMetrics: row.page_metrics_json ? JSON.parse(row.page_metrics_json) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  } catch (error) {
    logger.error('Get page annotation error:', error);
    res.status(500).json({ error: 'Failed to get annotation' });
  }
});

// PUT /:id/annotations/:page -- Upsert annotations for a page
router.put('/:id/annotations/:page', async (req, res): Promise<void> => {
  try {
    const pageNumber = parsePageNumber(req.params.page);
    if (pageNumber === null) {
      res.status(400).json({ error: 'Invalid page number (must be 1-10000)' });
      return;
    }

    const parsed = annotationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const { elements, pageMetrics } = parsed.data;

    if (JSON.stringify(elements).length > 512 * 1024) {
      res.status(400).json({ error: 'Annotation data too large' });
      return;
    }

    if (!await verifyDocumentOwnership(req.params.id, req.session.userId)) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const documentId = req.params.id;
    const now = new Date().toISOString();

    const existing = await db('annotations')
      .where({ document_id: documentId, page_number: pageNumber })
      .first();

    if (existing) {
      await db('annotations')
        .where({ document_id: documentId, page_number: pageNumber })
        .update({
          elements_json: JSON.stringify(elements),
          page_metrics_json: pageMetrics ? JSON.stringify(pageMetrics) : null,
          updated_at: now,
        });
    } else {
      await db('annotations').insert({
        document_id: documentId,
        page_number: pageNumber,
        elements_json: JSON.stringify(elements),
        page_metrics_json: pageMetrics ? JSON.stringify(pageMetrics) : null,
        user_id: req.session.userId || null,
        created_at: now,
        updated_at: now,
      });
    }

    const row = await db('annotations')
      .where({ document_id: documentId, page_number: pageNumber })
      .first();

    res.json({
      id: row.id,
      document_id: row.document_id,
      page_number: row.page_number,
      elements: JSON.parse(row.elements_json),
      pageMetrics: row.page_metrics_json ? JSON.parse(row.page_metrics_json) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  } catch (error) {
    logger.error('Upsert annotation error:', error);
    res.status(500).json({ error: 'Failed to save annotation' });
  }
});

// DELETE /:id/annotations/:page -- Delete annotation for a page
router.delete('/:id/annotations/:page', async (req, res): Promise<void> => {
  try {
    const pageNumber = parsePageNumber(req.params.page);
    if (pageNumber === null) {
      res.status(400).json({ error: 'Invalid page number (must be 1-10000)' });
      return;
    }

    if (!await verifyDocumentOwnership(req.params.id, req.session.userId)) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const count = await db('annotations')
      .where({
        document_id: req.params.id,
        page_number: pageNumber,
      })
      .del();

    if (count === 0) {
      res.status(404).json({ error: 'No annotation for this page' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    logger.error('Delete annotation error:', error);
    res.status(500).json({ error: 'Failed to delete annotation' });
  }
});

export default router;
