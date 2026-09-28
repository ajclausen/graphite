import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import {
  type Document,
  listDocuments,
  uploadDocument,
  deleteDocument,
  updateDocument,
  uploadThumbnail,
  getDocumentThumbnailUrl,
  getDocumentFileUrl,
} from '../api/client';
import { PDF_DOCUMENT_OPTIONS } from '../utils/pdfOptions';
import { formatDate, formatFileSize, formatRelative, parseTimestamp, pluralize } from '../utils/format';
import { confirmDialog, toast, errorMessage } from '../store/uiStore';
import { Modal } from './ui/Modal';
import './DocumentLibrary.css';

const ACCEPTED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const ACCEPT_STRING = '.pdf,.jpg,.jpeg,.png,.webp';

interface DocumentLibraryProps {
  onDocumentSelect: (doc: Document) => void;
}

function normalizeDocumentName(value: string, currentName: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';

  const currentExtMatch = currentName.match(/\.[^./\\\s]+$/i);
  const currentExt = currentExtMatch ? currentExtMatch[0] : null;
  const nextHasExtension = /\.[^./\\\s]+$/i.test(trimmed);

  if (currentExt && !nextHasExtension) {
    return `${trimmed}${currentExt}`;
  }

  return trimmed;
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

function createSelectedPdfName(fileName: string, rangeText: string): string {
  const extMatch = fileName.match(/\.pdf$/i);
  const baseName = extMatch ? fileName.slice(0, -4) : fileName;
  const suffix = rangeText.replace(/[^0-9,-]+/g, '').replace(/,+/g, '-');
  return `${baseName}_pages_${suffix || 'selected'}.pdf`;
}

async function getPdfPageCount(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    ...PDF_DOCUMENT_OPTIONS,
  }).promise;
  const pageCount = pdf.numPages;
  await pdf.destroy();
  return pageCount;
}

async function createPdfWithSelectedPages(file: File, pages: number[], outputName: string): Promise<File> {
  const sourcePdf = await PDFDocument.load(await file.arrayBuffer());
  const nextPdf = await PDFDocument.create();
  const copiedPages = await nextPdf.copyPages(sourcePdf, pages.map((page) => page - 1));

  for (const page of copiedPages) {
    nextPdf.addPage(page);
  }

  const pdfBytes = await nextPdf.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  return new File([blob], outputName, { type: 'application/pdf' });
}

async function generateThumbnail(file: File): Promise<Blob> {
  if (file.type === 'application/pdf') {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(arrayBuffer),
      ...PDF_DOCUMENT_OPTIONS,
    }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 0.5 });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;

    await page.render({ canvasContext: ctx, viewport }).promise;
    await pdf.destroy();

    return new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.7);
    });
  }

  // Image thumbnail
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });

    const maxDim = 400;
    const scale = Math.min(maxDim / img.naturalWidth, maxDim / img.naturalHeight, 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.7);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

type SortKey = 'edited' | 'name' | 'created' | 'size';

const SORT_LABELS: Record<SortKey, string> = {
  edited: 'Recently edited',
  name: 'Name',
  created: 'Date added',
  size: 'Size',
};

function getSortValue(doc: Document, key: SortKey): string | number {
  switch (key) {
    case 'name':
      return doc.original_name.toLocaleLowerCase();
    case 'created':
      return parseTimestamp(doc.created_at).getTime();
    case 'size':
      return doc.file_size;
    default:
      return parseTimestamp(doc.last_edited_at ?? doc.updated_at).getTime();
  }
}

function sortDocuments(docs: Document[], key: SortKey): Document[] {
  const direction = key === 'name' ? 1 : -1;
  return [...docs].sort((a, b) => {
    const av = getSortValue(a, key);
    const bv = getSortValue(b, key);
    if (typeof av === 'string' && typeof bv === 'string') {
      return av.localeCompare(bv, undefined, { numeric: true }) * direction;
    }
    return ((av as number) - (bv as number)) * direction;
  });
}

function readStoredSort(): SortKey {
  try {
    const stored = localStorage.getItem('graphite-sort');
    if (stored && stored in SORT_LABELS) return stored as SortKey;
  } catch {
    // storage unavailable; use default
  }
  return 'edited';
}

const FileIcon: React.FC<{ type: Document['file_type']; size?: number }> = ({ type, size = 16 }) => (
  type === 'image' ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
);

const UploadIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

export const DocumentLibrary: React.FC<DocumentLibraryProps> = ({ onDocumentSelect }) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [preparingPdf, setPreparingPdf] = useState(false);
  const [pendingPdfImport, setPendingPdfImport] = useState<{
    file: File;
    pageCount: number;
    rangeText: string;
    error: string | null;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [menuDocId, setMenuDocId] = useState<string | null>(null);
  const [renameDoc, setRenameDoc] = useState<Document | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [recentId, setRecentId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>(readStoredSort);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    try {
      return (localStorage.getItem('graphite-view-mode') as 'grid' | 'list') || 'list';
    } catch {
      return 'list';
    }
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const pageRangeInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const uploading = uploadProgress !== null;
  const busy = uploading || preparingPdf;

  useEffect(() => {
    try {
      localStorage.setItem('graphite-view-mode', viewMode);
      localStorage.setItem('graphite-sort', sortKey);
    } catch {
      // storage unavailable; preferences just won't persist
    }
  }, [viewMode, sortKey]);

  const loadDocuments = useCallback(async () => {
    try {
      const docs = await listDocuments();
      setDocuments(docs);
      setLoadFailed(false);
    } catch (err) {
      console.error('Failed to load documents:', err);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const visibleDocuments = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = needle
      ? documents.filter((doc) => doc.original_name.toLocaleLowerCase().includes(needle))
      : documents;
    return sortDocuments(filtered, sortKey);
  }, [documents, query, sortKey]);

  // "/" focuses search, like most document browsers.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!menuDocId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) {
        return;
      }
      setMenuDocId(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuDocId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuDocId]);

  useEffect(() => {
    if (!renameDoc) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    // Select just the base name so typing replaces it but keeps the extension.
    const dot = renameDoc.original_name.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : renameDoc.original_name.length);
  }, [renameDoc]);

  useEffect(() => {
    if (!pendingPdfImport) return;
    pageRangeInputRef.current?.focus();
    pageRangeInputRef.current?.select();
    // Only on open, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPdfImport?.file]);

  useEffect(() => {
    if (!recentId) return;
    const timer = setTimeout(() => setRecentId(null), 2400);
    return () => clearTimeout(timer);
  }, [recentId]);

  /** Uploads one file; returns the new document or null (after telling the user why). */
  const uploadOne = useCallback(async (file: File): Promise<Document | null> => {
    try {
      const doc = await uploadDocument(file);
      setDocuments((prev) => [{ ...doc, last_edited_at: doc.updated_at }, ...prev.filter((d) => d.id !== doc.id)]);

      generateThumbnail(file)
        .then((blob) => uploadThumbnail(doc.id, blob))
        .then(() => loadDocuments())
        .catch((err) => console.error('Thumbnail generation failed:', err));

      return doc;
    } catch (err) {
      console.error('Upload failed:', err);
      toast.error(`Couldn’t upload ${file.name}`, errorMessage(err, 'Please try again.'));
      return null;
    }
  }, [loadDocuments]);

  const uploadFiles = useCallback(async (files: File[]) => {
    setUploadProgress({ done: 0, total: files.length });
    const uploaded: Document[] = [];
    try {
      for (const file of files) {
        const doc = await uploadOne(file);
        if (doc) uploaded.push(doc);
        setUploadProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
    } finally {
      setUploadProgress(null);
    }

    if (uploaded.length === 1) {
      setRecentId(uploaded[0].id);
      toast.success(`Added ${uploaded[0].original_name}`);
    } else if (uploaded.length > 1) {
      toast.success(`Added ${pluralize(uploaded.length, 'document')}`);
    }
    if (uploaded.length > 0 && query) setQuery('');
    return uploaded.length === files.length;
  }, [uploadOne, query]);

  const handleFiles = useCallback(async (incoming: File[]) => {
    if (busy || incoming.length === 0) return;
    const accepted = incoming.filter((f) => ACCEPTED_TYPES.has(f.type));
    const skipped = incoming.length - accepted.length;

    if (skipped > 0) {
      toast.error(
        skipped === incoming.length ? 'That file type isn’t supported' : `Skipped ${pluralize(skipped, 'unsupported file')}`,
        'Graphite accepts PDF, PNG, JPG and WebP files.',
      );
    }
    if (accepted.length === 0) return;

    // Several files at once: import everything without per-file prompts.
    if (accepted.length > 1 || accepted[0].type !== 'application/pdf') {
      await uploadFiles(accepted);
      return;
    }

    const file = accepted[0];
    setPreparingPdf(true);
    try {
      const pageCount = await getPdfPageCount(file);
      if (pageCount <= 1) {
        await uploadFiles([file]);
        return;
      }
      setPendingPdfImport({ file, pageCount, rangeText: `1-${pageCount}`, error: null });
    } catch (err) {
      console.error('Failed to inspect PDF:', err);
      toast.error(`Couldn’t read ${file.name}`, 'The file may be damaged or password-protected.');
    } finally {
      setPreparingPdf(false);
    }
  }, [busy, uploadFiles]);

  const handlePdfImportSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pendingPdfImport) return;

    const { pages, error } = parsePageRange(pendingPdfImport.rangeText, pendingPdfImport.pageCount);
    if (error) {
      setPendingPdfImport((current) => current ? { ...current, error } : current);
      return;
    }

    try {
      const isAllPages = pages.length === pendingPdfImport.pageCount &&
        pages.every((page, index) => page === index + 1);
      const fileToUpload = isAllPages
        ? pendingPdfImport.file
        : await createPdfWithSelectedPages(
          pendingPdfImport.file,
          pages,
          createSelectedPdfName(pendingPdfImport.file.name, pendingPdfImport.rangeText),
        );

      const success = await uploadFiles([fileToUpload]);
      if (success) {
        setPendingPdfImport(null);
      }
    } catch (err) {
      console.error('Failed to prepare selected PDF pages:', err);
      setPendingPdfImport((current) => current ? {
        ...current,
        error: 'Couldn’t prepare the selected pages.',
      } : current);
    }
  }, [pendingPdfImport, uploadFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragOver(false);
    void handleFiles(Array.from(e.dataTransfer.files));
  }, [handleFiles]);

  const handleDelete = useCallback(async (e: React.MouseEvent, doc: Document) => {
    e.stopPropagation();
    setMenuDocId(null);
    const confirmed = await confirmDialog({
      title: 'Delete this document?',
      message: `“${doc.original_name}” and all of its annotations will be permanently deleted.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;

    try {
      await deleteDocument(doc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      toast.success(`Deleted ${doc.original_name}`);
    } catch (err) {
      console.error('Delete failed:', err);
      toast.error('Couldn’t delete document', errorMessage(err, 'Please try again.'));
    }
  }, []);

  const handleDownload = useCallback((e: React.MouseEvent, doc: Document) => {
    e.stopPropagation();
    setMenuDocId(null);

    const link = window.document.createElement('a');
    link.href = getDocumentFileUrl(doc.id);
    link.download = doc.original_name;
    link.rel = 'noopener';
    window.document.body.appendChild(link);
    link.click();
    link.remove();
  }, []);

  const openRenameDialog = useCallback((e: React.MouseEvent, doc: Document) => {
    e.stopPropagation();
    setMenuDocId(null);
    setRenameDoc(doc);
    setRenameValue(doc.original_name);
  }, []);

  const closeRenameDialog = useCallback(() => {
    setRenameDoc(null);
    setRenameValue('');
  }, []);

  const handleRenameSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameDoc) {
      return;
    }

    const nextName = normalizeDocumentName(renameValue, renameDoc.original_name);
    if (!nextName) {
      renameInputRef.current?.focus();
      return;
    }

    if (nextName === renameDoc.original_name) {
      closeRenameDialog();
      return;
    }

    setRenaming(true);
    const previousName = renameDoc.original_name;
    setDocuments((prev) => prev.map((doc) => (
      doc.id === renameDoc.id ? { ...doc, original_name: nextName } : doc
    )));
    try {
      await updateDocument(renameDoc.id, { original_name: nextName });
      closeRenameDialog();
    } catch (err) {
      console.error('Rename failed:', err);
      setDocuments((prev) => prev.map((doc) => (
        doc.id === renameDoc.id ? { ...doc, original_name: previousName } : doc
      )));
      toast.error('Couldn’t rename document', errorMessage(err, 'Please try again.'));
    } finally {
      setRenaming(false);
    }
  }, [closeRenameDialog, renameDoc, renameValue]);

  const openOnKey = (doc: Document) => (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onDocumentSelect(doc);
    }
  };

  const renderMenu = (doc: Document) => (
    <div className="library-menu" role="menu" onClick={(e) => e.stopPropagation()}>
      <button className="library-menu-item" onClick={() => onDocumentSelect(doc)} role="menuitem">
        Open
      </button>
      <button className="library-menu-item" onClick={(e) => openRenameDialog(e, doc)} role="menuitem">
        Rename
      </button>
      <button className="library-menu-item" onClick={(e) => handleDownload(e, doc)} role="menuitem">
        Download original
      </button>
      <div className="library-menu-divider" />
      <button
        className="library-menu-item danger"
        onClick={(e) => handleDelete(e, doc)}
        role="menuitem"
      >
        Delete
      </button>
    </div>
  );

  const renderMenuButton = (doc: Document, className: string) => (
    <button
      className={`${className} ${menuDocId === doc.id ? 'is-open' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        setMenuDocId((current) => (current === doc.id ? null : doc.id));
      }}
      onKeyDown={(e) => e.stopPropagation()}
      title="More actions"
      aria-label={`More actions for ${doc.original_name}`}
      aria-haspopup="menu"
      aria-expanded={menuDocId === doc.id}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="5" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="12" cy="19" r="1.8" />
      </svg>
    </button>
  );

  const renderSortHeader = (key: SortKey, label: string, className: string) => (
    <span
      className={`list-col ${className}`}
      role="columnheader"
      aria-sort={sortKey === key ? (key === 'name' ? 'ascending' : 'descending') : undefined}
    >
      <button
        className={`list-sort-btn${sortKey === key ? ' is-active' : ''}`}
        onClick={() => setSortKey(key)}
        title={`Sort by ${SORT_LABELS[key].toLowerCase()}`}
      >
        {label}
        {sortKey === key && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
            {key === 'name' ? <polyline points="6 15 12 9 18 15" /> : <polyline points="6 9 12 15 18 9" />}
          </svg>
        )}
      </button>
    </span>
  );

  const pendingPdfSelection = pendingPdfImport
    ? parsePageRange(pendingPdfImport.rangeText, pendingPdfImport.pageCount)
    : null;

  const uploadLabel = uploadProgress
    ? (uploadProgress.total > 1 ? `Uploading ${Math.min(uploadProgress.done + 1, uploadProgress.total)} of ${uploadProgress.total}…` : 'Uploading…')
    : preparingPdf ? 'Reading PDF…' : 'Upload';

  const renderContent = () => {
    if (loading) {
      return viewMode === 'list' ? (
        <div className="library-list" aria-busy="true" aria-label="Loading documents">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="library-skeleton-row">
              <span className="library-skeleton library-skeleton--thumb" />
              <span className="library-skeleton" style={{ width: `${40 - i * 4}%` }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="library-grid" aria-busy="true" aria-label="Loading documents">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="library-card library-card--skeleton">
              <div className="library-card-thumbnail library-skeleton" />
              <div className="library-card-info">
                <span className="library-skeleton" style={{ width: '70%' }} />
                <span className="library-skeleton" style={{ width: '45%', marginTop: '0.5rem' }} />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (loadFailed && documents.length === 0) {
      return (
        <div className="library-empty">
          <h2 className="library-empty-title">Couldn’t load your documents</h2>
          <p className="library-empty-hint">Check your connection and try again.</p>
          <button className="g-btn g-btn--secondary" onClick={() => { setLoading(true); void loadDocuments(); }}>
            Retry
          </button>
        </div>
      );
    }

    if (documents.length === 0) {
      return (
        <div className="library-empty">
          <div className="library-empty-icon">
            <FileIcon type="pdf" size={28} />
          </div>
          <h2 className="library-empty-title">Your library is empty</h2>
          <p className="library-empty-hint">
            Upload a PDF or image to start annotating, or drop files anywhere on this page.
          </p>
          <button className="library-upload-btn" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            <UploadIcon />
            {uploadLabel}
          </button>
        </div>
      );
    }

    if (visibleDocuments.length === 0) {
      return (
        <div className="library-empty">
          <h2 className="library-empty-title">No matches</h2>
          <p className="library-empty-hint">Nothing in your library matches “{query.trim()}”.</p>
          <button className="g-btn g-btn--secondary" onClick={() => { setQuery(''); searchInputRef.current?.focus(); }}>
            Clear search
          </button>
        </div>
      );
    }

    if (viewMode === 'list') {
      return (
        <div className="library-list" role="table" aria-label="Documents">
          <div className="library-list-header" role="row">
            {renderSortHeader('name', 'Name', 'col-name')}
            <span className="list-col col-pages" role="columnheader">Pages</span>
            {renderSortHeader('size', 'Size', 'col-size')}
            {renderSortHeader('edited', 'Edited', 'col-modified')}
            {renderSortHeader('created', 'Added', 'col-created')}
            <span className="list-col col-actions" role="columnheader"><span className="visually-hidden">Actions</span></span>
          </div>
          {visibleDocuments.map((doc) => (
            <div
              key={doc.id}
              className={`library-list-row${recentId === doc.id ? ' is-new' : ''}${menuDocId === doc.id ? ' has-menu' : ''}`}
              role="row"
              tabIndex={0}
              onClick={() => onDocumentSelect(doc)}
              onKeyDown={openOnKey(doc)}
              aria-label={`Open ${doc.original_name}`}
            >
              <span className="list-col col-name" role="cell">
                <span className="list-thumb" aria-hidden="true">
                  {doc.thumbnail_path ? (
                    <img src={getDocumentThumbnailUrl(doc.id)} alt="" loading="lazy" />
                  ) : (
                    <FileIcon type={doc.file_type} size={14} />
                  )}
                </span>
                <span className="list-name-text" title={doc.original_name}>
                  {doc.original_name}
                </span>
              </span>
              <span className="list-col col-pages" role="cell">{doc.file_type === 'image' ? 'Image' : (doc.page_count ?? '–')}</span>
              <span className="list-col col-size" role="cell">{formatFileSize(doc.file_size)}</span>
              <span className="list-col col-modified" role="cell" title={formatDate(doc.last_edited_at ?? doc.updated_at)}>
                {formatRelative(doc.last_edited_at ?? doc.updated_at)}
              </span>
              <span className="list-col col-created" role="cell">{formatDate(doc.created_at)}</span>
              <div
                className="list-col col-actions"
                role="cell"
                ref={menuDocId === doc.id ? menuRef : null}
              >
                {renderMenuButton(doc, 'library-list-menu-btn')}
                {menuDocId === doc.id && renderMenu(doc)}
              </div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="library-grid">
        {visibleDocuments.map((doc, index) => (
          <div
            key={doc.id}
            className={`library-card${recentId === doc.id ? ' is-new' : ''}${menuDocId === doc.id ? ' has-menu' : ''}`}
            style={{ '--card-i': Math.min(index, 12) } as React.CSSProperties}
            tabIndex={0}
            onClick={() => onDocumentSelect(doc)}
            onKeyDown={openOnKey(doc)}
            aria-label={`Open ${doc.original_name}`}
          >
            <div className="library-card-thumbnail">
              {doc.thumbnail_path ? (
                <img
                  src={getDocumentThumbnailUrl(doc.id)}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="library-card-placeholder">
                  <FileIcon type={doc.file_type} size={32} />
                </div>
              )}
            </div>
            <div className="library-card-info">
              <div className="library-card-name" title={doc.original_name}>
                {doc.original_name}
              </div>
              <div className="library-card-meta">
                {doc.file_type === 'pdf' && doc.page_count != null && <span>{pluralize(doc.page_count, 'page')}</span>}
                {doc.file_type === 'image' && <span>Image</span>}
                <span>{formatFileSize(doc.file_size)}</span>
                <span title={formatDate(doc.last_edited_at ?? doc.updated_at)}>
                  {formatRelative(doc.last_edited_at ?? doc.updated_at)}
                </span>
              </div>
            </div>
            <div
              className="library-card-menu-container"
              ref={menuDocId === doc.id ? menuRef : null}
            >
              {renderMenuButton(doc, 'library-card-menu-button')}
              {menuDocId === doc.id && renderMenu(doc)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      className={`library-container ${dragOver ? 'is-dragging' : ''}`}
      onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setDragOver(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false); } }}
      onDrop={handleDrop}
    >
      <div className="library-toolbar">
        <div className="library-toolbar-left">
          <h2 className="library-title">
            Documents
            {!loading && documents.length > 0 && <span className="library-count">{documents.length}</span>}
          </h2>
        </div>

        <div className="library-toolbar-right">
          {documents.length > 0 && (
            <>
              <div className="library-search">
                <svg className="library-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={searchInputRef}
                  className="library-search-input"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setQuery('');
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="Search"
                  aria-label="Search documents"
                />
                {!query && <kbd className="g-kbd library-search-kbd" aria-hidden="true">/</kbd>}
              </div>

              <label className="library-sort">
                <span className="visually-hidden">Sort by</span>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                    <option key={key} value={key}>{SORT_LABELS[key]}</option>
                  ))}
                </select>
              </label>

              <div className="library-view-toggle" role="group" aria-label="View">
                <button
                  className={viewMode === 'list' ? 'active' : ''}
                  onClick={() => setViewMode('list')}
                  title="List view"
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <line x1="4" y1="6" x2="20" y2="6" />
                    <line x1="4" y1="12" x2="20" y2="12" />
                    <line x1="4" y1="18" x2="20" y2="18" />
                  </svg>
                </button>
                <button
                  className={viewMode === 'grid' ? 'active' : ''}
                  onClick={() => setViewMode('grid')}
                  title="Grid view"
                  aria-label="Grid view"
                  aria-pressed={viewMode === 'grid'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                </button>
              </div>
            </>
          )}

          <button
            className="library-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            aria-label={uploadLabel}
          >
            {busy ? <span className="g-spinner g-spinner--sm library-upload-spinner" /> : <UploadIcon />}
            <span className="library-upload-label">{uploadLabel}</span>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_STRING}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void handleFiles(files);
          }}
        />
      </div>

      {dragOver && (
        <div className="library-drop-overlay">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>Drop to upload</span>
          <span className="library-drop-overlay-hint">PDF, PNG, JPG or WebP</span>
        </div>
      )}

      {renderContent()}

      {pendingPdfImport && (
        <Modal
          title="Import pages"
          description={<>
            <strong>{pendingPdfImport.file.name}</strong> has {pendingPdfImport.pageCount} pages. Import them all, or pick a subset.
          </>}
          onClose={() => setPendingPdfImport(null)}
          busy={uploading}
          width={460}
        >
          <form className="g-form" onSubmit={handlePdfImportSubmit}>
            <label className="g-field">
              Pages
              <input
                ref={pageRangeInputRef}
                className="g-input"
                value={pendingPdfImport.rangeText}
                onChange={(event) => setPendingPdfImport((current) => current ? {
                  ...current,
                  rangeText: event.target.value,
                  error: null,
                } : current)}
                placeholder="1-3, 5, 8"
                disabled={uploading}
                aria-describedby="pdf-page-range-hint"
                aria-invalid={Boolean(pendingPdfImport.error || pendingPdfSelection?.error)}
              />
            </label>
            <div
              id="pdf-page-range-hint"
              className={`library-modal-hint${pendingPdfImport.error || pendingPdfSelection?.error ? ' is-error' : ''}`}
            >
              {pendingPdfImport.error || pendingPdfSelection?.error || (
                `${pendingPdfSelection?.pages.length || 0} of ${pendingPdfImport.pageCount} pages selected · use ranges like 1-3, 5, 8`
              )}
            </div>
            <div className="g-modal-actions">
              <button
                type="button"
                className="g-btn g-btn--secondary"
                onClick={() => setPendingPdfImport(null)}
                disabled={uploading}
              >
                Cancel
              </button>
              <button type="submit" className="g-btn g-btn--primary" disabled={uploading || Boolean(pendingPdfSelection?.error)}>
                {uploading
                  ? 'Importing…'
                  : `Import ${pluralize(pendingPdfSelection?.pages.length || 0, 'page')}`}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {renameDoc && (
        <Modal title="Rename document" onClose={closeRenameDialog} busy={renaming}>
          <form className="g-form" onSubmit={handleRenameSubmit}>
            <input
              ref={renameInputRef}
              className="g-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Document name"
              aria-label="Document name"
              disabled={renaming}
            />
            <div className="g-modal-actions">
              <button
                type="button"
                className="g-btn g-btn--secondary"
                onClick={closeRenameDialog}
                disabled={renaming}
              >
                Cancel
              </button>
              <button type="submit" className="g-btn g-btn--primary" disabled={renaming || !renameValue.trim()}>
                {renaming ? 'Saving…' : 'Rename'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
