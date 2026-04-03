import React, { useEffect } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';

export const TestExcalidraw: React.FC = () => {
  useEffect(() => {
    console.log('TestExcalidraw component mounted');
    return () => console.log('TestExcalidraw component unmounted');
  }, []);

  return (
    <div style={{ height: '80vh', width: '100%', border: '2px solid red', padding: '1rem' }}>
      <h2>Test Excalidraw (Isolated)</h2>
      <p>This should show Excalidraw below. If it doesn't, there's a fundamental issue.</p>
      <div style={{ height: '500px', width: '100%', border: '1px solid blue', marginTop: '1rem' }}>
        <Excalidraw 
          initialData={{
            appState: {
              viewBackgroundColor: '#ffffff',
              theme: 'light',
            },
          }}
          onChange={(elements, appState) => {
            console.log('Excalidraw onChange:', { elements: elements.length, appState });
          }}
        />
      </div>
    </div>
  );
};