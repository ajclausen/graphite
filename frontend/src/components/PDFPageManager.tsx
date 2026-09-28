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
import { confirmDialog, toast, errorMessage } from '../store/uiStore';
import { pluralize } from '../utils/format';
import { useMediaQuery } from '../utils/useMediaQuery';
import { Modal } from './ui/Modal';
import { Menu, type MenuItemDef } from './ui/Menu';
import { Icon } from './ui/Icon';
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

interface PDFPageThumbnailProps {
  pdfDocument: PDFDocumentProxy | null;
  pageNumber: number;
  displayNumber: number;
  selected: boolean;
  active: boolean;
  focusable: boolean;
  dragging: boolean;
  dropPosition: DropPosition | null;
  disabled: boolean;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onToggle: () => void;
  onFocus: () => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

const PDFPageThumbnail: React.FC<PDFPageThumbnailProps> = ({
  pdfDocument,
  pageNumber,
  displayNumber,
  selected,
  active,
  focusable,
  dragging,
  dropPosition,
  disabled,
  onClick,
  onToggle,
  onFocus,
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
        const maxWidth = 168;
        const maxHeight = 200;
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

  const moved = pageNumber !== displayNumber;
  const label = `Page ${displayNumber}${moved ? `, moved from ${pageNumber}` : ''}${active ? ', open in editor' : ''}`;

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={label}
      tabIndex={focusable ? 0 : -1}
      className={`pm-page${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}${dropPosition === 'before' ? ' is-drop-before' : ''}${dropPosition === 'after' ? ' is-drop-after' : ''}`}
      onClick={onClick}
      onFocus={onFocus}
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-page={pageNumber}
    >
      <div className="pm-page-canvas">
        <canvas ref={canvasRef} aria-hidden="true" />
        {renderState !== 'ready' && (
          <span className="pm-page-state" aria-hidden="true">
            {renderState === 'error' ? 'No preview' : <span className="g-spinner g-spinner--sm" />}
          </span>
        )}
      </div>
      <div className="pm-page-footer" aria-hidden="true">
        <span className="pm-page-number">{displayNumber}</span>
        {moved && <span className="pm-page-moved">was {pageNumber}</span>}
        {active && !moved && <span className="pm-page-open">Open</span>}
      </div>
      {/* Tap target for multi-select on touch; keyboard users press Space instead */}
      <span
        className="pm-page-check"
        aria-hidden="true"
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <Icon name="check" size={14} strokeWidth={3} />
      </span>
    </div>
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

  const handleClose = useCallback(async () => {
    if (orderDirty) {
      const discard = await confirmDialog({
        title: 'Discard page order changes?',
        message: 'You’ve rearranged pages but haven’t saved the new order.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        danger: true,
      });
      if (!discard) return;
    }
    onClose();
  }, [onClose, orderDirty]);

  // Escape closes the manager (or the append dialog first, if it's open).
  // Shared confirm dialogs handle their own Escape in the capture phase.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || working) return;
      if (sourcePdfImport) {
        setSourcePdfImport(null);
        return;
      }
      void handleClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, sourcePdfImport, working]);

