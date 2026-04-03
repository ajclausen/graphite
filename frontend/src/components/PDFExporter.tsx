import React from 'react';
import { PDFDocument } from 'pdf-lib';
import { exportToCanvas, exportToSvg, getCommonBounds } from '@excalidraw/excalidraw';
import { pdfjs } from '../utils/pdfWorker';
import { useAnnotationStore, flushPendingAnnotations } from '../store/annotationStore';
import { getDocumentPdfUrl, getDocumentFileUrl } from '../api/client';

interface PDFExporterProps {
  documentId: string;
  originalName: string;
  numPages: number;
  fileType: 'pdf' | 'image';
}

const EXPORT_SCALE = 3;
const SVG_NS = 'http://www.w3.org/2000/svg';
type ImageExportFormat = 'pdf' | 'png' | 'jpg';

function getExportBaseName(originalName: string) {
  return originalName.replace(/\.[^.]+$/, '');
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function loadSvgImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to load exported annotation SVG'));
    });

    image.src = url;
    await loaded;
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to load source image'));
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const PDFExporter: React.FC<PDFExporterProps> = ({ documentId, originalName, numPages, fileType }) => {
  const [isExporting, setIsExporting] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  const createImageExportCanvas = React.useCallback(async () => {
    const { annotations, pageMetrics } = useAnnotationStore.getState();
    const imageUrl = getDocumentFileUrl(documentId);
    const imageResponse = await fetch(imageUrl, { credentials: 'include' });
    const imageBlob = await imageResponse.blob();
    const img = await loadImageFromBlob(imageBlob);

    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;

    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = imgWidth;
    pageCanvas.height = imgHeight;
    const context = pageCanvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create export canvas');
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(img, 0, 0, pageCanvas.width, pageCanvas.height);

    const pageAnnotations = annotations[1] || [];
    const activeElements = pageAnnotations.filter((el: any) => !el.isDeleted);

    if (activeElements.length > 0) {
      const [minX, minY, maxX, maxY] = getCommonBounds(activeElements);
      const boundsWidth = maxX - minX;
      const boundsHeight = maxY - minY;
      const pageMetric = pageMetrics[1];
      const sceneX = pageMetric?.sceneX ?? 0;
      const sceneY = pageMetric?.sceneY ?? 0;
      const sceneWidth = pageMetric?.sceneWidth ?? pageMetric?.width ?? imgWidth;
      const sceneHeight = pageMetric?.sceneHeight ?? pageMetric?.height ?? imgHeight;
      const scaleX = pageCanvas.width / sceneWidth;
      const scaleY = pageCanvas.height / sceneHeight;
      const annotationExportScale = Math.max(
        EXPORT_SCALE,
        Math.ceil(Math.max(scaleX, scaleY)),
      );

      const annotationCanvas = await exportToCanvas({
        elements: activeElements,
        appState: {
          viewBackgroundColor: 'transparent',
          exportBackground: false,
          exportWithDarkMode: false,
          exportEmbedScene: false,
          exportScale: annotationExportScale,
        },
        files: null,
        exportPadding: 0,
      });

      const canvasSceneScaleX = boundsWidth > 0
        ? Math.max(1, annotationCanvas.width / boundsWidth)
        : 1;
      const canvasSceneScaleY = boundsHeight > 0
        ? Math.max(1, annotationCanvas.height / boundsHeight)
        : 1;
      const logicalWidth = annotationCanvas.width / canvasSceneScaleX;
      const logicalHeight = annotationCanvas.height / canvasSceneScaleY;
      const actualPaddingX = (logicalWidth - boundsWidth) / 2;
      const actualPaddingY = (logicalHeight - boundsHeight) / 2;
      const destX = (minX - actualPaddingX - sceneX) * scaleX;
      const destY = (minY - actualPaddingY - sceneY) * scaleY;
      const destWidth = logicalWidth * scaleX;
      const destHeight = logicalHeight * scaleY;

      context.drawImage(annotationCanvas, destX, destY, destWidth, destHeight);
    }

    return { pageCanvas, imgWidth, imgHeight };
  }, [documentId]);

  const exportImageDocument = React.useCallback(async (format: ImageExportFormat) => {
    const { pageCanvas, imgWidth, imgHeight } = await createImageExportCanvas();
    const baseName = getExportBaseName(originalName);

    if (format === 'pdf') {
      const pdfDoc = await PDFDocument.create();
      const blob = await new Promise<Blob | null>((resolve) => {
        pageCanvas.toBlob(resolve, 'image/png', 1.0);
      });
      if (!blob) {
        throw new Error('Failed to create export blob');
      }

      const imageBytes = await blob.arrayBuffer();
      const pdfImage = await pdfDoc.embedPng(new Uint8Array(imageBytes));
      const page = pdfDoc.addPage([imgWidth, imgHeight]);
      page.drawImage(pdfImage, { x: 0, y: 0, width: imgWidth, height: imgHeight, opacity: 1.0 });

      const pdfBytes = await pdfDoc.save();
      triggerDownload(new Blob([pdfBytes], { type: 'application/pdf' }), `annotated_${baseName}.pdf`);
      return;
    }

    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    const quality = format === 'png' ? 1.0 : 0.95;
    const blob = await new Promise<Blob | null>((resolve) => {
      pageCanvas.toBlob(resolve, mimeType, quality);
    });
    if (!blob) {
      throw new Error(`Failed to create ${format.toUpperCase()} export`);
    }
    triggerDownload(blob, `annotated_${baseName}.${format}`);
  }, [createImageExportCanvas, originalName]);

  const exportHighQualityPDF = async (format: ImageExportFormat = 'pdf') => {
    setIsExporting(true);
    setMenuOpen(false);
    try {
      flushPendingAnnotations();

      if (fileType === 'image') {
        await exportImageDocument(format);
        return;
      }

      const { annotations, pageMetrics } = useAnnotationStore.getState();
      // Fetch PDF bytes from server
      const pdfUrl = getDocumentPdfUrl(documentId);
      const response = await fetch(pdfUrl, { credentials: 'include' });
      const existingPdfBytes = await response.arrayBuffer();

      const pdfSource = await pdfjs.getDocument({ data: new Uint8Array(existingPdfBytes) }).promise;
      const pdfDoc = await PDFDocument.create();

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const sourcePage = await pdfSource.getPage(pageNum);
        const baseViewport = sourcePage.getViewport({ scale: 1 });
        const renderViewport = sourcePage.getViewport({ scale: EXPORT_SCALE });

        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = Math.ceil(renderViewport.width);
        pageCanvas.height = Math.ceil(renderViewport.height);

        const context = pageCanvas.getContext('2d');
        if (!context) {
          throw new Error(`Failed to create export canvas context for page ${pageNum}`);
        }

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

        await sourcePage.render({
          canvasContext: context,
          viewport: renderViewport,
        }).promise;

        const pageAnnotations = annotations[pageNum] || [];
        const activeElements = pageAnnotations.filter((el: any) => !el.isDeleted);

        if (activeElements.length > 0) {
          const [minX, minY, maxX, maxY] = getCommonBounds(activeElements);
          const boundsWidth = maxX - minX;
          const boundsHeight = maxY - minY;
          const pageMetric = pageMetrics[pageNum];
          const sceneX = pageMetric?.sceneX ?? 0;
          const sceneY = pageMetric?.sceneY ?? 0;
          const pageWidth = pageMetric?.width ?? baseViewport.width;
          const pageHeight = pageMetric?.height ?? baseViewport.height;
          const annotationSvg = await exportToSvg({
            elements: activeElements,
            appState: {
              viewBackgroundColor: 'transparent',
              exportBackground: false,
              exportWithDarkMode: false,
              exportEmbedScene: false,
            },
            files: null,
            exportPadding: 0,
          });

          const pageSvg = document.createElementNS(SVG_NS, 'svg');
          pageSvg.setAttribute('xmlns', SVG_NS);
          pageSvg.setAttribute('width', `${pageWidth}`);
          pageSvg.setAttribute('height', `${pageHeight}`);
          pageSvg.setAttribute('viewBox', `0 0 ${pageWidth} ${pageHeight}`);

          const positionedSvg = annotationSvg.cloneNode(true) as SVGSVGElement;
          positionedSvg.setAttribute('x', `${minX - sceneX}`);
          positionedSvg.setAttribute('y', `${minY - sceneY}`);
          positionedSvg.setAttribute('width', `${boundsWidth}`);
          positionedSvg.setAttribute('height', `${boundsHeight}`);
          pageSvg.appendChild(positionedSvg);

          const annotationImage = await loadSvgImage(pageSvg);
          context.drawImage(annotationImage, 0, 0, renderViewport.width, renderViewport.height);
        }

        const blob = await new Promise<Blob | null>((resolve) => {
          pageCanvas.toBlob(resolve, 'image/png', 1.0);
        });

        if (!blob) continue;

        const imageBytes = await blob.arrayBuffer();
        const pdfImage = await pdfDoc.embedPng(new Uint8Array(imageBytes));
        const page = pdfDoc.addPage([baseViewport.width, baseViewport.height]);

        page.drawImage(pdfImage, {
          x: 0,
          y: 0,
          width: baseViewport.width,
          height: baseViewport.height,
          opacity: 1.0,
        });
      }

      const pdfBytes = await pdfDoc.save();
      triggerDownload(new Blob([pdfBytes], { type: 'application/pdf' }), `annotated_${originalName}`);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Error exporting PDF. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  if (fileType === 'image') {
    return (
      <div className="export-menu" ref={menuRef}>
        <button
          className="export-btn"
          onClick={() => setMenuOpen((open) => !open)}
          disabled={isExporting}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          {isExporting ? 'Exporting...' : 'Export'}
        </button>
        {menuOpen && !isExporting && (
          <div className="export-menu-dropdown" role="menu">
            <button className="export-menu-item" onClick={() => exportHighQualityPDF('pdf')} role="menuitem">
              Export as PDF
            </button>
            <button className="export-menu-item" onClick={() => exportHighQualityPDF('png')} role="menuitem">
              Export as PNG
            </button>
            <button className="export-menu-item" onClick={() => exportHighQualityPDF('jpg')} role="menuitem">
              Export as JPG
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className="export-btn"
      onClick={() => exportHighQualityPDF('pdf')}
      disabled={isExporting}
    >
      {isExporting ? 'Exporting...' : 'Export PDF'}
    </button>
  );
};
