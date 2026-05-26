import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import {
  deletePdfPages,
  duplicatePdfPages,
  editPdfPages,
  extractPdfPages,
  importPdfPages,
  reorderPdfPages,
  rotatePdfPages,
} from '../api/client';
import type { Document } from '../api/client';
import { useAnnotationStore } from '../store/annotationStore';
import { pdfjs } from '../utils/pdfWorker';
import { PDF_DOCUMENT_OPTIONS } from '../utils/pdfOptions';
import './PDFPageManager.css';

interface PDFPageManagerProps {
  document: Document;
  pdfDocument: PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;
  onClose: () => void;
  onGoToPage: (page: number) => void;
  onDocumentUpdated: (doc: Document, pageNumber: number) => void;
  onDocumentCreated?: (doc: Document) => void;
}

interface SourcePdfImportState {
  file: File;
  pageCount: number;
  rangeText: string;
  insertAfterPage: number;
  error: string | null;
}

function createPageSequence(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}

function parsePageRange(value: string, pageCount: number): { pages: number[]; error: string | null } {
  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return { pages: [], error: 'Enter at least one page or range.' };
  }

  const pages: number[] = [];
  const seen = new Set<number>();

  for (const token of tokens) {
    const match = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) {
      return { pages: [], error: 'Use pages like 1, 3-5, 8.' };
    }

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;

    if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
      return { pages: [], error: `Pages must be between 1 and ${pageCount}.` };
    }

    if (end < start) {
      return { pages: [], error: 'Page ranges must go from low to high.' };
    }

    for (let page = start; page <= end; page += 1) {
      if (!seen.has(page)) {
        seen.add(page);
        pages.push(page);
      }
    }
  }

  return { pages, error: null };
}

async function getPdfPageCount(file: File): Promise<number> {
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    ...PDF_DOCUMENT_OPTIONS,
  }).promise;
  const pageCount = pdf.numPages;
  await pdf.destroy();
  return pageCount;
}

type DropPosition = 'before' | 'after';

function movePage(
  pageOrder: number[],
  sourcePage: number,
  targetPage: number,
  position: DropPosition,
): number[] {
  if (sourcePage === targetPage) return pageOrder;

  const sourceIndex = pageOrder.indexOf(sourcePage);
  const targetIndex = pageOrder.indexOf(targetPage);
  if (sourceIndex < 0 || targetIndex < 0) return pageOrder;

  const nextOrder = pageOrder.filter((page) => page !== sourcePage);
  const newTargetIndex = nextOrder.indexOf(targetPage);
  const insertIndex = position === 'after' ? newTargetIndex + 1 : newTargetIndex;
  nextOrder.splice(insertIndex, 0, sourcePage);
  return nextOrder;
}

function formatSelectedPages(pageNumbers: number[]): string {
  if (pageNumbers.length === 0) return 'No pages selected';
  if (pageNumbers.length === 1) return `Page ${pageNumbers[0]}`;
  return `${pageNumbers.length} pages selected`;
}

interface ManagerButtonProps {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
  title?: string;
}

const ManagerButton: React.FC<ManagerButtonProps> = ({
  children,
  label,
  onClick,
  disabled = false,
  danger = false,
  primary = false,
  title,
}) => (
  <button
    type="button"
    className={`pdf-page-manager-button${danger ? ' is-danger' : ''}${primary ? ' is-primary' : ''}`}
    onClick={onClick}
    disabled={disabled}
    title={title || label}
  >
    {children}
    <span>{label}</span>
  </button>
);

interface PDFPageThumbnailProps {
  pdfDocument: PDFDocumentProxy | null;
  pageNumber: number;
  displayNumber: number;
  selected: boolean;
  active: boolean;
  dragging: boolean;
  dropPosition: DropPosition | null;
  disabled: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}

