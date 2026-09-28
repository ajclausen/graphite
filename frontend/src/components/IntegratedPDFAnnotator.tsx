import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { Excalidraw, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw';
import { pdfjs } from '../utils/pdfWorker';
import { useAnnotationStore, setPendingAnnotations, flushPendingAnnotations } from '../store/annotationStore';
import { ErrorBoundary } from './ErrorBoundary';
import { PDFExporter } from './PDFExporter';
import { PDFPageViewLayer } from './PDFPageViewLayer';
import { ImagePageViewLayer } from './ImagePageViewLayer';
import { PDFPageManager } from './PDFPageManager';
import { PDFPageSidebar } from './PDFPageSidebar';
import { getDocumentPdfUrl, getDocumentFileUrl, updateDocument } from '../api/client';
import type { Document } from '../api/client';
import { ThemeToggle } from './ThemeToggle';
import { DocSwitcher } from './DocSwitcher';
import { Icon } from './ui/Icon';
import { useAppTheme } from '../utils/theme';
import { PHONE_QUERY, useMediaQuery } from '../utils/useMediaQuery';
import './ui/ui.css';
import './IntegratedPDFAnnotator.css';

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

const PageNavigator: React.FC<{
  pageNumber: number;
  numPages: number;
  onGoToPage: (page: number) => void;
}> = ({ pageNumber, numPages, onGoToPage }) => {
  const [draft, setDraft] = useState(String(pageNumber));

  useEffect(() => {
    setDraft(String(pageNumber));
  }, [pageNumber]);

  const commit = () => {
    const next = parseInt(draft, 10);
    if (Number.isFinite(next) && next !== pageNumber) {
      onGoToPage(next);
    } else {
      setDraft(String(pageNumber));
    }
  };

  return (
    <div className="page-nav" role="group" aria-label="Page navigation">
      <button
        className="g-icon-btn g-icon-btn--sm page-nav-btn"
        onClick={() => onGoToPage(pageNumber - 1)}
        disabled={pageNumber <= 1}
        title="Previous page (Page Up)"
        aria-label="Previous page"
      >
        <Icon name="chevronLeft" size={16} />
      </button>
      <label className="page-nav-field">
        <span className="visually-hidden">Page</span>
        <input
          className="page-nav-input"
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setDraft(String(pageNumber));
              e.currentTarget.blur();
            }
          }}
          aria-describedby="page-nav-total"
          style={{ width: `${Math.max(2, String(numPages).length) + 1.4}ch` }}
        />
        <span className="page-nav-total" id="page-nav-total">of {numPages}</span>
      </label>
      <button
        className="g-icon-btn g-icon-btn--sm page-nav-btn"
        onClick={() => onGoToPage(pageNumber + 1)}
        disabled={pageNumber >= numPages}
        title="Next page (Page Down)"
        aria-label="Next page"
      >
        <Icon name="chevronRight" size={16} />
      </button>
    </div>
  );
};

