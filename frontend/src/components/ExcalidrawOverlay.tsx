import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types';
import type { ExcalidrawImperativeAPI, AppState } from '@excalidraw/excalidraw/types/types';
import './ExcalidrawOverlay.css';

interface ExcalidrawOverlayProps {
  pageNumber: number;
  scale: number;
  onElementsChange?: (elements: readonly ExcalidrawElement[]) => void;
  initialElements?: readonly ExcalidrawElement[];
  viewportOffset?: { x: number; y: number };
}

export const ExcalidrawOverlay: React.FC<ExcalidrawOverlayProps> = ({
  pageNumber,
  scale,
  onElementsChange,
  initialElements = [],

}) => {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isUpdatingRef = useRef(false);

  // Handle elements change with debouncing to prevent loops
  const handleChange = useCallback((elements: readonly ExcalidrawElement[], _appState: AppState) => {
    if (!isUpdatingRef.current) {
      onElementsChange?.(elements);
    }
  }, [onElementsChange]);

  // Sync viewport when scale or offset changes
  useEffect(() => {
    if (excalidrawAPI && scale > 0) {
      // Only update if values actually changed
      const currentAppState = excalidrawAPI.getAppState();
      if (currentAppState.zoom?.value !== scale) {
        excalidrawAPI.updateScene({
          appState: {
            zoom: {
              value: scale as any
            }
          }
        });
      }
    }
  }, [excalidrawAPI, scale]);

  // Load initial elements when page changes
  useEffect(() => {
    if (excalidrawAPI && initialElements) {
      isUpdatingRef.current = true;
      excalidrawAPI.updateScene({
        elements: initialElements
      });
      // Reset flag after a short delay
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 100);
    }
  }, [excalidrawAPI, pageNumber]); // Remove initialElements from deps to prevent loops

  return (
    <div className="excalidraw-overlay" ref={containerRef}>
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        initialData={{
          elements: initialElements,
          appState: {
            viewBackgroundColor: 'transparent',
            currentItemStrokeColor: '#000000',
            currentItemBackgroundColor: 'transparent',
            currentItemFillStyle: 'hachure',
            currentItemStrokeWidth: 1,
            currentItemRoughness: 1,
            currentItemOpacity: 100,
            currentItemFontSize: 16,
            zoom: {
              value: scale as any
            }
          }
        }}
        onChange={handleChange}
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
        name={`graphite-page-${pageNumber}`}
      />
    </div>
  );
};