const PDFPageThumbnail: React.FC<PDFPageThumbnailProps> = ({
  pdfDocument,
  pageNumber,
  displayNumber,
  selected,
  active,
  dragging,
  dropPosition,
  disabled,
  onClick,
  onDragStart,
  onDragEnd,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderState, setRenderState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    const drawThumbnail = async () => {
      const canvas = canvasRef.current;
      if (!pdfDocument || !canvas) {
        setRenderState('loading');
        return;
      }

      const context = canvas.getContext('2d', { alpha: false });
      if (!context) {
        setRenderState('error');
        return;
      }

      setRenderState('loading');

      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled) {
          page.cleanup();
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const maxWidth = 190;
        const maxHeight = 138;
        const cssScale = Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * pixelRatio });
        const cssWidth = Math.ceil(viewport.width / pixelRatio);
        const cssHeight = Math.ceil(viewport.height / pixelRatio);

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
        page.cleanup();

        if (!cancelled) {
          setRenderState('ready');
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to render page thumbnail:', error);
          setRenderState('error');
        }
      }
    };

    void drawThumbnail();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDocument, pageNumber]);

  return (
    <button
      type="button"
      className={`pdf-page-thumbnail${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}${dropPosition === 'before' ? ' is-drop-before' : ''}${dropPosition === 'after' ? ' is-drop-after' : ''}`}
      onClick={onClick}
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-page={pageNumber}
      title={`Page ${displayNumber}`}
    >
      <div className="pdf-page-thumbnail-canvas-wrap">
        <canvas ref={canvasRef} />
        {renderState !== 'ready' && (
          <span className="pdf-page-thumbnail-state">
            {renderState === 'error' ? 'Preview failed' : 'Rendering...'}
          </span>
        )}
      </div>
      <div className="pdf-page-thumbnail-footer">
        <span>{displayNumber}</span>
        {pageNumber !== displayNumber && <span className="pdf-page-thumbnail-source">was {pageNumber}</span>}
      </div>
    </button>
  );
};

