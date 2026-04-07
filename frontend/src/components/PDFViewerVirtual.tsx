import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { PDF_DOCUMENT_OPTIONS } from '../utils/pdfOptions';
import './PDFViewer.css';

interface PDFViewerProps {
  file: File;
  onDocumentLoad?: (numPages: number) => void;
  scale?: number;
  pageNumber?: number;
}

export const PDFViewerVirtual: React.FC<PDFViewerProps> = ({ 
  file, 
  onDocumentLoad,
  scale = 1.0,
  pageNumber = 1
}) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1]));
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageHeight, setPageHeight] = useState(0);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoading(false);
    onDocumentLoad?.(numPages);
  };

  const onPageLoadSuccess = useCallback((page: any) => {
    if (pageHeight === 0) {
      const { height } = page;
      setPageHeight(height * scale);
    }
  }, [pageHeight, scale]);

  // Calculate which pages should be visible based on scroll position
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !numPages || pageHeight === 0) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;
      
      // Calculate visible pages with buffer
      const firstVisiblePage = Math.max(1, Math.floor(scrollTop / pageHeight));
      const lastVisiblePage = Math.min(
        numPages,
        Math.ceil((scrollTop + containerHeight) / pageHeight) + 1
      );

      // Add buffer pages
      const pagesToRender = new Set<number>();
      for (let i = Math.max(1, firstVisiblePage - 1); i <= Math.min(numPages, lastVisiblePage + 1); i++) {
        pagesToRender.add(i);
      }

      setVisiblePages(pagesToRender);
    };

    handleScroll(); // Initial calculation
    container.addEventListener('scroll', handleScroll);

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [numPages, pageHeight, scale]);

  // Scroll to specific page
  useEffect(() => {
    if (containerRef.current && pageHeight > 0 && pageNumber) {
      const scrollTop = (pageNumber - 1) * pageHeight;
      containerRef.current.scrollTop = scrollTop;
    }
  }, [pageNumber, pageHeight]);

  return (
    <div className="pdf-canvas-container" ref={containerRef}>
      {loading && <div className="loading">Loading PDF...</div>}
      
      <Document
        file={file}
        options={PDF_DOCUMENT_OPTIONS}
        onLoadSuccess={onDocumentLoadSuccess}
        loading=""
      >
        <div 
          style={{ 
            position: 'relative',
            height: numPages ? numPages * pageHeight : 'auto'
          }}
        >
          {numPages && Array.from({ length: numPages }, (_, index) => index + 1).map((page) => (
            <div
              key={`page_${page}`}
              style={{
                position: 'absolute',
                top: (page - 1) * pageHeight,
                left: '50%',
                transform: 'translateX(-50%)'
              }}
            >
              {visiblePages.has(page) ? (
                <Page
                  pageNumber={page}
                  scale={scale}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  onLoadSuccess={page === 1 ? onPageLoadSuccess : undefined}
                />
              ) : (
                <div 
                  style={{ 
                    width: 595 * scale, // A4 width in points
                    height: pageHeight || 842 * scale, // A4 height in points
                    backgroundColor: '#f0f0f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)'
                  }}
                >
                  <span style={{ color: '#999' }}>Page {page}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </Document>
    </div>
  );
};
