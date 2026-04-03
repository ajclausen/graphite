import React, { useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types';
import './ExcalidrawOverlay.css';

interface ExcalidrawOverlaySimpleProps {
  pageNumber: number;
  onElementsChange?: (elements: readonly ExcalidrawElement[]) => void;
  initialElements?: readonly ExcalidrawElement[];
}

export const ExcalidrawOverlaySimple: React.FC<ExcalidrawOverlaySimpleProps> = ({
  pageNumber,
  onElementsChange,
  initialElements = []
}) => {
  const [_excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);

  return (
    <div className="excalidraw-overlay">
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
          }
        }}
        onChange={(elements) => onElementsChange?.(elements)}
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