import React, { useState, useCallback, useRef } from 'react';
import { Document, Page } from 'react-pdf';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types';
import { useAnnotationStore } from '../store/annotationStore';
import { PDF_DOCUMENT_OPTIONS } from '../utils/pdfOptions';
import './PDFAnnotationLayer.css';

interface PDFAnnotationLayerProps {
  file: File;
}

export const PDFAnnotationLayer: React.FC<PDFAnnotationLayerProps> = ({ file }) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  
  const { setAnnotations, getAnnotations } = useAnnotationStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const annotationTimeoutRef = useRef<NodeJS.Timeout>();

  const handleDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const handlePageLoadSuccess = (page: any) => {
    setPageSize({
      width: page.width,
      height: page.height
    });
  };

  const handleAnnotationsChange = useCallback((elements: readonly ExcalidrawElement[]) => {
    if (annotationTimeoutRef.current) {
      clearTimeout(annotationTimeoutRef.current);
    }
    annotationTimeoutRef.current = setTimeout(() => {
      setAnnotations(pageNumber, elements);
    }, 300);
  }, [pageNumber, setAnnotations]);

  const toggleAnnotation = () => setIsAnnotating(prev => !prev);
  const zoomIn = () => setScale(prev => Math.min(3, prev + 0.1));
  const zoomOut = () => setScale(prev => Math.max(0.5, prev - 0.1));
  const fitToPage = () => setScale(1.0);
  const goToPrevPage = () => setPageNumber(prev => Math.max(1, prev - 1));
  const goToNextPage = () => setPageNumber(prev => Math.min(numPages || 1, prev + 1));

  return (
    <div className="pdf-annotation-layer">
      <div className="toolbar">
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
            {isAnnotating ? 'View Mode' : 'Annotate'}
          </button>
        </div>

        <div className="toolbar-group">
          <button onClick={zoomOut}>-</button>
          <span className="zoom-info">{Math.round(scale * 100)}%</span>
          <button onClick={zoomIn}>+</button>
          <button onClick={fitToPage}>Fit</button>
        </div>
      </div>

      <div className="pdf-scroll-container" ref={containerRef}>
        <div className={`pdf-page-container ${isAnnotating ? 'annotating' : ''}`}>
          <Document
            file={file}
            options={PDF_DOCUMENT_OPTIONS}
            onLoadSuccess={handleDocumentLoadSuccess}
            loading={<div className="loading">Loading PDF...</div>}
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              renderTextLayer={!isAnnotating}
              renderAnnotationLayer={!isAnnotating}
              onLoadSuccess={handlePageLoadSuccess}
            />
          </Document>

          {isAnnotating && pageSize.width > 0 && (
            <div 
              className="annotation-overlay"
              style={{
                // Give extra space for Excalidraw UI elements
                width: '100vw',
                height: '100vh',
                position: 'fixed',
                top: 0,
                left: 0,
              }}
            >
              <Excalidraw
                key={`annotations-${pageNumber}`}
                initialData={{
                  elements: getAnnotations(pageNumber),
                  appState: {
                    viewBackgroundColor: 'transparent',
                    gridSize: null,
                    zoom: {
                      value: 1 as any
                    },
                    scrollX: 0,
                    scrollY: 0,
                    offsetLeft: 0,
                    offsetTop: 0,
                    width: pageSize.width * scale,
                    height: pageSize.height * scale,
                  },
                  scrollToContent: false,
                }}
                onChange={(elements) => handleAnnotationsChange(elements)}
                viewModeEnabled={false}
                zenModeEnabled={false}
                gridModeEnabled={false}
                theme="light"
                name={`page-${pageNumber}`}
                autoFocus={false}
                detectScroll={false}
                handleKeyboardGlobally={false}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
