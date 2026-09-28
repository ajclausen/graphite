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
import { formatDate, formatFileSize, formatRelative, formatRelativeShort, parseTimestamp, pluralize } from '../utils/format';
import { confirmDialog, toast, errorMessage } from '../store/uiStore';
import { PHONE_QUERY, useMediaQuery } from '../utils/useMediaQuery';
import { Modal } from './ui/Modal';
import { Menu, type MenuItemDef } from './ui/Menu';
import { Icon } from './ui/Icon';
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

const DocThumb: React.FC<{ doc: Document; className: string; iconSize: number }> = ({ doc, className, iconSize }) => {
  const [failed, setFailed] = useState(false);
  return (
    <span className={className} aria-hidden="true">
      {doc.thumbnail_path && !failed ? (
        <img src={getDocumentThumbnailUrl(doc.id)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <Icon name={doc.file_type === 'image' ? 'image' : 'file'} size={iconSize} strokeWidth={1.6} />
      )}
    </span>
  );
};

function describeDoc(doc: Document): string {
  const kind = doc.file_type === 'image' ? 'Image' : doc.page_count != null ? pluralize(doc.page_count, 'page') : 'PDF';
  return `${kind} · ${formatFileSize(doc.file_size)} · ${formatRelativeShort(doc.last_edited_at ?? doc.updated_at)}`;
}

/** Plain left-clicks open in-app; modified clicks keep native link behavior (new tab, etc.). */
function isPlainClick(event: React.MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

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
  const [announcement, setAnnouncement] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const pageRangeInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const isPhone = useMediaQuery(PHONE_QUERY);

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

  // Tell screen reader users how many results the search left.
  useEffect(() => {
    if (!query.trim()) {
      setAnnouncement('');
      return;
    }
    const timer = setTimeout(() => {
      setAnnouncement(visibleDocuments.length === 0
        ? 'No matching documents'
        : `${pluralize(visibleDocuments.length, 'matching document')}`);
    }, 400);
    return () => clearTimeout(timer);
  }, [query, visibleDocuments.length]);

  // "/" focuses search, like most document browsers.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  const handleDelete = useCallback(async (doc: Document) => {
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

  const handleDownload = useCallback((doc: Document) => {
    const link = window.document.createElement('a');
    link.href = getDocumentFileUrl(doc.id);
    link.download = doc.original_name;
    link.rel = 'noopener';
    window.document.body.appendChild(link);
    link.click();
    link.remove();
  }, []);

  const closeRenameDialog = useCallback(() => {
    setRenameDoc(null);
    setRenameValue('');
  }, []);

  const handleRenameSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameDoc) return;

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

  const menuItemsFor = (doc: Document): MenuItemDef[] => [
    { id: 'open', label: 'Open', icon: 'open', onSelect: () => onDocumentSelect(doc) },
    {
      id: 'rename',
      label: 'Rename',
      icon: 'pencil',
      onSelect: () => {
        setRenameDoc(doc);
        setRenameValue(doc.original_name);
      },
    },
    { id: 'download', label: 'Download original', icon: 'download', onSelect: () => handleDownload(doc) },
    { id: 'delete', label: 'Delete', icon: 'trash', danger: true, separatorBefore: true, onSelect: () => void handleDelete(doc) },
  ];

  const renderMenu = (doc: Document, className: string) => (
    <Menu
      items={menuItemsFor(doc)}
      header={isPhone ? { title: doc.original_name, subtitle: describeDoc(doc) } : undefined}
      renderTrigger={(props) => (
        <button {...props} className={`g-icon-btn ${className}`} aria-label={`More actions for ${doc.original_name}`}>
          <Icon name="moreVertical" size={18} />
        </button>
      )}
    />
  );

  const openLinkProps = (doc: Document) => ({
    href: `#/d/${encodeURIComponent(doc.id)}`,
    onClick: (event: React.MouseEvent) => {
      if (!isPlainClick(event)) return;
      event.preventDefault();
      onDocumentSelect(doc);
    },
  });

  const pendingPdfSelection = pendingPdfImport
    ? parsePageRange(pendingPdfImport.rangeText, pendingPdfImport.pageCount)
    : null;

  const uploadLabel = uploadProgress
    ? (uploadProgress.total > 1 ? `Uploading ${Math.min(uploadProgress.done + 1, uploadProgress.total)} of ${uploadProgress.total}…` : 'Uploading…')
    : preparingPdf ? 'Reading PDF…' : 'Upload';

  const renderContent = () => {
    if (loading) {
      return (
        <div className={viewMode === 'list' ? 'doc-list' : 'doc-grid'} role="status" aria-label="Loading documents">
          {Array.from({ length: viewMode === 'list' ? 5 : 8 }, (_, i) => (
            viewMode === 'list' ? (
              <div key={i} className="doc-row doc-row--skeleton">
                <span className="g-skeleton doc-row-thumb" />
                <span className="g-skeleton" style={{ height: 12, width: `${45 - i * 5}%` }} />
              </div>
            ) : (
              <div key={i} className="doc-card doc-card--skeleton">
                <span className="g-skeleton doc-card-thumb" />
                <span className="doc-card-body">
                  <span className="g-skeleton" style={{ height: 12, width: '70%' }} />
                  <span className="g-skeleton" style={{ height: 10, width: '45%', marginTop: 8 }} />
                </span>
              </div>
            )
          ))}
        </div>
      );
    }

    if (loadFailed && documents.length === 0) {
      return (
        <div className="g-empty" role="alert">
          <div className="g-empty-icon"><Icon name="alert" size={24} /></div>
          <h2 className="g-empty-title">Couldn’t load your documents</h2>
          <p className="g-empty-text">Check your connection and try again.</p>
          <div className="g-empty-actions">
            <button className="g-btn g-btn--secondary" onClick={() => { setLoading(true); void loadDocuments(); }}>
              Try again
            </button>
          </div>
        </div>
      );
    }

    if (documents.length === 0) {
      return (
        <button type="button" className="library-dropzone" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          <span className="g-empty-icon"><Icon name="upload" size={24} /></span>
          <span className="g-empty-title">Add your first document</span>
          <span className="g-empty-text">
            {isPhone ? 'Tap to choose a PDF or image.' : 'Drop PDFs or images here, or click to browse.'}
          </span>
          <span className="library-dropzone-types">PDF · PNG · JPG · WebP</span>
        </button>
      );
    }

    if (visibleDocuments.length === 0) {
      return (
        <div className="g-empty">
          <div className="g-empty-icon"><Icon name="search" size={24} /></div>
          <h2 className="g-empty-title">No matches</h2>
          <p className="g-empty-text">Nothing in your library matches “{query.trim()}”.</p>
          <div className="g-empty-actions">
            <button className="g-btn g-btn--secondary" onClick={() => { setQuery(''); searchInputRef.current?.focus(); }}>
              Clear search
            </button>
          </div>
        </div>
      );
    }

    if (viewMode === 'list') {
      return (
        <div className="doc-list">
          <div className="doc-list-header" aria-hidden="true">
            <span>Name</span>
            <span>Pages</span>
            <span>Size</span>
            <span>Edited</span>
            <span />
          </div>
          <ul className="doc-list-items" aria-label="Documents">
            {visibleDocuments.map((doc) => (
              <li key={doc.id} className={`doc-row${recentId === doc.id ? ' is-new' : ''}`}>
                <DocThumb doc={doc} className="doc-row-thumb" iconSize={16} />
                <span className="doc-row-main">
                  <a className="doc-row-link" {...openLinkProps(doc)} title={doc.original_name}>
                    {doc.original_name}
                  </a>
                  <span className="doc-row-meta">{describeDoc(doc)}</span>
                </span>
                <span className="doc-row-col">
                  {doc.file_type === 'image' ? 'Image' : (doc.page_count ?? '–')}
                </span>
                <span className="doc-row-col">{formatFileSize(doc.file_size)}</span>
                <span className="doc-row-col" title={formatDate(doc.last_edited_at ?? doc.updated_at)}>
                  {formatRelative(doc.last_edited_at ?? doc.updated_at)}
                </span>
                {renderMenu(doc, 'doc-row-menu')}
              </li>
            ))}
          </ul>
        </div>
      );
    }

    return (
      <ul className="doc-grid" aria-label="Documents">
        {visibleDocuments.map((doc, index) => (
          <li
            key={doc.id}
            className={`doc-card${recentId === doc.id ? ' is-new' : ''}`}
            style={{ '--card-i': Math.min(index, 12) } as React.CSSProperties}
          >
            <DocThumb doc={doc} className="doc-card-thumb" iconSize={32} />
            <span className="doc-card-body">
              <a className="doc-card-link" {...openLinkProps(doc)} title={doc.original_name}>
                {doc.original_name}
              </a>
              <span className="doc-card-meta">{describeDoc(doc)}</span>
            </span>
            {renderMenu(doc, 'doc-card-menu')}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div
      className={`page library${dragOver ? ' is-dragging' : ''}`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        dragCounterRef.current++;
        setDragOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounterRef.current--;
        if (dragCounterRef.current <= 0) {
          dragCounterRef.current = 0;
          setDragOver(false);
        }
      }}
      onDrop={handleDrop}
    >
      <div className="page-header">
        <h1 className="page-title">
          Documents
          {!loading && documents.length > 0 && (
            <span className="g-badge" aria-label={`${documents.length} total`}>{documents.length}</span>
          )}
        </h1>
        <button
          className="g-btn g-btn--primary library-upload"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? <span className="g-spinner g-spinner--sm library-upload-spinner" aria-hidden="true" /> : <Icon name="upload" size={16} />}
          {uploadLabel}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_STRING}
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void handleFiles(files);
          }}
        />
      </div>

      {documents.length > 0 && (
        <div className="library-toolbar" role="search">
          <div className="g-input-wrap g-input-wrap--leading library-search">
            <Icon name="search" size={16} className="g-input-icon" />
            <label htmlFor="library-search" className="visually-hidden">Search documents</label>
            <input
              id="library-search"
              ref={searchInputRef}
              className="g-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.stopPropagation();
                  setQuery('');
                }
              }}
              placeholder="Search documents"
              autoComplete="off"
              enterKeyHint="search"
            />
            {query ? (
              <button type="button" className="g-icon-btn g-input-action" onClick={() => { setQuery(''); searchInputRef.current?.focus(); }} aria-label="Clear search">
                <Icon name="x" size={16} />
              </button>
            ) : (
              !isPhone && <kbd className="g-kbd library-search-kbd" aria-hidden="true">/</kbd>
            )}
          </div>

          <div className="library-toolbar-group">
            <label className="visually-hidden" htmlFor="library-sort">Sort by</label>
            <select id="library-sort" className="g-select library-sort" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>{SORT_LABELS[key]}</option>
              ))}
            </select>

            <div className="g-segmented" role="group" aria-label="Layout">
              <button onClick={() => setViewMode('list')} aria-label="List view" title="List view" aria-pressed={viewMode === 'list'}>
                <Icon name="list" size={17} />
              </button>
              <button onClick={() => setViewMode('grid')} aria-label="Grid view" title="Grid view" aria-pressed={viewMode === 'grid'}>
                <Icon name="grid" size={17} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="visually-hidden" role="status" aria-live="polite">{announcement}</div>

      {dragOver && (
        <div className="library-drop-overlay" aria-hidden="true">
          <Icon name="upload" size={28} />
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
          <form className="g-form g-modal-body" onSubmit={handlePdfImportSubmit}>
            <div className="g-field">
              <label className="g-label" htmlFor="pdf-page-range">Pages</label>
              <input
                id="pdf-page-range"
                ref={pageRangeInputRef}
                className="g-input"
                value={pendingPdfImport.rangeText}
                onChange={(event) => setPendingPdfImport((current) => current ? {
                  ...current,
                  rangeText: event.target.value,
                  error: null,
                } : current)}
                placeholder="1-3, 5, 8"
                inputMode="numeric"
                disabled={uploading}
                aria-describedby="pdf-page-range-hint"
                aria-invalid={Boolean(pendingPdfImport.error || pendingPdfSelection?.error) || undefined}
              />
              <span
                id="pdf-page-range-hint"
                className={`g-hint${pendingPdfImport.error || pendingPdfSelection?.error ? ' is-error' : ''}`}
                aria-live="polite"
              >
                {pendingPdfImport.error || pendingPdfSelection?.error || (
                  `${pendingPdfSelection?.pages.length || 0} of ${pendingPdfImport.pageCount} pages selected. Use ranges like 1-3, 5, 8.`
                )}
              </span>
            </div>
            <div className="g-modal-actions">
              <button type="button" className="g-btn g-btn--secondary" onClick={() => setPendingPdfImport(null)} disabled={uploading}>
                Cancel
              </button>
              <button type="submit" className="g-btn g-btn--primary" disabled={uploading || Boolean(pendingPdfSelection?.error)}>
                {uploading ? 'Importing…' : `Import ${pluralize(pendingPdfSelection?.pages.length || 0, 'page')}`}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {renameDoc && (
        <Modal title="Rename document" onClose={closeRenameDialog} busy={renaming}>
          <form className="g-form g-modal-body" onSubmit={handleRenameSubmit}>
            <div className="g-field">
              <label className="g-label" htmlFor="rename-input">Name</label>
              <input
                id="rename-input"
                ref={renameInputRef}
                className="g-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                disabled={renaming}
                autoComplete="off"
              />
            </div>
            <div className="g-modal-actions">
              <button type="button" className="g-btn g-btn--secondary" onClick={closeRenameDialog} disabled={renaming}>
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
