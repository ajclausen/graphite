import React, { useState, useCallback, useRef } from 'react';
import { Document, Page } from 'react-pdf';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types';
import { useAnnotationStore } from '../store/annotationStore';
import { PDF_DOCUMENT_OPTIONS } from '../utils/pdfOptions';
import './SimplePDFAnnotator.css';

interface SimplePDFAnnotatorProps {
  file: File;
}

export const SimplePDFAnnotator: React.FC<SimplePDFAnnotatorProps> = ({ file }) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [_excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  
  const { setAnnotations, getAnnotations } = useAnnotationStore();
  const timeoutRef = useRef<NodeJS.Timeout>();

  const handleDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const handleElementsChange = useCallback((elements: readonly ExcalidrawElement[]) => {
    // Debounce updates
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setAnnotations(pageNumber, elements);
    }, 500);
  }, [pageNumber, setAnnotations]);

  const toggleAnnotation = () => {
    setIsAnnotating(prev => !prev);
  };

  // Zoom controls
  const zoomIn = () => setScale(prev => Math.min(3, prev + 0.1));
  const zoomOut = () => setScale(prev => Math.max(0.5, prev - 0.1));
  const fitToPage = () => setScale(1.0);

  // Page navigation
  const goToPrevPage = () => setPageNumber(prev => Math.max(1, prev - 1));
  const goToNextPage = () => setPageNumber(prev => Math.min(numPages || 1, prev + 1));

  return (
    <div className="simple-pdf-annotator">
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

      <div className="content-container">
        {!isAnnotating ? (
          // PDF View Mode
          <div className="pdf-view-container">
            <Document
              file={file}
              options={PDF_DOCUMENT_OPTIONS}
              onLoadSuccess={handleDocumentLoadSuccess}
              loading={<div className="loading">Loading PDF...</div>}
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </Document>
          </div>
        ) : (
          // Annotation Mode - Excalidraw only
          <div className="annotation-container">
            <div 
              className="pdf-background"
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                background: '#f0f0f0'
              }}
            >
              <div style={{ color: '#999', fontSize: '1.5rem' }}>
                PDF Page {pageNumber} - Draw annotations here
              </div>
            </div>
            <div className="excalidraw-wrapper">
              <Excalidraw
                key={`page-${pageNumber}`}
                excalidrawAPI={(api) => setExcalidrawAPI(api)}
                initialData={{
                  elements: getAnnotations(pageNumber),
                  appState: {
                    viewBackgroundColor: 'transparent',
                  }
                }}
                onChange={(elements) => handleElementsChange(elements)}
                theme="light"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
