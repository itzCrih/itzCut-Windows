import React, { useState } from 'react';
import { UploadCloud, FileVideo, Music, X, RefreshCw } from 'lucide-react';
import { formatBytes, formatSeconds } from '../utils/formatters';

export default function DropZone({ currentFile, mediaInfo, onFileSelected, onFileCleared, isAudioOnly = false }) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleBrowse = async () => {
    if (!window.itzCutAPI) return;
    try {
      const file = await window.itzCutAPI.openFileDialog({
        filters: isAudioOnly
          ? [
              { name: 'Audio Files', extensions: ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'opus'] },
              { name: 'All Files', extensions: ['*'] },
            ]
          : [
              { name: 'Video & Audio Files', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'gif'] },
              { name: 'All Files', extensions: ['*'] },
            ],
      });
      if (file) {
        onFileSelected(file);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      let filePath = '';
      if (window.itzCutAPI?.getPathForFile) {
        try {
          filePath = window.itzCutAPI.getPathForFile(droppedFile);
        } catch (err) {
          console.error('getPathForFile failed:', err);
        }
      }
      if (!filePath && droppedFile.path) {
        filePath = droppedFile.path;
      }

      onFileSelected({
        path: filePath,
        name: droppedFile.name,
        size: droppedFile.size,
        ext: droppedFile.name.split('.').pop().toLowerCase(),
      });
    }
  };

  if (currentFile) {
    const isVideo = mediaInfo?.video !== null;
    return (
      <div className="media-loaded-card">
        <div className="media-info-left">
          <div className="media-file-icon">
            {isVideo ? <FileVideo size={24} /> : <Music size={24} />}
          </div>
          <div className="media-meta-details">
            <div className="media-filename" title={currentFile.path}>
              {currentFile.name}
            </div>
            <div className="media-specs">
              <span>{formatBytes(currentFile.size)}</span>
              {mediaInfo && (
                <>
                  <span className="spec-dot">•</span>
                  <span>{formatSeconds(mediaInfo.duration)}</span>
                  {mediaInfo.video && (
                    <>
                      <span className="spec-dot">•</span>
                      <span>{mediaInfo.video.width}×{mediaInfo.video.height}</span>
                      <span className="spec-dot">•</span>
                      <span>{mediaInfo.video.fps} fps ({mediaInfo.video.codec})</span>
                    </>
                  )}
                  {mediaInfo.audio && (
                    <>
                      <span className="spec-dot">•</span>
                      <span>{mediaInfo.audio.codec} ({mediaInfo.audio.sampleRate} Hz)</span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-secondary" onClick={handleBrowse} title="Choose another file">
            <RefreshCw size={14} />
            <span>Replace</span>
          </button>
          <button className="btn-secondary" onClick={onFileCleared} title="Remove file">
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`upload-zone ${isDragOver ? 'drag-active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleBrowse}
    >
      <div className="upload-icon">
        <UploadCloud size={28} />
      </div>
      <h3 className="upload-title">Drag & drop your media file here</h3>
      <p className="upload-desc">or click anywhere in this zone to browse from your computer</p>

      <div className="supported-badges">
        <span className="pill-tag">MP4</span>
        <span className="pill-tag">MKV</span>
        <span className="pill-tag">MOV</span>
        <span className="pill-tag">WEBM</span>
        <span className="pill-tag">AVI</span>
        <span className="pill-tag">MP3</span>
        <span className="pill-tag">WAV</span>
        <span className="pill-tag">FLAC</span>
        <span className="pill-tag">GIF</span>
      </div>
    </div>
  );
}