  const handleThumbnailClick = useCallback((pageNumber: number, event: React.MouseEvent<HTMLDivElement>) => {
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

  const handleDragStart = useCallback((pageNumber: number, event: React.DragEvent<HTMLDivElement>) => {
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
      toast.success('Page order saved');
    } catch (error) {
      console.error('Failed to save page order:', error);
      toast.error('Couldn’t save page order', errorMessage(error, 'Please try again.'));
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
      toast.error('Couldn’t insert page', errorMessage(error, 'Please try again.'));
    } finally {
      setWorking(null);
    }
  }, [actionDisabled, doc.id, onDocumentUpdated, selectedLastPage, setSingleSelection]);

  const handleDeletePages = useCallback(async () => {
    if (actionDisabled) return;
    if (selectedOrdered.length >= numPages) {
      toast.info('A PDF needs at least one page', 'Deselect a page to keep before deleting.');
      return;
    }

    const confirmed = await confirmDialog({
      title: `Delete ${pluralize(selectedOrdered.length, 'page')}?`,
      message: 'Annotations on these pages will be deleted too. This can’t be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;

    setWorking('Deleting pages');
    try {
      await useAnnotationStore.getState().flushAllPendingSaves();
      const result = await deletePdfPages(doc.id, selectedOrdered);
      setSingleSelection(result.pageNumber);
      onDocumentUpdated(result.document, result.pageNumber);
      toast.success(`Deleted ${pluralize(selectedOrdered.length, 'page')}`);
    } catch (error) {
      console.error('Failed to delete pages:', error);
      toast.error('Couldn’t delete pages', errorMessage(error, 'Please try again.'));
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
      toast.error('Couldn’t rotate pages', errorMessage(error, 'Please try again.'));
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
      toast.error('Couldn’t duplicate pages', errorMessage(error, 'Please try again.'));
    } finally {
      setWorking(null);
    }
  }, [actionDisabled, doc.id, onDocumentUpdated, selectedLastPage, selectedOrdered]);

  const handleExtractPages = useCallback(async () => {
    if (actionDisabled) return;

    const confirmed = await confirmDialog({
      title: `Extract ${pluralize(selectedOrdered.length, 'page')} to a new PDF?`,
      message: 'A copy of the selected pages is added to your library. This document stays unchanged.',
      confirmLabel: 'Extract',
    });
    if (!confirmed) return;

    setWorking('Extracting pages');
    try {
      await useAnnotationStore.getState().flushAllPendingSaves();
      const result = await extractPdfPages(doc.id, selectedOrdered);
      onDocumentCreated?.(result.document);
      toast.success(`Created ${result.document.original_name}`, 'Find it in your library or the document switcher.');
    } catch (error) {
      console.error('Failed to extract pages:', error);
      toast.error('Couldn’t extract pages', errorMessage(error, 'Please try again.'));
    } finally {
      setWorking(null);
    }
  }, [actionDisabled, doc.id, onDocumentCreated, selectedOrdered]);

  const handleSourcePdfSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;
    if (file.type !== 'application/pdf') {
      toast.error('Only PDF files can be appended', `${file.name} isn’t a PDF.`);
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
      toast.error(`Couldn’t read ${file.name}`, 'The file may be damaged or password-protected.');
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

  // ── Keyboard / touch selection and reordering ──────────────────────────────

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [focusedPage, setFocusedPage] = useState<number>(() => Math.min(Math.max(1, currentPage), numPages));
  const [announcement, setAnnouncement] = useState('');
  const isTouch = useMediaQuery('(pointer: coarse)');

  const announce = useCallback((message: string) => {
    // Clear first so repeating the same message is still announced.
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  const focusPage = useCallback((page: number) => {
    // Every page element is already rendered and focusable, so move focus
    // right away rather than a frame later.
    gridRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`)?.focus();
    setFocusedPage(page);
  }, []);

  // Open with keyboard focus on the page that's open in the editor.
  useEffect(() => {
    const page = Math.min(Math.max(1, currentPage), numPages);
    const frame = requestAnimationFrame(() => {
      const el = gridRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`);
      el?.focus();
      el?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep Tab inside the manager while it's open (it's a modal view).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialogRef.current) return;
      if (document.querySelector('.g-modal, .g-menu')) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [tabindex="0"], input:not(:disabled), select:not(:disabled)',
      )).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleSelected = useCallback((page: number) => {
    const next = new Set(selectedPages);
    if (next.has(page)) {
      if (next.size > 1) next.delete(page);
    } else {
      next.add(page);
    }
    setSelectedPages(next);
    setLastSelectedPage(page);
    announce(formatSelectedPages(pageOrder.filter((p) => next.has(p))));
  }, [announce, pageOrder, selectedPages]);

  const allSelected = selectedPages.size === pageOrder.length;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSingleSelection(focusedPage);
      announce(`Page ${pageOrder.indexOf(focusedPage) + 1} selected`);
    } else {
      setSelectedPages(new Set(pageOrder));
      announce(`All ${pageOrder.length} pages selected`);
    }
  }, [allSelected, announce, focusedPage, pageOrder, setSingleSelection]);

