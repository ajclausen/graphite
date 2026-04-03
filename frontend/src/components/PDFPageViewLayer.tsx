import React, { useCallback, useEffect, useRef } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { pdfjs } from '../utils/pdfWorker';

interface PDFPageViewLayerProps {
  pdfDocument: PDFDocumentProxy | null;
  pageNumber: number;
  viewport: {
    scrollX: number;
    scrollY: number;
    zoom: number;
  };
  pageElementRef: React.MutableRefObject<HTMLDivElement | null>;
  viewportContainerRef: React.MutableRefObject<HTMLDivElement | null>;
  onPageLoad?: (page: PDFPageProxy) => void;
}

type PDFPageViewerModule = typeof import('pdfjs-dist/web/pdf_viewer.mjs');

const PDF_VIEWER_DRAW_DELAY_MS = 280;
const MAX_VIEWER_CANVAS_PIXELS = 48_000_000;
const MAX_VIEWER_CANVAS_DIMENSION = 12_288;
const MIN_REDRAW_SCALE_DELTA = 0.18;
const DETAIL_TILE_MIN_ZOOM = 1.75;
const DETAIL_TILE_DRAW_DELAY_MS = 220;
const DETAIL_TILE_MAX_PIXELS = 18_000_000;
const DETAIL_TILE_MAX_DIMENSION = 6_144;
const DETAIL_TILE_MAX_UPSCALE = 2.5;
const DETAIL_TILE_OVERSCAN_CSS_PX = 96;
const TEXT_LAYER_DISABLED = 0;
const MIN_ZOOM = 0.1;
const PDF_TO_CSS_UNITS = pdfjs.PixelsPerInch.PDF_TO_CSS_UNITS;

let pdfPageViewerModulePromise: Promise<PDFPageViewerModule> | null = null;

async function loadPdfPageViewerModule() {
  (globalThis as typeof globalThis & { pdfjsLib?: typeof pdfjs }).pdfjsLib = pdfjs;

  if (!pdfPageViewerModulePromise) {
    pdfPageViewerModulePromise = import('pdfjs-dist/web/pdf_viewer.mjs');
  }

  return pdfPageViewerModulePromise;
}

function safeZoom(zoom: number) {
  return Math.max(MIN_ZOOM, zoom);
}

