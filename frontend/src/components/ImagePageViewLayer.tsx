import React, { useCallback, useRef, useState } from 'react';
import './ImagePageViewLayer.css';

const MAX_IMAGE_SCENE_SIDE = 2400;

function getImageSceneDimensions(width: number, height: number) {
  const longestSide = Math.max(width, height);
  if (longestSide <= MAX_IMAGE_SCENE_SIDE) {
    return { sceneWidth: width, sceneHeight: height };
  }

  const scale = MAX_IMAGE_SCENE_SIDE / longestSide;
  return {
    sceneWidth: Math.round(width * scale),
    sceneHeight: Math.round(height * scale),
  };
}

interface ImagePageViewLayerProps {
  imageUrl: string;
  zoom: number;
  pageElementRef: React.MutableRefObject<HTMLDivElement | null>;
  onImageLoad: (width: number, height: number, sceneWidth: number, sceneHeight: number) => void;
}

export const ImagePageViewLayer: React.FC<ImagePageViewLayerProps> = ({
  imageUrl,
  zoom,
  pageElementRef,
  onImageLoad,
}) => {
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
    sceneWidth: number;
    sceneHeight: number;
  } | null>(null);
  const onImageLoadRef = useRef(onImageLoad);
  onImageLoadRef.current = onImageLoad;

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const { sceneWidth, sceneHeight } = getImageSceneDimensions(width, height);
    setDimensions({ width, height, sceneWidth, sceneHeight });
    onImageLoadRef.current(width, height, sceneWidth, sceneHeight);
  }, []);

  return (
    <div
      className="image-page-viewer"
      ref={pageElementRef}
      style={{
        width: dimensions ? dimensions.sceneWidth * zoom : undefined,
        height: dimensions ? dimensions.sceneHeight * zoom : undefined,
      }}
    >
      <div
        className="page"
        style={{
          width: dimensions ? dimensions.sceneWidth * zoom : undefined,
          height: dimensions ? dimensions.sceneHeight * zoom : undefined,
        }}
      >
        <img
          src={imageUrl}
          onLoad={handleLoad}
          alt="Document image"
          draggable={false}
        />
      </div>
    </div>
  );
};
