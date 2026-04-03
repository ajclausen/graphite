import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { Excalidraw, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw';
import { pdfjs } from '../utils/pdfWorker';
import { useAnnotationStore, setPendingAnnotations, flushPendingAnnotations } from '../store/annotationStore';
import { ErrorBoundary } from './ErrorBoundary';
import { PDFExporter } from './PDFExporter';
import { PDFPageViewLayer } from './PDFPageViewLayer';
import { ImagePageViewLayer } from './ImagePageViewLayer';
import { getDocumentPdfUrl, getDocumentFileUrl, updateDocument, listDocuments } from '../api/client';
import type { Document } from '../api/client';
import { ThemeToggle } from './ThemeToggle';
import './IntegratedPDFAnnotator.css';

interface IntegratedPDFAnnotatorProps {
  document: Document;
  onBack: () => void;
  onDocumentChange: (doc: Document) => void;
}

export const IntegratedPDFAnnotator: React.FC<IntegratedPDFAnnotatorProps> = ({ document: doc, onBack, onDocumentChange }) => {
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

  const { setAnnotations, getAnnotations, setPageMetric, getPageMetric, saveStatus } = useAnnotationStore();
  const annotationContainerRef = useRef<HTMLDivElement | null>(null);
  const pageElementRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const initialFitDoneRef = useRef(false);
  const [allDocuments, setAllDocuments] = useState<Document[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  const [viewport, setViewport] = useState(defaultViewport);

  // Load PDF from server and annotations
  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
    let loadedDocument: PDFDocumentProxy | null = null;

    setPdfDocument(null);
    setNumPages(null);
    setPageNumber(1);
    setLoadError(null);
    setIsInitialViewportReady(false);
    setViewport(defaultViewport);
    initialFitDoneRef.current = false;

    const store = useAnnotationStore.getState();
    store.setDocumentId(doc.id);

    const loadDocument = async () => {
      try {
        // Load annotations from server
        await store.loadAnnotationsFromServer(doc.id);

        if (isImage) {
          // No PDF to load — image rendering handled by ImagePageViewLayer
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
        setPdfDocument(nextDocument);
        setNumPages(nextDocument.numPages);

        // Update page count if not set
        if (!doc.page_count) {
          updateDocument(doc.id, { page_count: nextDocument.numPages }).catch(console.error);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading document:', error);
          setLoadError(isImage ? 'Failed to load image.' : 'Failed to load PDF.');
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
  }, [doc.id, doc.page_count, isImage]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

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

  // Fetch document list for selector
  useEffect(() => {
    listDocuments().then(setAllDocuments).catch(console.error);
  }, []);

  // Close selector on outside click or Escape
  useEffect(() => {
    if (!selectorOpen) return;
    const handleClick = (e: PointerEvent) => {
      if (!selectorRef.current?.contains(e.target as Node)) {
        setSelectorOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectorOpen(false);
    };
    document.addEventListener('pointerdown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [selectorOpen]);

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

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      const currentStored = getAnnotations(pageNumber);
      if (
        elements.length !== currentStored.length ||
        JSON.stringify(elements) !== JSON.stringify(currentStored)
      ) {
        setAnnotations(pageNumber, elements);
      }
    }, 300);
  }, [pageNumber, setAnnotations, getAnnotations]);

  const getCurrentAnnotations = useCallback((pageNum: number) => {
    return getAnnotations(pageNum);
  }, [getAnnotations]);

  const getPDFTransform = useCallback(() => {
    return {
      transform: `translate(${viewport.scrollX * viewport.zoom}px, ${viewport.scrollY * viewport.zoom}px)`,
      transformOrigin: '0 0',
    };
  }, [viewport]);

  const goToPrevPage = () => {
    flushPendingAnnotations();
    setPageNumber((prev) => Math.max(1, prev - 1));
  };

  const goToNextPage = () => {
    flushPendingAnnotations();
    setPageNumber((prev) => Math.min(numPages || 1, prev + 1));
  };

  const handleDocumentSwitch = useCallback(async (newDoc: Document) => {
    if (newDoc.id === doc.id) {
      setSelectorOpen(false);
      return;
    }
    setSelectorOpen(false);
    await useAnnotationStore.getState().flushAllPendingSaves();
    onDocumentChange(newDoc);
  }, [doc.id, onDocumentChange]);

  const saveStatusText = saveStatus === 'saving' ? 'Saving...'
    : saveStatus === 'saved' ? 'Saved'
    : saveStatus === 'error' ? 'Save failed'
    : '';

  return (
    <div className="integrated-pdf-annotator">
      <div className="main-toolbar">
        <div className="toolbar-left">
          <button onClick={onBack} className="brand-home" title="Back to library">
            <img className="brand-home-mark" src="/graphite-logo.png" alt="Graphite" />
          </button>
          <div className="toolbar-divider" />
          <button onClick={onBack} className="home-button" title="Back to library">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
          <div className="toolbar-divider" />
          <div className="doc-selector" ref={selectorRef}>
            <button
              className={`doc-selector-button ${selectorOpen ? 'is-open' : ''}`}
              onClick={() => setSelectorOpen((prev) => !prev)}
              title={doc.original_name}
            >
              <span className="doc-selector-name">{doc.original_name}</span>
              <svg className="doc-selector-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {selectorOpen && (
              <div className="doc-selector-dropdown">
                <div className="doc-selector-header">Documents</div>
                {allDocuments.length === 0 ? (
                  <div className="doc-selector-empty">No documents</div>
                ) : (
                  allDocuments.map((d) => (
                    <button
                      key={d.id}
                      className={`doc-selector-item ${d.id === doc.id ? 'is-active' : ''}`}
                      onClick={() => handleDocumentSwitch(d)}
                    >
                      <span className="doc-selector-item-name">{d.original_name}</span>
                      {d.page_count != null && (
                        <span className="doc-selector-item-meta">
                          {d.page_count} {d.page_count === 1 ? 'page' : 'pages'}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {saveStatusText && (
            <span className={`save-status save-status-${saveStatus}`}>{saveStatusText}</span>
          )}
        </div>

        <div className="toolbar-center">
          {!isImage && (
            <>
              <button onClick={goToPrevPage} disabled={pageNumber <= 1}>&#8249;</button>
              <span className="page-info">{pageNumber}/{numPages || '...'}</span>
              <button onClick={goToNextPage} disabled={pageNumber >= (numPages || 1)}>&#8250;</button>
            </>
          )}
        </div>

        <div className="toolbar-right">
          <ThemeToggle />
          <PDFExporter documentId={doc.id} originalName={doc.original_name} numPages={numPages || 1} fileType={doc.file_type} />
        </div>
      </div>

      <div className="content-area">
        <div className="annotation-container" ref={annotationContainerRef}>
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
              {loadError ? (
                <div className="loading">{loadError}</div>
              ) : !isInitialViewportReady && !isImage ? (
                <div className="loading">Loading PDF...</div>
              ) : isImage ? (
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

          <div style={{ width: '100%', height: '100%', position: 'relative', zIndex: 2 }}>
            {isInitialViewportReady && (
              <ErrorBoundary fallback={<div style={{ padding: '2rem', color: 'red' }}>Excalidraw failed to load!</div>}>
                <Excalidraw
                  key={`page-${pageNumber}`}
                  initialData={{
                    elements: getCurrentAnnotations(pageNumber),
                    appState: {
                      viewBackgroundColor: 'transparent',
                      theme: 'light',
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
        </div>
      </div>
    </div>
  );
};
