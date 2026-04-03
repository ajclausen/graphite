import React, { useCallback } from 'react';
import './FileUpload.css';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect }) => {
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const files = Array.from(e.dataTransfer.files);
      const pdfFile = files.find(file => file.type === 'application/pdf');

      if (pdfFile) {
        onFileSelect(pdfFile);
      } else {
        alert('Please upload a PDF file');
      }
    },
    [onFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && file.type === 'application/pdf') {
        onFileSelect(file);
      } else {
        alert('Please upload a PDF file');
      }
    },
    [onFileSelect]
  );

  return (
    <div className="file-upload-container">
      <div
        className="file-upload-dropzone"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <svg
          className="upload-icon"
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        
        <h2>Drop your PDF here</h2>
        <p>or</p>
        
        <label className="file-upload-button">
          Choose File
          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileInput}
            style={{ display: 'none' }}
          />
        </label>
        
        <p className="file-upload-hint">Maximum file size: 50MB</p>
      </div>
    </div>
  );
};