function getSafeMaxCanvasPixels(width: number, height: number) {
  if (width <= 0 || height <= 0) {
    return MAX_VIEWER_CANVAS_PIXELS;
  }

  const longerSide = Math.max(width, height);
  const shorterSide = Math.min(width, height);
  const dimensionLimitedPixels = Math.floor(
    MAX_VIEWER_CANVAS_DIMENSION *
    MAX_VIEWER_CANVAS_DIMENSION *
    (shorterSide / longerSide),
  );

  return Math.max(
    16_000_000,
    Math.min(MAX_VIEWER_CANVAS_PIXELS, dimensionLimitedPixels),
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getIntersectionRect(a: DOMRect, b: DOMRect) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);

  if (right <= left || bottom <= top) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

export const PDFPageViewLayer: React.FC<PDFPageViewLayerProps> = ({
  pdfDocument,
  pageNumber,
  viewport,
  pageElementRef,
  viewportContainerRef,
  onPageLoad,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detailTimeoutRef = useRef<number | null>(null);
  const detailRenderTaskRef = useRef<any>(null);
  const pdfPageRef = useRef<PDFPageProxy | null>(null);
  const pageViewRef = useRef<any>(null);
  const redrawTimeoutRef = useRef<number | null>(null);
  const lastDrawnScaleRef = useRef<number | null>(null);
  const zoomRef = useRef(viewport.zoom);

  useEffect(() => {
    zoomRef.current = viewport.zoom;
  }, [viewport.zoom]);

  const clearRedrawTimeout = useCallback(() => {
    if (redrawTimeoutRef.current !== null) {
      window.clearTimeout(redrawTimeoutRef.current);
      redrawTimeoutRef.current = null;
    }
  }, []);

  const clearDetailTimeout = useCallback(() => {
    if (detailTimeoutRef.current !== null) {
      window.clearTimeout(detailTimeoutRef.current);
      detailTimeoutRef.current = null;
    }
  }, []);

  const cancelDetailRender = useCallback(() => {
    if (detailRenderTaskRef.current) {
      detailRenderTaskRef.current.cancel();
      detailRenderTaskRef.current = null;
    }
  }, []);

  const hideDetailCanvas = useCallback(() => {
    const detailCanvas = detailCanvasRef.current;
    if (!detailCanvas) {
      return;
    }

    detailCanvas.style.display = 'none';
  }, []);

  const hideFallbackCanvas = useCallback(() => {
    const fallbackCanvas = fallbackCanvasRef.current;
    if (!fallbackCanvas) {
      return;
    }

    fallbackCanvas.style.display = 'none';
  }, []);

  const snapshotBaseCanvas = useCallback(() => {
    const sourceCanvas = pageViewRef.current?.canvas as HTMLCanvasElement | undefined;
    const fallbackCanvas = fallbackCanvasRef.current;

    if (!sourceCanvas || !fallbackCanvas || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
      hideFallbackCanvas();
      return;
    }

    fallbackCanvas.width = sourceCanvas.width;
    fallbackCanvas.height = sourceCanvas.height;

    const fallbackContext = fallbackCanvas.getContext('2d', { alpha: false });
    if (!fallbackContext) {
      hideFallbackCanvas();
      return;
    }

    fallbackContext.clearRect(0, 0, fallbackCanvas.width, fallbackCanvas.height);
    fallbackContext.drawImage(sourceCanvas, 0, 0);
    fallbackCanvas.style.display = 'block';
  }, [hideFallbackCanvas]);

  const destroyPageView = useCallback(() => {
    clearRedrawTimeout();
    clearDetailTimeout();
    cancelDetailRender();
    hideDetailCanvas();
    hideFallbackCanvas();
    pageElementRef.current = null;
    lastDrawnScaleRef.current = null;
    pdfPageRef.current = null;

    if (pageViewRef.current) {
      pageViewRef.current.destroy();
      pageViewRef.current = null;
    }

    if (pageSurfaceRef.current) {
      pageSurfaceRef.current.replaceChildren();
    }
  }, [cancelDetailRender, clearDetailTimeout, clearRedrawTimeout, hideDetailCanvas, hideFallbackCanvas, pageElementRef]);

  useEffect(() => {
    if (!pdfDocument || !pageSurfaceRef.current) {
      destroyPageView();
      return;
    }

    let cancelled = false;

    const createPageView = async () => {
      try {
        destroyPageView();

        const viewerModule = await loadPdfPageViewerModule();
        const pdfPage = await pdfDocument.getPage(pageNumber);

        if (cancelled || !hostRef.current) {
          pdfPage.cleanup();
          return;
        }

        onPageLoad?.(pdfPage);

        const initialZoom = safeZoom(zoomRef.current);
        const initialScale = initialZoom / PDF_TO_CSS_UNITS;
        const defaultViewport = pdfPage.getViewport({ scale: initialZoom });
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const maxCanvasPixels = getSafeMaxCanvasPixels(baseViewport.width, baseViewport.height);
        const eventBus = new viewerModule.EventBus();

        const pageView = new viewerModule.PDFPageView({
          container: pageSurfaceRef.current ?? undefined,
          eventBus,
          id: pageNumber,
          scale: initialScale,
          defaultViewport,
          annotationMode: pdfjs.AnnotationMode.DISABLE,
          textLayerMode: TEXT_LAYER_DISABLED,
          maxCanvasPixels,
          enableHWA: false,
        });

        pageView.setPdfPage(pdfPage);
        pdfPageRef.current = pdfPage;
        pageViewRef.current = pageView;
        pageElementRef.current = pageView.div;

        await pageView.draw();
        lastDrawnScaleRef.current = initialScale;
        hideFallbackCanvas();

        if (cancelled) {
          pageView.destroy();
          if (pageSurfaceRef.current) {
            pageSurfaceRef.current.replaceChildren();
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Error rendering PDF page view:', error);
        }
      }
    };

    void createPageView();

    return () => {
      cancelled = true;
      destroyPageView();
    };
  }, [destroyPageView, hideFallbackCanvas, onPageLoad, pageElementRef, pageNumber, pdfDocument]);

  useEffect(() => {
    const pageView = pageViewRef.current;
    if (!pageView) {
      return;
    }

    const nextZoom = safeZoom(viewport.zoom);
    const nextScale = nextZoom / PDF_TO_CSS_UNITS;

    clearRedrawTimeout();
    pageView.update({
      scale: nextScale,
      drawingDelay: PDF_VIEWER_DRAW_DELAY_MS,
    });

    redrawTimeoutRef.current = window.setTimeout(() => {
      const activePageView = pageViewRef.current;
      if (!activePageView || activePageView !== pageView) {
        return;
      }

      const lastDrawnScale = lastDrawnScaleRef.current;
      if (
        lastDrawnScale &&
        (
          nextScale <= lastDrawnScale ||
          (nextScale - lastDrawnScale) / lastDrawnScale < MIN_REDRAW_SCALE_DELTA
        )
      ) {
        return;
      }

      snapshotBaseCanvas();
      activePageView.update({ scale: nextScale });
      void activePageView.draw()
        .then(() => {
          if (pageViewRef.current === activePageView) {
            lastDrawnScaleRef.current = nextScale;
            hideFallbackCanvas();
          }
        })
        .catch((error: any) => {
          hideFallbackCanvas();
          if (error?.name !== 'RenderingCancelledException') {
            console.error('Error redrawing PDF page view:', error);
          }
        });
    }, PDF_VIEWER_DRAW_DELAY_MS);

    return clearRedrawTimeout;
  }, [clearRedrawTimeout, hideFallbackCanvas, snapshotBaseCanvas, viewport.zoom]);

  useEffect(() => {
    clearDetailTimeout();
    cancelDetailRender();
    hideDetailCanvas();

    if (viewport.zoom < DETAIL_TILE_MIN_ZOOM) {
      return;
    }

    detailTimeoutRef.current = window.setTimeout(() => {
      const pdfPage = pdfPageRef.current;
      const pageElement = pageElementRef.current;
      const viewportContainer = viewportContainerRef.current;
      const detailCanvas = detailCanvasRef.current;

      if (!pdfPage || !pageElement || !viewportContainer || !detailCanvas) {
        return;
      }

      const pageRect = pageElement.getBoundingClientRect();
      const viewportRect = viewportContainer.getBoundingClientRect();
      const visibleRect = getIntersectionRect(pageRect, viewportRect);

      if (!visibleRect || visibleRect.width < 24 || visibleRect.height < 24) {
        hideDetailCanvas();
        return;
      }

      const tileLeft = clamp(
        visibleRect.left - pageRect.left - DETAIL_TILE_OVERSCAN_CSS_PX,
        0,
        pageRect.width,
      );
      const tileTop = clamp(
        visibleRect.top - pageRect.top - DETAIL_TILE_OVERSCAN_CSS_PX,
        0,
        pageRect.height,
      );
      const tileRight = clamp(
        visibleRect.right - pageRect.left + DETAIL_TILE_OVERSCAN_CSS_PX,
        0,
        pageRect.width,
      );
      const tileBottom = clamp(
        visibleRect.bottom - pageRect.top + DETAIL_TILE_OVERSCAN_CSS_PX,
        0,
        pageRect.height,
      );

      const tileCssWidth = tileRight - tileLeft;
      const tileCssHeight = tileBottom - tileTop;

      if (tileCssWidth < 24 || tileCssHeight < 24) {
        hideDetailCanvas();
        return;
      }

      const desiredUpscale = Math.min(
        DETAIL_TILE_MAX_UPSCALE,
        viewport.zoom >= 3 ? 2.5 : 2,
      );
      const maxUpscaleByPixels = Math.sqrt(
        DETAIL_TILE_MAX_PIXELS / (tileCssWidth * tileCssHeight),
      );
      const maxUpscaleByDimension = DETAIL_TILE_MAX_DIMENSION / Math.max(tileCssWidth, tileCssHeight);
      const detailUpscale = Math.max(
        1,
        Math.min(desiredUpscale, maxUpscaleByPixels, maxUpscaleByDimension),
      );

      if (detailUpscale <= 1.05) {
        hideDetailCanvas();
        return;
      }

      const renderScale = viewport.zoom * detailUpscale;
      const renderWidth = Math.max(1, Math.ceil(tileCssWidth * detailUpscale));
      const renderHeight = Math.max(1, Math.ceil(tileCssHeight * detailUpscale));
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = renderWidth;
      tempCanvas.height = renderHeight;

      const tempContext = tempCanvas.getContext('2d', { alpha: false });
      if (!tempContext) {
        return;
      }

      tempContext.fillStyle = '#ffffff';
      tempContext.fillRect(0, 0, renderWidth, renderHeight);

      const tileViewport = pdfPage.getViewport({
        scale: renderScale,
        offsetX: -tileLeft * detailUpscale,
        offsetY: -tileTop * detailUpscale,
      });

      const renderTask = pdfPage.render({
        canvasContext: tempContext,
        viewport: tileViewport,
        annotationMode: pdfjs.AnnotationMode.DISABLE,
        background: '#ffffff',
      });

      detailRenderTaskRef.current = renderTask;

      void renderTask.promise
        .then(() => {
          if (detailRenderTaskRef.current !== renderTask) {
            return;
          }

          const visibleCanvas = detailCanvasRef.current;
          if (!visibleCanvas) {
            return;
          }

          visibleCanvas.width = renderWidth;
          visibleCanvas.height = renderHeight;
          visibleCanvas.style.width = `${tileCssWidth}px`;
          visibleCanvas.style.height = `${tileCssHeight}px`;
          visibleCanvas.style.left = `${tileLeft}px`;
          visibleCanvas.style.top = `${tileTop}px`;
          visibleCanvas.style.display = 'block';

          const visibleContext = visibleCanvas.getContext('2d', { alpha: false });
          if (!visibleContext) {
            return;
          }

          visibleContext.clearRect(0, 0, renderWidth, renderHeight);
          visibleContext.drawImage(tempCanvas, 0, 0);
          detailRenderTaskRef.current = null;
        })
        .catch((error: any) => {
          if (error?.name !== 'RenderingCancelledException') {
            console.error('Error rendering PDF detail tile:', error);
          }
          if (detailRenderTaskRef.current === renderTask) {
            detailRenderTaskRef.current = null;
          }
        });
    }, DETAIL_TILE_DRAW_DELAY_MS);

    return () => {
      clearDetailTimeout();
      cancelDetailRender();
    };
  }, [
    cancelDetailRender,
    clearDetailTimeout,
    hideDetailCanvas,
    pageElementRef,
    viewport.scrollX,
    viewport.scrollY,
    viewport.zoom,
    viewportContainerRef,
  ]);

  return (
    <div
      className="pdfjs-page-viewer pdfViewer removePageBorders singlePageView"
      ref={hostRef}
    >
      <div className="pdfjs-page-surface" ref={pageSurfaceRef} />
      <canvas
        aria-hidden="true"
        className="pdfjs-base-fallback"
        ref={fallbackCanvasRef}
      />
      <canvas
        aria-hidden="true"
        className="pdfjs-detail-tile"
        ref={detailCanvasRef}
      />
    </div>
  );
};