const SaveIndicator: React.FC<{ status: 'idle' | 'saving' | 'saved' | 'error' }> = ({ status }) => {
  // "Saved" is reassuring for a moment, then gets out of the way.
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (status !== 'saved') {
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    const timer = setTimeout(() => setShowSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === 'saving') {
    return (
      <span className="save-status save-status-saving" role="status">
        <span className="g-spinner g-spinner--sm" aria-hidden="true" />
        <span className="save-status-text">Saving…</span>
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="save-status save-status-error" role="alert" title="Your changes are kept in this tab and will be retried automatically.">
        <Icon name="alert" size={14} />
        <span className="save-status-text">Not saved · retrying</span>
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className={`save-status save-status-saved${showSaved ? '' : ' is-quiet'}`} role="status" title="All changes saved">
        <Icon name="cloudCheck" size={16} />
        <span className="save-status-text">Saved</span>
      </span>
    );
  }
  return null;
};

interface IntegratedPDFAnnotatorProps {
  document: Document;
  /** Page to open at (from the URL); only read when a document first loads. */
  initialPage?: number;
  onBack: () => void;
  onDocumentChange: (doc: Document) => void;
  onPageChange?: (documentId: string, page: number) => void;
}

export const IntegratedPDFAnnotator: React.FC<IntegratedPDFAnnotatorProps> = ({
  document: doc,
  initialPage,
  onBack,
  onDocumentChange,
  onPageChange,
}) => {
  const isImage = doc.file_type === 'image';
  const defaultStrokeWidth = isImage ? 8 : 2;
  const defaultFontSize = isImage ? 28 : 20;

  const defaultViewport = {
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
    offsetLeft: 0,
    offsetTop: 0,
  };
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isInitialViewportReady, setIsInitialViewportReady] = useState(false);
  const [annotationsReady, setAnnotationsReady] = useState(false);
  const [pageManagerOpen, setPageManagerOpen] = useState(false);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const appTheme = useAppTheme();
  // Desktop: a docked sidebar whose open state is remembered.
  // Phones: a slide-over drawer that always starts closed.
  const [dockedSidebarOpen, setDockedSidebarOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('graphite:pageSidebarOpen') !== 'false';
    } catch {
      return true;
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pageSidebarOpen = isPhone ? drawerOpen : dockedSidebarOpen;
  const togglePageSidebar = useCallback(() => {
    if (isPhone) {
      setDrawerOpen((open) => !open);
    } else {
      setDockedSidebarOpen((open) => {
        try {
          window.localStorage.setItem('graphite:pageSidebarOpen', String(!open));
        } catch {
          // preference just won't persist
        }
        return !open;
      });
    }
  }, [isPhone]);

  useEffect(() => {
    if (!drawerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [drawerOpen]);

  const { getAnnotations, setPageMetric, getPageMetric, saveStatus } = useAnnotationStore();
  const annotationContainerRef = useRef<HTMLDivElement | null>(null);
  const pageElementRef = useRef<HTMLDivElement | null>(null);
  const initialFitDoneRef = useRef(false);
  const pendingPageAfterReloadRef = useRef<number | null>(initialPage ?? null);
  const [knownDocuments, setKnownDocuments] = useState<Document[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const [viewport, setViewport] = useState(defaultViewport);

  // Load PDF from server and annotations
  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
    let loadedDocument: PDFDocumentProxy | null = null;

    setPdfDocument(null);
    setNumPages(null);
    // Cleared only once a load completes, so a cancelled run (StrictMode's
    // double-invoked effects, a quick document switch) doesn't lose it.
    const initialPageNumber = pendingPageAfterReloadRef.current ?? 1;
    setPageNumber(initialPageNumber);
    setLoadError(null);
    setIsInitialViewportReady(false);
    setAnnotationsReady(false);
    setViewport(defaultViewport);
    initialFitDoneRef.current = false;

    const store = useAnnotationStore.getState();
    store.setDocumentId(doc.id);

    const loadDocument = async () => {
      try {
        // Load annotations from server
        await store.loadAnnotationsFromServer(doc.id);
        if (cancelled) return;
        setAnnotationsReady(true);

        if (isImage) {
          // No PDF to load — image rendering handled by ImagePageViewLayer
          pendingPageAfterReloadRef.current = null;
          setNumPages(1);
          // Don't set isInitialViewportReady yet — wait for image dimensions via onImageLoad
          return;
        }

        // Load PDF from server
        const pdfUrl = getDocumentPdfUrl(doc.id);
        loadingTask = pdfjs.getDocument({ url: pdfUrl, withCredentials: true });
        const nextDocument = await loadingTask.promise;

        if (cancelled) {
          await nextDocument.destroy();
          return;
        }

        loadedDocument = nextDocument;
        pendingPageAfterReloadRef.current = null;
        setPdfDocument(nextDocument);
        setNumPages(nextDocument.numPages);
        // A stale URL may point past the end of a document that has since shrunk.
        setPageNumber((page) => Math.min(Math.max(1, page), nextDocument.numPages));

        // Update page count if not set
        if (!doc.page_count) {
          updateDocument(doc.id, { page_count: nextDocument.numPages }).catch(console.error);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading document:', error);
          setLoadError(isImage ? 'This image couldn’t be loaded.' : 'This PDF couldn’t be loaded.');
        }
      }
    };

    void loadDocument();

    return () => {
      cancelled = true;

      if (!isImage) {
        if (loadingTask) {
          void loadingTask.destroy();
        }

        if (loadedDocument) {
          void loadedDocument.destroy();
        }
      }

      // Flush saves and clear document context on unmount
      const currentStore = useAnnotationStore.getState();
      currentStore.flushAllPendingSaves().catch(console.error);
      currentStore.setDocumentId(null);
    };
  }, [doc.id, doc.page_count, doc.updated_at, isImage, reloadKey]);

  // Mirror the current page into the URL so refresh/links reopen it.
  useEffect(() => {
    if (!numPages) return;
    onPageChange?.(doc.id, pageNumber);
  }, [doc.id, numPages, onPageChange, pageNumber]);

  // Flush saves before browser close/refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      flushPendingAnnotations();
      // Use sendBeacon for reliable last-chance saves
      const state = useAnnotationStore.getState();
      if (!state.documentId) return;
      for (const [pageStr, elements] of Object.entries(state.annotations)) {
        const pageNum = parseInt(pageStr, 10);
        const pageMetricsData = state.pageMetrics[pageNum] || null;
        const url = `/api/documents/${state.documentId}/annotations/${pageNum}`;
        const body = JSON.stringify({ elements, pageMetrics: pageMetricsData });
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handlePageLoad = useCallback((page: PDFPageProxy) => {
    const baseViewport = page.getViewport({ scale: 1 });

    setPageMetric(pageNumber, {
      width: baseViewport.width,
      height: baseViewport.height,
    });
  }, [pageNumber, setPageMetric]);

  const handleImageLoad = useCallback((width: number, height: number, sceneWidth: number, sceneHeight: number) => {
    setPageMetric(1, {
      width,
      height,
      sceneWidth,
      sceneHeight,
    });

    if (initialFitDoneRef.current) {
      setIsInitialViewportReady(true);
      return;
    }

    const container = annotationContainerRef.current;
    if (!container || sceneWidth <= 0 || sceneHeight <= 0) {
      initialFitDoneRef.current = true;
      setIsInitialViewportReady(true);
      return;
    }

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const padding = 40;
    const availableWidth = Math.max(1, containerWidth - padding * 2);
    const availableHeight = Math.max(1, containerHeight - padding * 2);
    const fitZoom = Math.max(0.1, Math.min(availableWidth / sceneWidth, availableHeight / sceneHeight));
    const fitScrollX = (containerWidth - sceneWidth * fitZoom) / (2 * fitZoom);
    const fitScrollY = (containerHeight - sceneHeight * fitZoom) / (2 * fitZoom);

    initialFitDoneRef.current = true;
    setViewport(prev => ({ ...prev, scrollX: fitScrollX, scrollY: fitScrollY, zoom: fitZoom }));
    setIsInitialViewportReady(true);
  }, [setPageMetric]);

  useEffect(() => {
    if (isImage) return;

    if (!pdfDocument) {
      return;
    }

    if (initialFitDoneRef.current) {
      setIsInitialViewportReady(true);
      return;
    }

    const container = annotationContainerRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;

    const fitInitialViewport = async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const pageWidth = baseViewport.width;
        const pageHeight = baseViewport.height;
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        setPageMetric(pageNumber, {
          width: pageWidth,
          height: pageHeight,
        });

        if (pageWidth <= 0 || pageHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
          initialFitDoneRef.current = true;
          setIsInitialViewportReady(true);
          return;
        }

        const padding = 40;
        const availableWidth = Math.max(1, containerWidth - padding * 2);
        const availableHeight = Math.max(1, containerHeight - padding * 2);
        const fitZoom = Math.max(0.1, Math.min(availableWidth / pageWidth, availableHeight / pageHeight));
        const fitScrollX = (containerWidth - pageWidth * fitZoom) / (2 * fitZoom);
        const fitScrollY = (containerHeight - pageHeight * fitZoom) / (2 * fitZoom);

        initialFitDoneRef.current = true;
        setViewport((prev) => ({
          ...prev,
          scrollX: fitScrollX,
          scrollY: fitScrollY,
          zoom: fitZoom,
        }));
        setIsInitialViewportReady(true);
      } catch (error) {
        console.error('Error fitting initial PDF viewport:', error);
        initialFitDoneRef.current = true;
        setIsInitialViewportReady(true);
      }
    };

    void fitInitialViewport();

    return () => {
      cancelled = true;
    };
  }, [isImage, pageNumber, pdfDocument, setPageMetric]);

  useEffect(() => {
    if (!pageElementRef.current || viewport.zoom <= 0) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (!pageElementRef.current) {
        return;
      }

      const pageRect = pageElementRef.current.getBoundingClientRect();
      if (pageRect.width <= 0 || pageRect.height <= 0) {
        return;
      }

      const topLeft = viewportCoordsToSceneCoords(
        { clientX: pageRect.left, clientY: pageRect.top },
        {
          zoom: { value: viewport.zoom as any },
          offsetLeft: viewport.offsetLeft,
          offsetTop: viewport.offsetTop,
          scrollX: viewport.scrollX,
          scrollY: viewport.scrollY,
        },
      );

      const bottomRight = viewportCoordsToSceneCoords(
        { clientX: pageRect.right, clientY: pageRect.bottom },
        {
          zoom: { value: viewport.zoom as any },
          offsetLeft: viewport.offsetLeft,
          offsetTop: viewport.offsetTop,
          scrollX: viewport.scrollX,
          scrollY: viewport.scrollY,
        },
      );

      const sceneWidth = bottomRight.x - topLeft.x;
      const sceneHeight = bottomRight.y - topLeft.y;
      const currentMetric = getPageMetric(pageNumber);

      if (
        !currentMetric ||
        Math.abs((currentMetric.sceneX ?? 0) - topLeft.x) > 0.5 ||
        Math.abs((currentMetric.sceneY ?? 0) - topLeft.y) > 0.5 ||
        Math.abs((currentMetric.sceneWidth ?? 0) - sceneWidth) > 0.5 ||
        Math.abs((currentMetric.sceneHeight ?? 0) - sceneHeight) > 0.5
      ) {
        setPageMetric(pageNumber, {
          sceneX: topLeft.x,
          sceneY: topLeft.y,
          sceneWidth,
          sceneHeight,
        });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [pageNumber, viewport, getPageMetric, setPageMetric]);

  const handleAnnotationsChange = useCallback((elements: readonly any[]) => {
    setPendingAnnotations(pageNumber, elements);
  }, [pageNumber]);

  const getCurrentAnnotations = useCallback((pageNum: number) => {
    return getAnnotations(pageNum);
  }, [getAnnotations]);

  const getPDFTransform = useCallback(() => {
    return {
      transform: `translate(${viewport.scrollX * viewport.zoom}px, ${viewport.scrollY * viewport.zoom}px)`,
      transformOrigin: '0 0',
    };
  }, [viewport]);

  const goToPage = useCallback((nextPage: number) => {
    if (!numPages) return;
    flushPendingAnnotations();
    setPageNumber(Math.min(numPages, Math.max(1, nextPage)));
  }, [numPages]);

  // Page Up / Page Down flip pages (arrow keys belong to Excalidraw for nudging).
  // Excalidraw also binds these keys to scroll the canvas, so claim them in the
  // capture phase; otherwise the new page opens scrolled a screen off-page.
  useEffect(() => {
    if (isImage || !numPages || numPages < 2) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'PageDown' && event.key !== 'PageUp') return;
      if (isTypingTarget(event.target) || pageManagerOpen) return;
      event.preventDefault();
      event.stopPropagation();
      goToPage(pageNumber + (event.key === 'PageDown' ? 1 : -1));
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [goToPage, isImage, numPages, pageNumber, pageManagerOpen]);

  const handleDocumentUpdatedFromManager = useCallback((updatedDoc: Document, nextPage: number) => {
    pendingPageAfterReloadRef.current = nextPage;
    onDocumentChange(updatedDoc);
  }, [onDocumentChange]);

  const handleDocumentCreatedFromManager = useCallback((newDoc: Document) => {
    setKnownDocuments((prev) => [newDoc, ...prev.filter((item) => item.id !== newDoc.id)]);
  }, []);

  const handleDocumentSwitch = useCallback(async (newDoc: Document) => {
    if (newDoc.id === doc.id) return;
    await useAnnotationStore.getState().flushAllPendingSaves();
    onDocumentChange(newDoc);
  }, [doc.id, onDocumentChange]);

  const handleSidebarGoToPage = useCallback((page: number) => {
    goToPage(page);
    if (isPhone) setDrawerOpen(false);
  }, [goToPage, isPhone]);

  return (
    <div className="annotator">
      <header className="annotator-bar">
        <h1 className="visually-hidden">{doc.original_name}</h1>
        <div className="annotator-bar-start">
          <button onClick={onBack} className="g-icon-btn" title="Back to documents" aria-label="Back to documents">
            <Icon name="arrowLeft" size={18} />
          </button>
          {!isImage && (
            <button
              onClick={togglePageSidebar}
              className="g-icon-btn"
              title={pageSidebarOpen ? 'Hide pages' : 'Show pages'}
              aria-label="Page thumbnails"
              aria-pressed={pageSidebarOpen}
              aria-controls={pageSidebarOpen && numPages ? 'page-sidebar' : undefined}
            >
              <Icon name="sidebar" size={18} />
            </button>
          )}
          <DocSwitcher current={doc} knownDocuments={knownDocuments} onSelect={(d) => void handleDocumentSwitch(d)} />
          <SaveIndicator status={saveStatus} />
        </div>

        <div className="annotator-bar-center">
          {!isImage && numPages ? (
            <PageNavigator pageNumber={pageNumber} numPages={numPages} onGoToPage={goToPage} />
          ) : null}
        </div>

        <div className="annotator-bar-end">
          {!isImage && (
            <button
              className="g-btn g-btn--ghost g-btn--sm annotator-pages-btn"
              onClick={() => setPageManagerOpen(true)}
              disabled={!numPages}
              title="Reorder, rotate, insert or delete pages"
              aria-label="Pages"
              aria-haspopup="dialog"
            >
              <Icon name="pages" size={17} />
              <span className="annotator-btn-label">Pages</span>
            </button>
          )}
          <ThemeToggle className="annotator-theme-toggle" />
          <PDFExporter documentId={doc.id} originalName={doc.original_name} numPages={numPages || 1} fileType={doc.file_type} />
        </div>
      </header>

      <div className="annotator-body">
        {!isImage && numPages && pageSidebarOpen ? (
          <>
            {isPhone && <div className="annotator-drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
            <PDFPageSidebar
              documentId={doc.id}
              documentUpdatedAt={doc.updated_at}
              pdfDocument={pdfDocument}
              numPages={numPages}
              currentPage={pageNumber}
              onGoToPage={handleSidebarGoToPage}
              variant={isPhone ? 'drawer' : 'docked'}
              onClose={isPhone ? () => setDrawerOpen(false) : undefined}
            />
          </>
        ) : null}
        <main className="annotation-container" id="main" tabIndex={-1} ref={annotationContainerRef} aria-label="Annotation canvas">
          <div
            className="pdf-background"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                ...getPDFTransform(),
                zIndex: 1,
                pointerEvents: 'none',
                willChange: 'transform',
              }}
            >
              {loadError || (!isInitialViewportReady && !isImage) ? null : isImage ? (
                <ImagePageViewLayer
                  imageUrl={getDocumentFileUrl(doc.id)}
                  zoom={viewport.zoom}
                  pageElementRef={pageElementRef}
                  onImageLoad={handleImageLoad}
                />
              ) : (
                <PDFPageViewLayer
                  pdfDocument={pdfDocument}
                  pageNumber={pageNumber}
                  viewport={viewport}
                  pageElementRef={pageElementRef}
                  viewportContainerRef={annotationContainerRef}
                  onPageLoad={handlePageLoad}
                />
              )}
            </div>
          </div>

          {(loadError || !isInitialViewportReady) && (
            <div className="annotator-overlay" role={loadError ? 'alert' : 'status'}>
              {loadError ? (
                <div className="annotator-overlay-card">
                  <h2>{loadError}</h2>
                  <p>The file may be damaged, or the server may be unreachable.</p>
                  <div className="annotator-overlay-actions">
                    <button className="g-btn g-btn--secondary" onClick={onBack}>Back to documents</button>
                    <button className="g-btn g-btn--primary" onClick={() => setReloadKey((k) => k + 1)}>Try again</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="g-spinner" />
                  <span className="annotator-overlay-label">Loading {isImage ? 'image' : 'document'}…</span>
                </>
              )}
            </div>
          )}

          <div style={{ width: '100%', height: '100%', position: 'relative', zIndex: 2 }}>
            {isInitialViewportReady && annotationsReady && (
              <ErrorBoundary
                fallback={(
                  <div className="annotator-overlay" role="alert">
                    <div className="annotator-overlay-card">
                      <h2>The drawing tools failed to load</h2>
                      <p>Your saved annotations are safe. Reloading the page usually fixes this.</p>
                      <div className="annotator-overlay-actions">
                        <button className="g-btn g-btn--secondary" onClick={onBack}>Back to documents</button>
                        <button className="g-btn g-btn--primary" onClick={() => window.location.reload()}>Reload</button>
                      </div>
                    </div>
                  </div>
                )}
              >
                <Excalidraw
                  key={`${doc.id}-page-${pageNumber}`}
                  theme={appTheme}
                  initialData={{
                    elements: getCurrentAnnotations(pageNumber),
                    appState: {
                      viewBackgroundColor: 'transparent',
                      currentItemStrokeWidth: defaultStrokeWidth,
                      currentItemFontSize: defaultFontSize,
                      scrollX: viewport.scrollX,
                      scrollY: viewport.scrollY,
                      zoom: { value: viewport.zoom as any },
                    },
                  }}
                  onChange={(elements, appState) => {
                    if (appState && appState.scrollX !== undefined && appState.scrollY !== undefined) {
                      const zoom = typeof appState.zoom === 'object' && 'value' in appState.zoom
                        ? appState.zoom.value
                        : (typeof appState.zoom === 'number' ? appState.zoom : 1);

                      const newViewport = {
                        scrollX: appState.scrollX,
                        scrollY: appState.scrollY,
                        zoom,
                        offsetLeft: appState.offsetLeft ?? viewport.offsetLeft,
                        offsetTop: appState.offsetTop ?? viewport.offsetTop,
                      };

                      if (
                        Math.abs(newViewport.scrollX - viewport.scrollX) > 0.1 ||
                        Math.abs(newViewport.scrollY - viewport.scrollY) > 0.1 ||
                        Math.abs(newViewport.zoom - viewport.zoom) > 0.001 ||
                        Math.abs(newViewport.offsetLeft - viewport.offsetLeft) > 0.1 ||
                        Math.abs(newViewport.offsetTop - viewport.offsetTop) > 0.1
                      ) {
                        setViewport(newViewport);
                      }
                    }

                    handleAnnotationsChange(elements);
                  }}
                  UIOptions={{
                    canvasActions: {
                      changeViewBackgroundColor: false,
                      clearCanvas: true,
                      export: false,
                      loadScene: false,
                      saveToActiveFile: false,
                      toggleTheme: false,
                    },
                  }}
                />
              </ErrorBoundary>
            )}
          </div>
        </main>
      </div>

      {pageManagerOpen && !isImage && numPages && (
        <PDFPageManager
          document={doc}
          pdfDocument={pdfDocument}
          numPages={numPages}
          currentPage={pageNumber}
          onClose={() => setPageManagerOpen(false)}
          onGoToPage={goToPage}
          onDocumentUpdated={handleDocumentUpdatedFromManager}
          onDocumentCreated={handleDocumentCreatedFromManager}
        />
      )}
    </div>
  );
};