  const canMove = (delta: -1 | 1) => {
    if (working || selectedOrdered.length === 0 || selectedOrdered.length === pageOrder.length) return false;
    return pageOrder.some((page, index) => {
      const neighbor = pageOrder[index + delta];
      return selectedPages.has(page) && neighbor !== undefined && !selectedPages.has(neighbor);
    });
  };

  /** Moves the selected pages one step as a block, keeping their relative order. */
  const moveSelection = useCallback((delta: -1 | 1) => {
    const next = [...pageOrder];
    let movedAny = false;
    if (delta < 0) {
      for (let i = 1; i < next.length; i += 1) {
        if (selectedPages.has(next[i]) && !selectedPages.has(next[i - 1])) {
          [next[i - 1], next[i]] = [next[i], next[i - 1]];
          movedAny = true;
        }
      }
    } else {
      for (let i = next.length - 2; i >= 0; i -= 1) {
        if (selectedPages.has(next[i]) && !selectedPages.has(next[i + 1])) {
          [next[i + 1], next[i]] = [next[i], next[i + 1]];
          movedAny = true;
        }
      }
    }
    if (!movedAny) return;
    setPageOrder(next);
    const positions = next
      .map((page, index) => (selectedPages.has(page) ? index + 1 : null))
      .filter((p): p is number => p !== null);
    announce(positions.length === 1
      ? `Moved to position ${positions[0]} of ${next.length}. Save order to keep it.`
      : `Moved ${positions.length} pages ${delta < 0 ? 'earlier' : 'later'}. Save order to keep it.`);
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLElement>(`[data-page="${focusedPage}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  }, [announce, focusedPage, pageOrder, selectedPages]);

  const getColumnCount = () => {
    const items = gridRef.current?.querySelectorAll<HTMLElement>('[data-page]');
    if (!items || items.length === 0) return 1;
    const firstTop = items[0].getBoundingClientRect().top;
    let count = 0;
    for (const item of Array.from(items)) {
      if (Math.abs(item.getBoundingClientRect().top - firstTop) > 2) break;
      count += 1;
    }
    return Math.max(1, count);
  };

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = pageOrder.indexOf(focusedPage);
    if (index < 0) return;
    const columns = getColumnCount();
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
    };

    // Alt+Arrow moves the selected pages
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'ArrowRight' || event.key === 'ArrowDown')) {
      event.preventDefault();
      moveSelection(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
      return;
    }

    if (event.key in steps || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const target = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? pageOrder.length - 1
          : Math.min(pageOrder.length - 1, Math.max(0, index + steps[event.key]));
      const page = pageOrder[target];
      focusPage(page);
      if (event.shiftKey) {
        const anchor = pageOrder.indexOf(lastSelectedPage);
        const [a, b] = [Math.min(anchor, target), Math.max(anchor, target)];
        setSelectedPages(new Set(pageOrder.slice(a, b + 1)));
      }
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
      toggleSelected(focusedPage);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      setSingleSelection(focusedPage);
      if (!orderDirty) {
        onGoToPage(focusedPage);
        announce(`Page ${index + 1} opened in the editor`);
      }
    } else if ((event.key === 'a' || event.key === 'A') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      setSelectedPages(new Set(pageOrder));
      announce(`All ${pageOrder.length} pages selected`);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !actionDisabled) {
      event.preventDefault();
      void handleDeletePages();
    }
  };

  const actionsLocked = Boolean(working) || orderDirty;
  const moreItems: MenuItemDef[] = [
    { id: 'copy', label: 'Duplicate', icon: 'copy', onSelect: () => void handleDuplicatePages(), disabled: actionDisabled },
    { id: 'blank', label: 'Insert blank page after', icon: 'filePlus', onSelect: () => void handleInsertBlankPage(), disabled: actionDisabled },
    { id: 'append', label: 'Insert pages from a PDF…', icon: 'fileImport', onSelect: () => sourcePdfInputRef.current?.click(), disabled: actionDisabled },
    { id: 'extract', label: 'Extract to new PDF', icon: 'fileExport', onSelect: () => void handleExtractPages(), disabled: actionDisabled },
  ];

  return (
    <div
      ref={dialogRef}
      className="pm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pm-title"
      aria-describedby="pm-subtitle"
    >
      <div className="pm-bar">
        <button type="button" className="g-btn g-btn--ghost pm-done" onClick={() => void handleClose()} aria-label="Done">
          <Icon name="arrowLeft" size={18} />
          <span>Done</span>
        </button>
        <div className="pm-title-wrap">
          <h2 id="pm-title" className="pm-title">Pages</h2>
          <p id="pm-subtitle" className="pm-subtitle">
            <span className="pm-doc-name">{doc.original_name}</span>
            <span aria-hidden="true">·</span>
            <span>{working ? `${working}…` : orderDirty ? 'Unsaved order' : pluralize(numPages, 'page')}</span>
          </p>
        </div>
        <div className="pm-bar-actions">
          {orderDirty ? (
            <>
              <button type="button" className="g-btn g-btn--ghost g-btn--sm" onClick={handleResetOrder} disabled={Boolean(working)} aria-label="Reset order">
                <Icon name="undo" size={16} />
                <span className="pm-hide-phone">Reset</span>
              </button>
              <button type="button" className="g-btn g-btn--primary g-btn--sm" onClick={() => void handleSaveOrder()} disabled={Boolean(working)}>
                <Icon name="check" size={16} strokeWidth={2.5} />
                Save order
              </button>
            </>
          ) : (
            <button type="button" className="g-btn g-btn--ghost g-btn--sm" onClick={toggleSelectAll} disabled={Boolean(working)} aria-pressed={allSelected}>
              <Icon name="selectAll" size={16} />
              {allSelected ? 'Select one' : 'Select all'}
            </button>
          )}
        </div>
      </div>

      <p className="pm-hint" id="pm-hint">
        {isTouch
          ? 'Tap a page to open it. Tap the circle to select several, then move or edit them below.'
          : 'Click to select, Shift or Ctrl-click for more. Drag or use the arrows below to reorder.'}
        <span className="visually-hidden">
          {' '}Keyboard: arrow keys move between pages, Space selects, Shift with arrows extends the selection,
          Alt with arrows moves selected pages, Enter opens a page, Delete removes selected pages.
        </span>
      </p>

      <div
        id="pm-grid"
        className="pm-grid"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Pages"
        aria-describedby="pm-hint"
        ref={gridRef}
        onKeyDown={handleGridKeyDown}
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
            focusable={pageNumber === focusedPage}
            dragging={draggedPage === pageNumber}
            dropPosition={
              dropTarget && dropTarget.page === pageNumber && draggedPage !== pageNumber
                ? dropTarget.position
                : null
            }
            disabled={Boolean(working)}
            onClick={(event) => {
              setFocusedPage(pageNumber);
              handleThumbnailClick(pageNumber, event);
            }}
            onToggle={() => {
              setFocusedPage(pageNumber);
              toggleSelected(pageNumber);
            }}
            onFocus={() => setFocusedPage(pageNumber)}
            onDragStart={(event) => handleDragStart(pageNumber, event)}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>

      <div className="pm-actions" role="group" aria-label="Page actions">
        <div className="pm-selection" aria-hidden="true">
          <strong>{selectedOrdered.length}</strong>
          <span>{selectedOrdered.length === 1 ? 'page selected' : 'pages selected'}</span>
        </div>

        <div className="pm-actions-group">
          <button type="button" className="pm-action" onClick={() => moveSelection(-1)} disabled={!canMove(-1)} title="Move earlier (Alt+←)">
            <Icon name="arrowLeft" size={18} />
            <span>Earlier</span>
          </button>
          <button type="button" className="pm-action" onClick={() => moveSelection(1)} disabled={!canMove(1)} title="Move later (Alt+→)">
            <Icon name="arrowRight" size={18} />
            <span>Later</span>
          </button>
        </div>

        <div className="pm-actions-divider" aria-hidden="true" />

        <div className="pm-actions-group">
          <button type="button" className="pm-action" onClick={() => void handleRotatePages()} disabled={actionDisabled} title="Rotate 90° clockwise">
            <Icon name="rotate" size={18} />
            <span>Rotate</span>
          </button>
          <button type="button" className="pm-action pm-desktop-only" onClick={() => void handleDuplicatePages()} disabled={actionDisabled}>
            <Icon name="copy" size={18} />
            <span>Duplicate</span>
          </button>
          <button type="button" className="pm-action pm-desktop-only" onClick={() => void handleInsertBlankPage()} disabled={actionDisabled} title="Insert a blank page after the selection">
            <Icon name="filePlus" size={18} />
            <span>Blank page</span>
          </button>
          <button type="button" className="pm-action pm-desktop-only" onClick={() => sourcePdfInputRef.current?.click()} disabled={actionDisabled} title="Insert pages from another PDF after the selection">
            <Icon name="fileImport" size={18} />
            <span>From PDF</span>
          </button>
          <button type="button" className="pm-action pm-desktop-only" onClick={() => void handleExtractPages()} disabled={actionDisabled} title="Copy the selected pages into a new PDF">
            <Icon name="fileExport" size={18} />
            <span>Extract</span>
          </button>
          <div className="pm-phone-only">
            <Menu
              items={moreItems}
              header={{ title: formatSelectedPages(selectedOrdered) }}
              renderTrigger={(props) => (
                <button {...props} type="button" className="pm-action" disabled={actionsLocked}>
                  <Icon name="moreHorizontal" size={18} />
                  <span>More</span>
                </button>
              )}
            />
          </div>
          <button
            type="button"
            className="pm-action pm-action--danger"
            onClick={() => void handleDeletePages()}
            disabled={actionDisabled || selectedOrdered.length >= numPages}
            title={selectedOrdered.length >= numPages ? 'A PDF needs at least one page' : 'Delete selected pages'}
          >
            <Icon name="trash" size={18} />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {orderDirty && (
        <div className="pm-toast-hint" role="status">
          Save the new order to use the other page actions.
        </div>
      )}

      <div className="visually-hidden" role="status" aria-live="polite">{announcement}</div>

      <input
        ref={sourcePdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={handleSourcePdfSelect}
        hidden
      />

      {sourcePdfImport && (
        <Modal
          title="Insert pages from a PDF"
          description={<><strong>{sourcePdfImport.file.name}</strong> has {pluralize(sourcePdfImport.pageCount, 'page')}.</>}
          onClose={() => { if (!working) setSourcePdfImport(null); }}
          busy={Boolean(working)}
          width={460}
        >
          <form className="g-form g-modal-body" onSubmit={handleImportPdfPages}>
            <div className="g-field">
              <label className="g-label" htmlFor="manager-source-page-range">Pages to insert</label>
              <input
                id="manager-source-page-range"
                className="g-input"
                value={sourcePdfImport.rangeText}
                onChange={(event) => setSourcePdfImport((current) => current ? {
                  ...current,
                  rangeText: event.target.value,
                  error: null,
                } : current)}
                placeholder="1-3, 5, 8"
                inputMode="numeric"
                disabled={Boolean(working)}
                aria-describedby="manager-source-hint"
                aria-invalid={Boolean(sourcePdfImport.error || sourcePdfSelection?.error) || undefined}
              />
              <span id="manager-source-hint" className={`g-hint${sourcePdfImport.error || sourcePdfSelection?.error ? ' is-error' : ''}`} aria-live="polite">
                {sourcePdfImport.error || sourcePdfSelection?.error || (
                  `${sourcePdfSelection?.pages.length || 0} of ${sourcePdfImport.pageCount} pages selected`
                )}
              </span>
            </div>
            <div className="g-field">
              <label className="g-label" htmlFor="manager-source-insert-after">Insert after</label>
              <select
                id="manager-source-insert-after"
                className="g-select"
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
            </div>
            <div className="g-modal-actions">
              <button type="button" className="g-btn g-btn--secondary" onClick={() => setSourcePdfImport(null)} disabled={Boolean(working)}>
                Cancel
              </button>
              <button type="submit" className="g-btn g-btn--primary" disabled={Boolean(working) || Boolean(sourcePdfSelection?.error)}>
                {working === 'Appending PDF' ? 'Inserting…' : 'Insert pages'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
