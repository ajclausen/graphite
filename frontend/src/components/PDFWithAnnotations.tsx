import React, { useState, useRef, useCallback } from 'react';
import { Document, Page } from 'react-pdf';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types';
import { PDF_DOCUMENT_OPTIONS } from '../utils/pdfOptions';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import './PDFWithAnnotations.css';

interface PDFWithAnnotationsProps {
  file: File;
  pageNumber: number;
  scale: number;
  isAnnotating: boolean;
  onDocumentLoad?: (numPages: number) => void;
  onAnnotationsChange?: (elements: readonly ExcalidrawElement[]) => void;
  initialAnnotations?: readonly ExcalidrawElement[];
}

export const PDFWithAnnotations: React.FC<PDFWithAnnotationsProps> = ({
  file,
  pageNumber,
  scale,
  isAnnotating,
  onDocumentLoad,
  onAnnotationsChange,
  initialAnnotations = []
}) => {
  const [_numPages, setNumPages] = useState<number | null>(null);
  const [pageWidth, setPageWidth] = useState<number>(0);
  const [pageHeight, setPageHeight] = useState<number>(0);
  const [_excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    onDocumentLoad?.(numPages);
  };

  const onPageLoadSuccess = (page: any) => {
    setPageWidth(page.width);
    setPageHeight(page.height);
  };

  // Handle annotation changes
  const handleAnnotationsChange = useCallback((elements: readonly ExcalidrawElement[]) => {
    onAnnotationsChange?.(elements);
  }, [onAnnotationsChange]);

  return (
    <div className="pdf-with-annotations-container" ref={containerRef}>
      <div className="pdf-page-wrapper" style={{ position: 'relative' }}>
        <Document
          file={file}
          options={PDF_DOCUMENT_OPTIONS}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={<div className="loading">Loading PDF...</div>}
        >
          <Page
            pageNumber={pageNumber}
            scale={scale}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            onLoadSuccess={onPageLoadSuccess}
          />
        </Document>

        {isAnnotating && pageWidth > 0 && pageHeight > 0 && (
          <div 
            className="annotation-layer"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: pageWidth * scale,
              height: pageHeight * scale,
              pointerEvents: 'auto'
            }}
          >
            <Excalidraw
              excalidrawAPI={(api) => setExcalidrawAPI(api)}
              initialData={{
                elements: initialAnnotations,
                appState: {
                  viewBackgroundColor: 'transparent',
                  currentItemStrokeColor: '#000000',
                  currentItemBackgroundColor: 'transparent',
                  zoom: { value: 1 as any },
                  scrollX: 0,
                  scrollY: 0,
                  width: pageWidth * scale,
                  height: pageHeight * scale
                }
              }}
              onChange={(elements) => handleAnnotationsChange(elements)}
              UIOptions={{
                canvasActions: {
                  loadScene: false,
                  export: false,
                  saveToActiveFile: false,
                  toggleTheme: false,
                  changeViewBackgroundColor: false
                }
              }}
              theme="light"
            />
          </div>
        )}
      </div>
    </div>
  );
};
