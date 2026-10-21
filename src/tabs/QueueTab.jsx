import React, { useState } from 'react';
import {
  Layers,
  CheckCircle,
  AlertCircle,
  XCircle,
  Folder,
  Play,
  Terminal,
  Trash2,
  Clock,
  Copy,
  Check,
} from 'lucide-react';
import { formatBytes } from '../utils/formatters';

export default function QueueTab({ jobs, onCancelJob, onClearCompleted, onShowToast }) {
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [copiedJobId, setCopiedJobId] = useState(null);

  const handleCopyLogs = (job) => {
    const text = (job.logs && job.logs.length > 0) ? job.logs.join('') : 'No log messages captured.';
    navigator.clipboard.writeText(text);
    setCopiedJobId(job.jobId);
    if (onShowToast) onShowToast('FFmpeg logs copied to clipboard!', 'success');
    setTimeout(() => {
      setCopiedJobId(null);
    }, 2000);
  };

  const handleShowInFolder = async (filePath) => {
    if (!window.itzCutAPI) return;
    const ok = await window.itzCutAPI.showInFolder(filePath);
    if (!ok) onShowToast('Unable to open destination folder.', 'error');
  };

  const handleOpenFile = async (filePath) => {
    if (!window.itzCutAPI) return;
    const ok = await window.itzCutAPI.openFile(filePath);
    if (!ok) onShowToast('Unable to launch file.', 'error');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Layers size={20} color="#e6b422" />
            <span>Queue</span>
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Monitor active local background transcoding jobs with realtime speed, FPS, and ETA.
          </p>
        </div>

        {jobs.length > 0 && (
          <button className="btn-secondary" onClick={onClearCompleted}>
            <Trash2 size={14} />
            <span>Clear Completed</span>
          </button>
        )}
      </div>

      {jobs.length === 0 ? (
        <div
          className="card"
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div className="upload-icon" style={{ margin: 0 }}>
            <Clock size={28} />
          </div>
          <h3 style={{ fontSize: '16px', fontWeight: 700 }}>No jobs in queue</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '400px' }}>
            Start a conversion, compression, or clip trim to view live progress here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {jobs.map((job) => {
            const isProcessing = job.status === 'processing';
            const isCompleted = job.status === 'completed';
            const isError = job.status === 'error';
            const isCanceled = job.status === 'canceled';

            return (
              <div
                key={job.jobId}
                className={`job-card ${isProcessing ? 'processing' : ''} ${isCompleted ? 'completed' : ''}`}
              >
                <div className="job-header">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 700 }}>{job.title}</span>
                      {isProcessing && <span className="pill-tag" style={{ color: 'var(--gold-primary)', borderColor: 'var(--gold-primary)' }}>Processing</span>}
                      {isCompleted && <span className="pill-tag" style={{ color: '#7ee787', borderColor: '#2ea043' }}>Completed</span>}
                      {isError && <span className="pill-tag" style={{ color: '#f85149', borderColor: '#f85149' }}>Failed</span>}
                      {isCanceled && <span className="pill-tag" style={{ color: 'var(--text-muted)' }}>Canceled</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
                      Source: {job.inputName}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {isProcessing && (
                      <button
                        className="btn-danger"
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                        onClick={() => onCancelJob(job.jobId)}
                      >
                        <XCircle size={13} />
                        <span>Cancel</span>
                      </button>
                    )}

                    {isCompleted && (
                      <>
                        <button
                          className="btn-gold"
                          style={{ padding: '6px 12px', fontSize: '12px' }}
                          onClick={() => handleOpenFile(job.outputPath)}
                        >
                          <Play size={13} />
                          <span>Play</span>
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ padding: '6px 12px', fontSize: '12px' }}
                          onClick={() => handleShowInFolder(job.outputPath)}
                        >
                          <Folder size={13} />
                          <span>Show in Folder</span>
                        </button>
                      </>
                    )}

                    <button
                      className="icon-btn"
                      onClick={() => setExpandedLogId(expandedLogId === job.jobId ? null : job.jobId)}
                      title="View Raw FFmpeg Logs"
                    >
                      <Terminal size={14} />
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="progress-track">
                  <div
                    className={`progress-fill ${isProcessing ? 'animated' : ''}`}
                    style={{
                      width: `${job.progress?.percent || (isCompleted ? 100 : 0)}%`,
                      backgroundColor: isCompleted ? '#2ea043' : isError ? '#f85149' : undefined,
                    }}
                  />
                </div>

                {/* Job Stats Row */}
                <div className="job-stats-row">
                  <div>
                    {isProcessing && (
                      <span>
                        Progress: <strong>{job.progress?.percent || 0}%</strong>
                        {job.progress?.currentTime && ` (${job.progress.currentTime} / ${job.progress.totalTime || '?'})`}
                      </span>
                    )}
                    {isCompleted && (
                      <span style={{ color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <CheckCircle size={13} color="#7ee787" />
                        <span>Finished! Final size: <strong>{formatBytes(job.outputSize)}</strong></span>
                      </span>
                    )}
                    {isError && <span style={{ color: 'var(--color-error)' }}>{job.error || 'Processing error occurred'}</span>}
                    {isCanceled && <span>Job canceled by user.</span>}
                  </div>

                  {isProcessing && (
                    <div style={{ display: 'flex', gap: '12px' }}>
                      {job.progress?.fps && <span>FPS: {job.progress.fps}</span>}
                      {job.progress?.speed && <span>Speed: {job.progress.speed}</span>}
                      {job.progress?.eta && <span>ETA: ~{job.progress.eta}</span>}
                    </div>
                  )}
                </div>

                {/* Expandable Log Drawer */}
                {expandedLogId === job.jobId && (
                  <div style={{ marginTop: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 600 }}>
                        RAW FFTRANSCODE LOGS:
                      </span>
                      <button
                        className="btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px', gap: '4px', height: '24px' }}
                        onClick={() => handleCopyLogs(job)}
                        title="Copy logs to clipboard"
                      >
                        {copiedJobId === job.jobId ? <Check size={12} color="#7ee787" /> : <Copy size={12} />}
                        <span>{copiedJobId === job.jobId ? 'Copied!' : 'Copy Logs'}</span>
                      </button>
                    </div>
                    <div className="terminal-box">
                      {job.logs && job.logs.length > 0
                        ? job.logs.join('')
                        : 'No log messages captured yet.'}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