export const PDFPageManager: React.FC<PDFPageManagerProps> = ({
  document: doc,
  pdfDocument,
  numPages,
  currentPage,
  onClose,
  onGoToPage,
  onDocumentUpdated,
  onDocumentCreated,
}) => {
  const [pageOrder, setPageOrder] = useState<number[]>(() => createPageSequence(numPages));
  const [selectedPages, setSelectedPages] = useState<Set<number>>(() => new Set([currentPage]));
  const [lastSelectedPage, setLastSelectedPage] = useState(currentPage);
  const [draggedPage, setDraggedPage] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ page: number; position: DropPosition } | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [sourcePdfImport, setSourcePdfImport] = useState<SourcePdfImportState | null>(null);
  const sourcePdfInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const initialPage = Math.min(Math.max(1, currentPage), numPages);
    setPageOrder(createPageSequence(numPages));
    setSelectedPages(new Set([initialPage]));
    setLastSelectedPage(initialPage);
    setDraggedPage(null);
    setDropTarget(null);
    setWorking(null);
    setSourcePdfImport(null);
  }, [doc.id, numPages]);

  const orderDirty = useMemo(
    () => pageOrder.length !== numPages || pageOrder.some((page, index) => page !== index + 1),
    [numPages, pageOrder],
  );

  const selectedOrdered = useMemo(
    () => pageOrder.filter((page) => selectedPages.has(page)),
    [pageOrder, selectedPages],
  );

  const selectedSummary = useMemo(() => formatSelectedPages(selectedOrdered), [selectedOrdered]);
  const sourcePdfSelection = useMemo(
    () => sourcePdfImport ? parsePageRange(sourcePdfImport.rangeText, sourcePdfImport.pageCount) : null,
    [sourcePdfImport],
  );

  const actionDisabled = Boolean(working) || orderDirty || selectedOrdered.length === 0;
  const selectedLastPage = selectedOrdered[selectedOrdered.length - 1] ?? Math.min(currentPage, numPages);

  const setSingleSelection = useCallback((pageNumber: number) => {
    setSelectedPages(new Set([pageNumber]));
    setLastSelectedPage(pageNumber);
  }, []);

  const handleClose = useCallback(() => {
    if (orderDirty && !confirm('Discard unsaved page order changes?')) {
      return;
    }
    onClose();
  }, [onClose, orderDirty]);

  const handleThumbnailClick = useCallback((pageNumber: number, event: React.MouseEvent<HTMLButtonElement>) => {
    setSelectedPages((current) => {
      if (event.shiftKey) {
        const startIndex = pageOrder.indexOf(lastSelectedPage);
        const endIndex = pageOrder.indexOf(pageNumber);
        if (startIndex >= 0 && endIndex >= 0) {
          const first = Math.min(startIndex, endIndex);
          const last = Math.max(startIndex, endIndex);
          return new Set(pageOrder.slice(first, last + 1));
        }
      }

      if (event.metaKey || event.ctrlKey) {
        const next = new Set(current);
        if (next.has(pageNumber) && next.size > 1) {
          next.delete(pageNumber);
        } else {
          next.add(pageNumber);
        }
        return next;
      }

      return new Set([pageNumber]);
    });

    setLastSelectedPage(pageNumber);

    if (!orderDirty && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      onGoToPage(pageNumber);
    }
  }, [lastSelectedPage, onGoToPage, orderDirty, pageOrder]);

  const gridRef = useRef<HTMLDivElement | null>(null);

  const computeDropTarget = useCallback(
    (clientX: number, clientY: number): { page: number; position: DropPosition } | null => {
      const grid = gridRef.current;
      if (!grid) return null;

      const items = Array.from(
        grid.querySelectorAll<HTMLElement>('[data-page]'),
      );
      if (items.length === 0) return null;

      let bestItem: HTMLElement | null = null;
      let bestDistance = Infinity;

      for (const item of items) {
        const rect = item.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          bestItem = item;
          break;
        }
        const cx = (rect.left + rect.right) / 2;
        const cy = (rect.top + rect.bottom) / 2;
        const distance = Math.hypot(clientX - cx, clientY - cy);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestItem = item;
        }
      }

      if (!bestItem) return null;

      const page = Number(bestItem.dataset.page);
      if (!Number.isInteger(page)) return null;

      const rect = bestItem.getBoundingClientRect();
      const isAfter = clientX > rect.left + rect.width / 2;

      if (isAfter) {
        // Normalize "after page N" → "before page N+1" so each gap has one canonical target.
        // The very last gap stays as "after the last page" — it has no successor to normalize to.
        const orderIndex = pageOrder.indexOf(page);
        if (orderIndex >= 0 && orderIndex < pageOrder.length - 1) {
          return { page: pageOrder[orderIndex + 1], position: 'before' };
        }
        return { page, position: 'after' };
      }

      return { page, position: 'before' };
    },
    [pageOrder],
  );

  const handleDragStart = useCallback((pageNumber: number, event: React.DragEvent<HTMLButtonElement>) => {
    setDraggedPage(pageNumber);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(pageNumber));
  }, []);

  const handleGridDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const next = computeDropTarget(event.clientX, event.clientY);
    setDropTarget((current) => {
      if (!next) return current;
      if (current && current.page === next.page && current.position === next.position) {
        return current;
      }
      return next;
    });
  }, [computeDropTarget]);

  const handleGridDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    // Only clear if the cursor actually left the grid (not just moved between children).
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) return;
    setDropTarget(null);
  }, []);

  const handleGridDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const sourcePage = draggedPage ?? Number(event.dataTransfer.getData('text/plain'));
    if (!Number.isInteger(sourcePage)) {
      setDropTarget(null);
      return;
    }

    const target = computeDropTarget(event.clientX, event.clientY) ?? dropTarget;
    if (target) {
      setPageOrder((current) => movePage(current, sourcePage, target.page, target.position));
    }
    setDraggedPage(null);
    setDropTarget(null);
  }, [computeDropTarget, draggedPage, dropTarget]);

  const handleDragEnd = useCallback(() => {
    setDraggedPage(null);
    setDropTarget(null);
  }, []);

  const handleResetOrder = useCallback(() => {
    setPageOrder(createPageSequence(numPages));
  }, [numPages]);

  const handleSaveOrder = useCallback(async () => {
    if (!orderDirty || working) return;

    setWorking('Saving order');
    try {
      await useAnnotationStore.getState().flushAllPendingSaves();
      const result = await reorderPdfPages(doc.id, pageOrder);
      const nextPage = Math.min(Math.max(1, result.pageNumber), result.document.page_count || numPages);
      setSingleSelection(nextPage);
      onDocumentUpdated(result.document, nextPage);
    } catch (error) {
      console.error('Failed to save page order:', error);
      alert('Failed to save page order');
    } finally {
      setWorking(null);
    }
  }, [doc.id, numPages, onDocumentUpdated, orderDirty, pageOrder, setSingleSelection, working]);

  const handleInsertBlankPage = useCallback(async () => {
    if (actionDisabled) return;

    setWorking('Inserting page');
    try {
      await useAnnotationStore.getState().flushAllPendingSaves();
      const result = await editPdfPages(doc.id, {
        action: 'insertBlank',
        pageNumber: selectedLastPage,
        placement: 'after',
      });
      setSingleSelection(result.pageNumber);
      onDocumentUpdated(result.document, result.pageNumber);
    } catch (error) {
      console.error('Failed to insert page:', error);
      alert('Failed to insert page');
    } finally {
      setWorking(null);
    }
  }, [actionDisabled, doc.id, onDocumentUpdated, selectedLastPage, setSingleSelection]);

  const handleDeletePages = useCallback(async () => {
    if (actionDisabled) return;
    if (selectedOrdered.length >= numPages) {
      alert('A PDF must keep at least one page.');
      return;
    }

    if (!confirm(`Delete ${selectedOrdered.length} selected ${selectedOrdered.length === 1 ? 'page' : 'pages'}? Annotations on those pages will also be deleted.`)) {
      return;
    }

    setWorking('Deleting pages');
    try {
      await useAnnotationStore.getState().flushAllPendingSaves();
      const result = await deletePdfPages(doc.id, selectedOrdered);
      setSingleSelection(result.pageNumber);
      onDocumentUpdated(result.document, result.pageNumber);
    } catch (error) {
      console.error('Failed to delete pages:', error);
      alert('Failed to delete pages');
    } finally {
      setWorking(null);
    }
  }, [actionDisabled, doc.id, numPages, onDocumentUpdated, selectedOrdered, setSingleSelection]);

  const handleRotatePages = useCallback(async () => {
    if (actionDisabled) return;

    setWorking('Rotating pages');
    try {
      await useAnnotationStore.getState().flushAllPendingSaves();
      const result = await rotatePdfPages(doc.id, selectedOrdered, 90);
      const nextPage = selectedOrdered[0] ?? result.pageNumber;
      setSelectedPages(new Set(selectedOrdered));
      onDocumentUpdated(result.document, nextPage);
    } catch (error) {
      console.error('Failed to rotate pages:', error);
      alert('Failed to rotate pages');
    } finally {
      setWorking(null);
    }
  }, [actionDisabled, doc.id, onDocumentUpdated, selectedOrdered]);

  const handleDuplicatePages = useCallback(async () => {
    if (actionDisabled) return;

    setWorking('Duplicating pages');
    try {
      await useAnnotationStore.getState().flushAllPendingSaves();
      const result = await duplicatePdfPages(doc.id, selectedOrdered, selectedLastPage);
      const duplicatedPages = Array.from({ length: selectedOrdered.length }, (_, index) => result.pageNumber + index);
      setSelectedPages(new Set(duplicatedPages));
      setLastSelectedPage(duplicatedPages[duplicatedPages.length - 1] ?? result.pageNumber);
      onDocumentUpdated(result.document, result.pageNumber);
    } catch (error) {
      console.error('Failed to duplicate pages:', error);
      alert('Failed to duplicate pages');
    } finally {
      setWorking(null);
    }
  }, [actionDisabled, doc.id, onDocumentUpdated, selectedLastPage, selectedOrdered]);

  const handleExtractPages = useCallback(async () => {
    if (actionDisabled) return;

    if (!confirm(`Extract ${selectedOrdered.length} selected ${selectedOrdered.length === 1 ? 'page' : 'pages'} into a new PDF?`)) {
      return;
    }

    setWorking('Extracting pages');
    try {
      await useAnnotationStore.getState().flushAllPendingSaves();
      const result = await extractPdfPages(doc.id, selectedOrdered);
      onDocumentCreated?.(result.document);
      alert(`Created ${result.document.original_name}`);
    } catch (error) {
      console.error('Failed to extract pages:', error);
      alert('Failed to extract pages');
    } finally {
      setWorking(null);
    }
  }, [actionDisabled, doc.id, onDocumentCreated, selectedOrdered]);

  const handleSourcePdfSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;
    if (file.type !== 'application/pdf') {
      alert('Please choose a PDF file');
      return;
    }

    setWorking('Reading PDF');
    try {
      const pageCount = await getPdfPageCount(file);
      setSourcePdfImport({
        file,
        pageCount,
        rangeText: pageCount > 1 ? `1-${pageCount}` : '1',
        insertAfterPage: selectedLastPage,
        error: null,
      });
    } catch (error) {
      console.error('Failed to inspect source PDF:', error);
      alert('Failed to read PDF pages');
    } finally {
      setWorking(null);
    }
  }, [selectedLastPage]);

  const handleImportPdfPages = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sourcePdfImport || working) return;

    const selection = parsePageRange(sourcePdfImport.rangeText, sourcePdfImport.pageCount);
    if (selection.error) {
      setSourcePdfImport((current) => current ? { ...current, error: selection.error } : current);
      return;
    }

    setWorking('Appending PDF');
    try {
      await useAnnotationStore.getState().flushAllPendingSaves();
      const insertAtStart = sourcePdfImport.insertAfterPage <= 0;
      const result = await importPdfPages(doc.id, sourcePdfImport.file, {
        pageNumber: insertAtStart ? 1 : sourcePdfImport.insertAfterPage,
        placement: insertAtStart ? 'before' : 'after',
        pageRange: sourcePdfImport.rangeText,
      });
      const insertedPages = Array.from({ length: selection.pages.length }, (_, index) => result.pageNumber + index);
      setSelectedPages(new Set(insertedPages));
      setLastSelectedPage(insertedPages[insertedPages.length - 1] ?? result.pageNumber);
      setSourcePdfImport(null);
      onDocumentUpdated(result.document, result.pageNumber);
    } catch (error) {
      console.error('Failed to append PDF pages:', error);
      setSourcePdfImport((current) => current ? {
        ...current,
        error: 'Failed to append pages from this PDF.',
      } : current);
    } finally {
      setWorking(null);
    }
  }, [doc.id, onDocumentUpdated, sourcePdfImport, working]);

  return (
    <div className="pdf-page-manager" role="dialog" aria-modal="true" aria-label="Manage PDF pages">
      <div className="pdf-page-manager-toolbar">
        <div className="pdf-page-manager-toolbar-group">
          <ManagerButton label="Done" onClick={handleClose} title="Return to annotator">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </ManagerButton>
          <div className="pdf-page-manager-divider" />
          <div className="pdf-page-manager-title" title={doc.original_name}>
            <strong>{doc.original_name}</strong>
            <span>{working || (orderDirty ? 'Unsaved order' : `${numPages} pages`)}</span>
          </div>
        </div>

        <div className="pdf-page-manager-toolbar-group is-scrollable">
          <ManagerButton
            label="Save order"
            onClick={handleSaveOrder}
            disabled={!orderDirty || Boolean(working)}
            primary
            title="Save reordered pages"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
          </ManagerButton>
          <ManagerButton
            label="Reset order"
            onClick={handleResetOrder}
            disabled={!orderDirty || Boolean(working)}
            title="Reset reordered pages"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" />
            </svg>
          </ManagerButton>
          <div className="pdf-page-manager-divider" />
          <ManagerButton
            label="Insert page"
            onClick={handleInsertBlankPage}
            disabled={actionDisabled}
            title="Insert a blank page after the selection"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="8" y1="13" x2="16" y2="13" />
              <line x1="12" y1="9" x2="12" y2="17" />
            </svg>
          </ManagerButton>
          <ManagerButton
            label="Append file"
            onClick={() => sourcePdfInputRef.current?.click()}
            disabled={actionDisabled}
            title="Insert pages from another PDF after the selection"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <path d="M8 13h8" />
              <path d="M12 9v8" />
              <path d="M18 13h3" />
            </svg>
          </ManagerButton>
          <input
            ref={sourcePdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleSourcePdfSelect}
            style={{ display: 'none' }}
          />
          <ManagerButton label="Rotate" onClick={handleRotatePages} disabled={actionDisabled} title="Rotate selected pages clockwise">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10" />
            </svg>
          </ManagerButton>
          <ManagerButton label="Copy" onClick={handleDuplicatePages} disabled={actionDisabled} title="Duplicate selected pages">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </ManagerButton>
          <ManagerButton label="Extract" onClick={handleExtractPages} disabled={actionDisabled} title="Create a new PDF from selected pages">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <path d="M9 15h8" />
              <polyline points="14 12 17 15 14 18" />
            </svg>
          </ManagerButton>
          <ManagerButton label="Delete" onClick={handleDeletePages} disabled={actionDisabled || selectedOrdered.length >= numPages} danger title="Delete selected pages">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </ManagerButton>
        </div>
      </div>

      <div className="pdf-page-manager-subbar">
        <span>{selectedSummary}</span>
        {orderDirty && <span>Save order before using page actions.</span>}
      </div>

      <div
        className="pdf-page-manager-grid"
        aria-label="PDF pages"
        ref={gridRef}
        onDragOver={handleGridDragOver}
        onDragLeave={handleGridDragLeave}
        onDrop={handleGridDrop}
      >
        {pageOrder.map((pageNumber, index) => (
          <PDFPageThumbnail
            key={pageNumber}
            pdfDocument={pdfDocument}
            pageNumber={pageNumber}
            displayNumber={index + 1}
            selected={selectedPages.has(pageNumber)}
            active={!orderDirty && pageNumber === currentPage}
            dragging={draggedPage === pageNumber}
            dropPosition={
              dropTarget && dropTarget.page === pageNumber && draggedPage !== pageNumber
                ? dropTarget.position
                : null
            }
            disabled={Boolean(working)}
            onClick={(event) => handleThumbnailClick(pageNumber, event)}
            onDragStart={(event) => handleDragStart(pageNumber, event)}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>

      {sourcePdfImport && (
        <div
          className="pdf-page-manager-modal-backdrop"
          onClick={() => {
            if (!working) setSourcePdfImport(null);
          }}
        >
          <div className="pdf-page-manager-modal" onClick={(event) => event.stopPropagation()}>
            <h2>Append PDF Pages</h2>
            <p>{sourcePdfImport.file.name}</p>
            <form onSubmit={handleImportPdfPages}>
              <label className="pdf-page-manager-modal-label" htmlFor="manager-source-page-range">
                Pages
              </label>
              <input
                id="manager-source-page-range"
                className="pdf-page-manager-modal-input"
                value={sourcePdfImport.rangeText}
                onChange={(event) => setSourcePdfImport((current) => current ? {
                  ...current,
                  rangeText: event.target.value,
                  error: null,
                } : current)}
                placeholder="1-3, 5, 8"
                disabled={Boolean(working)}
              />
              <label className="pdf-page-manager-modal-label" htmlFor="manager-source-insert-after">
                Insert after
              </label>
              <select
                id="manager-source-insert-after"
                className="pdf-page-manager-modal-input"
                value={sourcePdfImport.insertAfterPage}
                onChange={(event) => setSourcePdfImport((current) => current ? {
                  ...current,
                  insertAfterPage: Number(event.target.value),
                } : current)}
                disabled={Boolean(working)}
              >
                <option value={0}>Start of document</option>
                {createPageSequence(numPages).map((page) => (
                  <option key={page} value={page}>
                    {page === numPages ? `Page ${page} (end)` : `Page ${page}`}
                  </option>
                ))}
              </select>
              <div className="pdf-page-manager-modal-hint">
                {sourcePdfImport.error || sourcePdfSelection?.error || (
                  `${sourcePdfSelection?.pages.length || 0} of ${sourcePdfImport.pageCount} pages selected`
                )}
              </div>
              <div className="pdf-page-manager-modal-actions">
                <button type="button" onClick={() => setSourcePdfImport(null)} disabled={Boolean(working)}>
                  Cancel
                </button>
                <button type="submit" className="is-primary" disabled={Boolean(working)}>
                  {working === 'Appending PDF' ? 'Appending...' : 'Append'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
