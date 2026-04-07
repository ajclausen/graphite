import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as pdfjs from 'pdfjs-dist';
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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

export const DocumentLibrary: React.FC<DocumentLibraryProps> = ({ onDocumentSelect }) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [menuDocId, setMenuDocId] = useState<string | null>(null);
  const [renameDoc, setRenameDoc] = useState<Document | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('graphite-view-mode') as 'grid' | 'list') || 'list';
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    localStorage.setItem('graphite-view-mode', viewMode);
  }, [viewMode]);

  const loadDocuments = useCallback(async () => {
    try {
      const docs = await listDocuments();
      setDocuments(docs);
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

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
    if (!renameDoc) {
      return;
    }

    renameInputRef.current?.focus();
    renameInputRef.current?.select();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !renaming) {
        setRenameDoc(null);
        setRenameValue('');
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [renameDoc, renaming]);

  const handleUpload = useCallback(async (file: File) => {
    if (!ACCEPTED_TYPES.has(file.type)) {
      alert('Please upload a PDF or image file');
      return;
    }

    setUploading(true);
    try {
      const doc = await uploadDocument(file);

      generateThumbnail(file)
        .then((blob) => uploadThumbnail(doc.id, blob))
        .then(() => loadDocuments())
        .catch((err) => console.error('Thumbnail generation failed:', err));

      await loadDocuments();
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Failed to upload file');
    } finally {
      setUploading(false);
    }
  }, [loadDocuments]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragOver(false);
    const file = Array.from(e.dataTransfer.files).find(f => ACCEPTED_TYPES.has(f.type));
    if (file) handleUpload(file);
  }, [handleUpload]);

  const handleDelete = useCallback(async (e: React.MouseEvent, doc: Document) => {
    e.stopPropagation();
    setMenuDocId(null);
    if (!confirm(`Delete "${doc.original_name}"? This cannot be undone.`)) return;

    try {
      await deleteDocument(doc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete document');
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

  const handleRenameSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameDoc) {
      return;
    }

    const nextName = normalizeDocumentName(renameValue, renameDoc.original_name);
    if (!nextName) {
      alert('Document name cannot be empty.');
      return;
    }

    if (nextName === renameDoc.original_name) {
      setRenameDoc(null);
      setRenameValue('');
      return;
    }

    setRenaming(true);
    try {
      setDocuments((prev) => prev.map((doc) => (
        doc.id === renameDoc.id
          ? { ...doc, original_name: nextName }
          : doc
      )));
      await updateDocument(renameDoc.id, { original_name: nextName });
      await loadDocuments();
      setRenameDoc(null);
      setRenameValue('');
    } catch (err) {
      console.error('Rename failed:', err);
      await loadDocuments();
      alert('Failed to rename document');
    } finally {
      setRenaming(false);
    }
  }, [loadDocuments, renameDoc, renameValue]);

  const renderMenu = (doc: Document) => (
    <div className="library-menu" role="menu" onClick={(e) => e.stopPropagation()}>
      <button className="library-menu-item" onClick={() => onDocumentSelect(doc)} role="menuitem">
        Open
      </button>
      <button className="library-menu-item" onClick={(e) => handleDownload(e, doc)} role="menuitem">
        Export PDF
      </button>
      <button className="library-menu-item" onClick={(e) => openRenameDialog(e, doc)} role="menuitem">
        Rename
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
      title="Document actions"
      aria-label={`Open actions for ${doc.original_name}`}
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

  if (loading) {
    return (
      <div className="library-container">
        <div className="library-loading">Loading documents...</div>
      </div>
    );
  }

  return (
    <div
      className={`library-container ${dragOver ? 'is-dragging' : ''}`}
      onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setDragOver(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false); } }}
      onDrop={handleDrop}
    >
      {/* Toolbar */}
      <div className="library-toolbar">
        <button
          className="library-upload-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_STRING}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = '';
          }}
        />

        <div className="library-view-toggle">
          <button
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
            title="List view"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
          <button
            className={viewMode === 'grid' ? 'active' : ''}
            onClick={() => setViewMode('grid')}
            title="Grid view"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Drop overlay */}
      {dragOver && (
        <div className="library-drop-overlay">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>Drop file to upload</span>
        </div>
      )}

      {/* Content */}
      {documents.length === 0 ? (
        <div className="library-empty">
          <div className="library-empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <h2 className="library-empty-title">No documents yet</h2>
          <p className="library-empty-hint">Upload a PDF or image to get started</p>
        </div>
      ) : viewMode === 'list' ? (
        <div className="library-list">
          <div className="library-list-header">
            <span className="list-col col-name">Name</span>
            <span className="list-col col-pages">Pages</span>
            <span className="list-col col-size">Size</span>
            <span className="list-col col-modified">Modified</span>
            <span className="list-col col-created">Created</span>
            <span className="list-col col-actions"></span>
          </div>
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="library-list-row"
              onClick={() => onDocumentSelect(doc)}
            >
              <span className="list-col col-name">
                {doc.file_type === 'image' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                )}
                <span className="list-name-text" title={doc.original_name}>
                  {doc.original_name}
                </span>
              </span>
              <span className="list-col col-pages">{doc.page_count ?? '-'}</span>
              <span className="list-col col-size">{formatFileSize(doc.file_size)}</span>
              <span className="list-col col-modified">{formatDate(doc.updated_at)}</span>
              <span className="list-col col-created">{formatDate(doc.created_at)}</span>
              <div
                className="list-col col-actions"
                ref={menuDocId === doc.id ? menuRef : null}
              >
                {renderMenuButton(doc, 'library-list-menu-btn')}
                {menuDocId === doc.id && renderMenu(doc)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="library-grid">
          {documents.map((doc, index) => (
            <div
              key={doc.id}
              className="library-card"
              style={{ '--card-i': index } as React.CSSProperties}
              onClick={() => onDocumentSelect(doc)}
            >
              <div className="library-card-thumbnail">
                {doc.thumbnail_path ? (
                  <img
                    src={getDocumentThumbnailUrl(doc.id)}
                    alt={doc.original_name}
                    loading="lazy"
                  />
                ) : (
                  <div className="library-card-placeholder">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="library-card-info">
                <div className="library-card-name" title={doc.original_name}>
                  {doc.original_name}
                </div>
                <div className="library-card-meta">
                  <span>{formatFileSize(doc.file_size)}</span>
                  {doc.page_count && <span>{doc.page_count} pages</span>}
                  <span>{formatDate(doc.created_at)}</span>
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
      )}

      {renameDoc && (
        <div
          className="library-modal-backdrop"
          onClick={() => {
            if (!renaming) {
              setRenameDoc(null);
              setRenameValue('');
            }
          }}
        >
          <div
            className="library-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Rename Document</h2>
            <p>Choose a clearer name for this document.</p>
            <form onSubmit={handleRenameSubmit}>
              <input
                ref={renameInputRef}
                className="library-modal-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="Document name"
                disabled={renaming}
              />
              <div className="library-modal-actions">
                <button
                  type="button"
                  className="library-modal-secondary"
                  onClick={() => {
                    setRenameDoc(null);
                    setRenameValue('');
                  }}
                  disabled={renaming}
                >
                  Cancel
                </button>
                <button type="submit" className="library-modal-primary" disabled={renaming}>
                  {renaming ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
