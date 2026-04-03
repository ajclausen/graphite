import React, { useState, useCallback, useEffect } from 'react';
import { PDFViewerVirtual } from './PDFViewerVirtual';
import './PDFViewer.css';

interface PDFViewerProps {
  file: File;
}

export const PDFViewer: React.FC<PDFViewerProps> = ({ file }) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);

  const goToPrevPage = useCallback(() => {
    setPageNumber(prev => Math.max(1, prev - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setPageNumber(prev => Math.min(numPages || 1, prev + 1));
  }, [numPages]);

  const zoomIn = useCallback(() => {
    setScale(prev => Math.min(3, prev + 0.1));
  }, []);

  const zoomOut = useCallback(() => {
    setScale(prev => Math.max(0.5, prev - 0.1));
  }, []);

  const fitToPage = useCallback(() => {
    setScale(1.0);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          goToPrevPage();
          break;
        case 'ArrowRight':
          goToNextPage();
          break;
        case '+':
        case '=':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            zoomIn();
          }
          break;
        case '-':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            zoomOut();
          }
          break;
        case '0':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            fitToPage();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToPrevPage, goToNextPage, zoomIn, zoomOut, fitToPage]);

  return (
    <div className="pdf-viewer-container">
      <div className="pdf-toolbar">
        <div className="toolbar-group">
          <button onClick={goToPrevPage} disabled={pageNumber <= 1}>
            Previous
          </button>
          <span className="page-info">
            Page {pageNumber} of {numPages || '...'}
          </span>
          <button onClick={goToNextPage} disabled={pageNumber >= (numPages || 1)}>
            Next
          </button>
        </div>

        <div className="toolbar-group">
          <button onClick={zoomOut} disabled={scale <= 0.5}>
            Zoom Out
          </button>
          <span className="zoom-info">{Math.round(scale * 100)}%</span>
          <button onClick={zoomIn} disabled={scale >= 3}>
            Zoom In
          </button>
          <button onClick={fitToPage}>Fit</button>
        </div>
      </div>

      <PDFViewerVirtual 
        file={file}
        onDocumentLoad={setNumPages}
        scale={scale}
        pageNumber={pageNumber}
      />
    </div>
  );
};