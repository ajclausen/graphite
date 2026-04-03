import React, { useState, useCallback, useEffect } from 'react';
import { PDFWithAnnotations } from './PDFWithAnnotations';
import { useAnnotationStore } from '../store/annotationStore';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types';
import './AnnotatedPDFViewer.css';

interface AnnotatedPDFViewerProps {
  file: File;
}

export const AnnotatedPDFViewer: React.FC<AnnotatedPDFViewerProps> = ({ file }) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [isAnnotating, setIsAnnotating] = useState(false);

  const {
    annotations,
    setAnnotations,
    getAnnotations,
    setCurrentPage,
    isDirty
  } = useAnnotationStore();

  // Update current page in store
  useEffect(() => {
    setCurrentPage(pageNumber);
  }, [pageNumber, setCurrentPage]);

  // Auto-save functionality
  useEffect(() => {
    if (!isDirty) return;

    const saveTimeout = setTimeout(() => {
      // TODO: Implement actual save to backend
      console.log('Auto-saving annotations...', annotations);
      useAnnotationStore.getState().markClean();
    }, 2000); // Save after 2 seconds of inactivity

    return () => clearTimeout(saveTimeout);
  }, [annotations, isDirty]);

  const handleElementsChange = useCallback((elements: readonly ExcalidrawElement[]) => {
    // Use a timeout to debounce rapid changes
    clearTimeout((window as any).annotationTimeout);
    (window as any).annotationTimeout = setTimeout(() => {
      setAnnotations(pageNumber, elements);
    }, 100);
  }, [pageNumber, setAnnotations]);

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

  const toggleAnnotation = useCallback(() => {
    setIsAnnotating(prev => !prev);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Disable keyboard shortcuts when annotating
      if (isAnnotating) return;

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
        case 'a':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            toggleAnnotation();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToPrevPage, goToNextPage, zoomIn, zoomOut, fitToPage, toggleAnnotation, isAnnotating]);

  return (
    <div className="annotated-pdf-viewer">
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
          <button 
            onClick={toggleAnnotation} 
            className={isAnnotating ? 'active' : ''}
          >
            {isAnnotating ? 'View Mode' : 'Annotate'} (A)
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

      <PDFWithAnnotations
        file={file}
        pageNumber={pageNumber}
        scale={scale}
        isAnnotating={isAnnotating}
        onDocumentLoad={setNumPages}
        onAnnotationsChange={handleElementsChange}
        initialAnnotations={getAnnotations(pageNumber)}
      />
    </div>
  );
};