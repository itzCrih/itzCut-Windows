import React, { useState } from 'react';
import { UploadCloud, FileVideo, Music, X, FilePlus2, FolderPlus, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import { formatBytes, formatSeconds } from '../utils/formatters';

/** Reads absolute paths from a drop event (files and folders alike). */
function droppedPaths(event) {
  const paths = [];
  for (const file of Array.from(event.dataTransfer.files || [])) {
    let filePath = '';
    try {
      filePath = window.itzCutAPI?.getPathForFile ? window.itzCutAPI.getPathForFile(file) : '';
    } catch {
      filePath = '';
    }
    if (filePath) paths.push(filePath);
  }
  return paths;
}

function FileSpecs({ file }) {
  const info = file.mediaInfo;
  if (file.probing) {
    return (
      <span className="media-specs">
        <span>{formatBytes(file.size)}</span>
        <span className="spec-dot">•</span>
        <span className="probing">
          <RefreshCw size={11} className="spin" /> Reading metadata…
        </span>
      </span>
    );
  }
  return (
    <span className="media-specs">
      <span>{formatBytes(file.size)}</span>
      {info && (
        <>
          <span className="spec-dot">•</span>
          <span>{formatSeconds(info.duration)}</span>
          {info.video && (
            <>
              <span className="spec-dot">•</span>
              <span>
                {info.video.width}×{info.video.height}
              </span>
              <span className="spec-dot">•</span>
              <span>
                {info.video.fps} fps {info.video.codec}
              </span>
            </>
          )}
          {info.audioTracks && info.audioTracks.length > 1 ? (
            <>
              <span className="spec-dot">•</span>
              <span>{info.audioTracks.length} audio tracks</span>
            </>
          ) : (
            info.audio && (
              <>
                <span className="spec-dot">•</span>
                <span>
                  {info.audio.codec} {info.audio.sampleRate ? `${Math.round(info.audio.sampleRate / 100) / 10} kHz` : ''}
                </span>
              </>
            )
          )}
        </>
      )}
      {file.probeError && (
        <span className="probe-error" title={file.probeError}>
          <AlertTriangle size={11} /> metadata unavailable
        </span>
      )}
    </span>
  );
}

/**
 * Loaded media: an import zone while empty, then the active file plus (for several files) the
 * batch list. Accepts files and whole folders by drag & drop or through the pickers.
 */
export default function MediaTray({ files, activeFileId, onSelect, onRemove, onClear, onAddFiles, onShowToast, batchHint = null }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const activeFile = files.find((f) => f.id === activeFileId) || files[0] || null;

  const importResult = (result) => {
    if (!result) return;
    if (result.files.length === 0) {
      onShowToast('No video or audio files were found there.', 'error');
      return;
    }
    if (result.truncated) onShowToast(`Only the first ${result.limit} media files were imported.`, 'info');
    onAddFiles(result.files);
  };

  const run = async (task) => {
    if (!window.itzCutAPI || isImporting) return;
    setIsImporting(true);
    try {
      await task();
    } catch (err) {
      onShowToast(`Import failed: ${err.message}`, 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const browseFiles = (event) => {
    event?.stopPropagation();
    run(async () => {
      const picked = await window.itzCutAPI.openFileDialog({ multi: true });
      if (picked && picked.length) onAddFiles(picked);
    });
  };

  const browseFolder = (event) => {
    event?.stopPropagation();
    run(async () => importResult(await window.itzCutAPI.openMediaFolderDialog()));
  };

  const dragProps = {
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!isDragOver) setIsDragOver(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false);
    },
    onDrop: (e) => {
      e.preventDefault();
      setIsDragOver(false);
      const paths = droppedPaths(e);
      if (paths.length === 0) {
        onShowToast('Could not read the dropped items. Use the Browse button instead.', 'error');
        return;
      }
      run(async () => importResult(await window.itzCutAPI.expandMediaPaths(paths)));
    },
  };

  if (!activeFile) {
    return (
      <div className={`upload-zone ${isDragOver ? 'drag-active' : ''}`} {...dragProps} onClick={browseFiles} role="button" tabIndex={0}>
        <div className="upload-icon">{isImporting ? <RefreshCw size={26} className="spin" /> : <UploadCloud size={28} />}</div>
        <h3 className="upload-title">Drop videos, audio or a whole folder</h3>
        <p className="upload-desc">Import as many files as you like: they are processed one after another in the queue.</p>
        <div className="upload-actions">
          <button type="button" className="btn-gold" onClick={browseFiles} disabled={isImporting}>
            <FilePlus2 size={15} />
            <span>Browse Files</span>
          </button>
          <button type="button" className="btn-secondary" onClick={browseFolder} disabled={isImporting}>
            <FolderPlus size={15} />
            <span>Import Folder</span>
          </button>
        </div>
        <div className="supported-badges">
          {['MP4', 'MKV', 'MOV', 'WEBM', 'AVI', 'MP3', 'WAV', 'FLAC', 'GIF'].map((ext) => (
            <span key={ext} className="pill-tag">
              {ext}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const isBatch = files.length > 1;
  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
  const totalDuration = files.reduce((sum, f) => sum + (f.mediaInfo?.duration || 0), 0);
  const activeIsVideo = activeFile.category !== 'audio' && activeFile.mediaInfo?.video !== null;

  return (
    <div className={`media-tray ${isDragOver ? 'drag-active' : ''}`} {...dragProps}>
      <div className="media-loaded-card">
        <div className="media-info-left">
          <div className="media-file-icon">{activeIsVideo ? <FileVideo size={22} /> : <Music size={22} />}</div>
          <div className="media-meta-details">
            <div className="media-filename" title={activeFile.path}>
              {activeFile.name}
            </div>
            <FileSpecs file={activeFile} />
          </div>
        </div>

        <div className="media-tray-actions">
          <button className="btn-secondary btn-compact" onClick={browseFiles} title="Add more files" disabled={isImporting}>
            <FilePlus2 size={14} />
            <span>Add Files</span>
          </button>
          <button className="btn-secondary btn-compact" onClick={browseFolder} title="Add every media file from a folder" disabled={isImporting}>
            <FolderPlus size={14} />
            <span>Folder</span>
          </button>
          <button
            className="btn-secondary btn-compact btn-icon-only"
            onClick={() => (isBatch ? onRemove(activeFile.id) : onClear())}
            title={isBatch ? 'Remove this file from the list' : 'Remove file'}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {isBatch && (
        <div className="batch-list-card">
          <div className="batch-list-head">
            <span className="batch-list-title">
              <strong>{files.length}</strong> files loaded
              <span className="spec-dot">•</span>
              {formatBytes(totalSize)}
              {totalDuration > 0 && (
                <>
                  <span className="spec-dot">•</span>
                  {formatSeconds(totalDuration)} total
                </>
              )}
            </span>
            {batchHint && <span className="batch-hint">{batchHint}</span>}
            <button type="button" className="link-btn" onClick={onClear}>
              <Trash2 size={12} />
              <span>Clear all</span>
            </button>
          </div>
          <div className="batch-list" role="listbox" aria-label="Loaded files">
            {files.map((file, index) => {
              const isActive = file.id === activeFile.id;
              const isAudio = file.category === 'audio';
              return (
                <div
                  key={file.id}
                  role="option"
                  aria-selected={isActive}
                  tabIndex={0}
                  className={`batch-row ${isActive ? 'active' : ''}`}
                  onClick={() => onSelect(file.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(file.id);
                    }
                  }}
                >
                  <span className="batch-index">{index + 1}</span>
                  {isAudio ? <Music size={14} className="batch-icon" /> : <FileVideo size={14} className="batch-icon" />}
                  <span className="batch-name" title={file.path}>
                    {file.name}
                  </span>
                  <span className="batch-meta">
                    {file.probing ? <RefreshCw size={11} className="spin" /> : file.mediaInfo?.duration ? formatSeconds(file.mediaInfo.duration) : '—'}
                  </span>
                  <span className="batch-meta size">{formatBytes(file.size, 1)}</span>
                  <button
                    type="button"
                    className="batch-remove"
                    title="Remove from list"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(file.id);
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
