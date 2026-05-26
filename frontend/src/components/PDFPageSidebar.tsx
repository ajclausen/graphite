import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import './PDFPageSidebar.css';

interface PDFPageSidebarProps {
  documentId: string;
  documentUpdatedAt: string;
  pdfDocument: PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;
  onGoToPage: (page: number) => void;
}

interface CachedThumbnail {
  bitmap: ImageBitmap;
  cssWidth: number;
  cssHeight: number;
}

const THUMBNAIL_CACHE = new Map<string, CachedThumbnail>();
const MAX_CACHE_ENTRIES = 300;

function cacheKey(documentId: string, updatedAt: string, pageNumber: number): string {
  return `${documentId}::${updatedAt}::${pageNumber}`;
}

function putCacheEntry(key: string, entry: CachedThumbnail) {
  if (THUMBNAIL_CACHE.size >= MAX_CACHE_ENTRIES) {
    const oldest = THUMBNAIL_CACHE.keys().next().value;
    if (oldest !== undefined) {
      THUMBNAIL_CACHE.get(oldest)?.bitmap.close();
      THUMBNAIL_CACHE.delete(oldest);
    }
  }
  THUMBNAIL_CACHE.set(key, entry);
}

interface SidebarThumbnailProps {
  documentId: string;
  documentUpdatedAt: string;
  pdfDocument: PDFDocumentProxy | null;
  pageNumber: number;
  active: boolean;
  onGoToPage: (page: number) => void;
}

const SidebarThumbnailInner: React.FC<SidebarThumbnailProps> = ({
  documentId,
  documentUpdatedAt,
  pdfDocument,
  pageNumber,
  active,
  onGoToPage,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [renderState, setRenderState] = useState<'loading' | 'ready' | 'error'>('loading');

  const handleClick = useCallback(() => {
    onGoToPage(pageNumber);
  }, [onGoToPage, pageNumber]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    const paintFromCache = (entry: CachedThumbnail): boolean => {
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return false;
      canvas.width = entry.bitmap.width;
      canvas.height = entry.bitmap.height;
      canvas.style.width = `${entry.cssWidth}px`;
      canvas.style.height = `${entry.cssHeight}px`;
      context.drawImage(entry.bitmap, 0, 0);
      return true;
    };

    const drawThumbnail = async () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const key = cacheKey(documentId, documentUpdatedAt, pageNumber);
      const cached = THUMBNAIL_CACHE.get(key);
      if (cached) {
        if (paintFromCache(cached)) {
          setRenderState('ready');
          return;
        }
      }

      if (!pdfDocument) {
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
        const maxWidth = 180;
        const maxHeight = 220;
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

        if (cancelled) return;

        setRenderState('ready');

        try {
          const bitmap = await createImageBitmap(canvas);
          if (cancelled) {
            bitmap.close();
            return;
          }
          putCacheEntry(key, { bitmap, cssWidth, cssHeight });
        } catch {
          // ImageBitmap creation failed — non-fatal, thumbnail is still painted.
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to render sidebar thumbnail:', error);
          setRenderState('error');
        }
      }
    };

    void drawThumbnail();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDocument, pageNumber, documentId, documentUpdatedAt]);

  useEffect(() => {
    if (active && buttonRef.current) {
      buttonRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [active]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`pdf-sidebar-thumbnail${active ? ' is-active' : ''}`}
      onClick={handleClick}
      title={`Page ${pageNumber}`}
    >
      <div className="pdf-sidebar-thumbnail-canvas-wrap">
        <canvas ref={canvasRef} />
        {renderState !== 'ready' && (
          <span className="pdf-sidebar-thumbnail-state">
            {renderState === 'error' ? 'Preview failed' : 'Rendering...'}
          </span>
        )}
      </div>
      <span className="pdf-sidebar-thumbnail-label">{pageNumber}</span>
    </button>
  );
};

const SidebarThumbnail = React.memo(SidebarThumbnailInner);

export const PDFPageSidebar: React.FC<PDFPageSidebarProps> = ({
  documentId,
  documentUpdatedAt,
  pdfDocument,
  numPages,
  currentPage,
  onGoToPage,
}) => {
  const pages = Array.from({ length: numPages }, (_, index) => index + 1);

  return (
    <aside className="pdf-page-sidebar" aria-label="Page thumbnails">
      <div className="pdf-page-sidebar-header">Pages</div>
      <div className="pdf-page-sidebar-list">
        {pages.map((page) => (
          <SidebarThumbnail
            key={page}
            documentId={documentId}
            documentUpdatedAt={documentUpdatedAt}
            pdfDocument={pdfDocument}
            pageNumber={page}
            active={page === currentPage}
            onGoToPage={onGoToPage}
          />
        ))}
      </div>
    </aside>
  );
};
