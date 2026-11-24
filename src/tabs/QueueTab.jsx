import React, { useState, useMemo } from 'react';
import { Layers, CheckCircle, XCircle, Folder, Play, Terminal, Trash2, Clock, Copy, Check, RotateCcw, Hourglass, X } from 'lucide-react';
import { formatBytes } from '../utils/formatters';

const baseName = (filePath = '') => filePath.split(/[\\/]/).pop();

function StatusPill({ status }) {
  const labels = { processing: 'Processing', queued: 'Waiting', completed: 'Completed', error: 'Failed' };
  return <span className={`status-pill ${status}`}>{labels[status] || status}</span>;
}

export default function QueueTab({ jobs, maxConcurrentJobs, onCancelJob, onCancelAllQueued, onRetryJob, onClearCompleted, onShowToast }) {
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [copiedJobId, setCopiedJobId] = useState(null);

  const { ordered, counts, waitingOrder } = useMemo(() => {
    const processing = jobs.filter((j) => j.status === 'processing').sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    const queued = jobs.filter((j) => j.status === 'queued').sort((a, b) => a.queuedAt - b.queuedAt);
    const finished = jobs.filter((j) => j.status === 'completed' || j.status === 'error').sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    return {
      ordered: [...processing, ...queued, ...finished],
      counts: {
        processing: processing.length,
        queued: queued.length,
        completed: finished.filter((j) => j.status === 'completed').length,
        error: finished.filter((j) => j.status === 'error').length,
      },
      waitingOrder: new Map(queued.map((j, i) => [j.jobId, i + 1])),
    };
  }, [jobs]);

  const handleCopyLogs = (job) => {
    const text = job.logs && job.logs.length > 0 ? job.logs.join('') : 'No log messages captured.';
    navigator.clipboard.writeText(text);
    setCopiedJobId(job.jobId);
    onShowToast('FFmpeg logs copied to clipboard!', 'success');
    setTimeout(() => setCopiedJobId(null), 2000);
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

  const finishedCount = counts.completed + counts.error;

  return (
    <div className="tab-stack">
      <div className="page-header">
        <div>
          <h2 className="page-title">
            <Layers size={20} className="icon-accent" />
            <span>Queue</span>
          </h2>
          <p className="page-subtitle">
            Jobs run {maxConcurrentJobs === 1 ? 'one at a time' : `${maxConcurrentJobs} at a time`}; the rest wait their turn. Change this in Settings.
          </p>
        </div>

        <div className="page-header-actions">
          {jobs.length > 0 && (
            <div className="queue-counters">
              {counts.processing > 0 && <span className="counter processing">{counts.processing} running</span>}
              {counts.queued > 0 && <span className="counter queued">{counts.queued} waiting</span>}
              {counts.completed > 0 && <span className="counter completed">{counts.completed} done</span>}
              {counts.error > 0 && <span className="counter error">{counts.error} failed</span>}
            </div>
          )}
          {counts.queued > 0 && (
            <button className="btn-secondary btn-compact" onClick={onCancelAllQueued}>
              <X size={14} />
              <span>Cancel Waiting</span>
            </button>
          )}
          {finishedCount > 0 && (
            <button className="btn-secondary btn-compact" onClick={onClearCompleted}>
              <Trash2 size={14} />
              <span>Clear Finished</span>
            </button>
          )}
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="card empty-state">
          <div className="upload-icon" style={{ margin: 0 }}>
            <Clock size={28} />
          </div>
          <h3>No jobs in queue</h3>
          <p>Start a conversion, compression, or clip trim to view live progress here.</p>
        </div>
      ) : (
        <div className="job-list">
          {ordered.map((job) => {
            const { status } = job;
            const isProcessing = status === 'processing';
            const isQueued = status === 'queued';
            const isCompleted = status === 'completed';
            const isError = status === 'error';
            const percent = isCompleted ? 100 : job.progress?.percent || 0;

            return (
              <div key={job.jobId} className={`job-card ${status}`}>
                <div className="job-header">
                  <div className="job-heading">
                    <div className="job-title-row">
                      <span className="job-title">{job.title}</span>
                      <StatusPill status={status} />
                    </div>
                    <div className="job-source" title={job.inputFile}>
                      {job.inputName}
                      {isCompleted && job.outputPath && (
                        <>
                          <span className="job-arrow">→</span>
                          <span title={job.outputPath}>{baseName(job.outputPath)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="job-actions">
                    {(isProcessing || isQueued) && (
                      <button className="btn-danger btn-compact" onClick={() => onCancelJob(job.jobId)}>
                        <XCircle size={13} />
                        <span>{isQueued ? 'Remove' : 'Cancel'}</span>
                      </button>
                    )}
                    {isCompleted && (
                      <>
                        <button className="btn-gold btn-compact" onClick={() => handleOpenFile(job.outputPath)}>
                          <Play size={13} />
                          <span>Play</span>
                        </button>
                        <button className="btn-secondary btn-compact" onClick={() => handleShowInFolder(job.outputPath)}>
                          <Folder size={13} />
                          <span>Show in Folder</span>
                        </button>
                      </>
                    )}
                    {isError && (
                      <button className="btn-secondary btn-compact" onClick={() => onRetryJob(job.jobId)}>
                        <RotateCcw size={13} />
                        <span>Retry</span>
                      </button>
                    )}
                    {!isQueued && (
                      <button
                        className={`icon-btn ${expandedLogId === job.jobId ? 'active' : ''}`}
                        onClick={() => setExpandedLogId(expandedLogId === job.jobId ? null : job.jobId)}
                        title="FFmpeg log"
                      >
                        <Terminal size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="progress-track">
                  <div className={`progress-fill ${isProcessing ? 'animated' : ''} ${isCompleted ? 'success' : ''} ${isError ? 'error' : ''}`} style={{ width: `${isError ? 100 : percent}%` }} />
                </div>

                <div className="job-stats-row">
                  <div>
                    {isQueued && (
                      <span className="job-waiting">
                        <Hourglass size={12} />
                        Waiting · #{waitingOrder.get(job.jobId)} in line
                      </span>
                    )}
                    {isProcessing && (
                      <span>
                        <strong>{percent}%</strong>
                        {job.progress?.pass && <span className="job-pass">pass {job.progress.pass}/2</span>}
                        {job.progress?.currentTime && ` · ${job.progress.currentTime} / ${job.progress.totalTime || '?'}`}
                      </span>
                    )}
                    {isCompleted && (
                      <span className="job-done">
                        <CheckCircle size={13} />
                        <span>
                          Finished · <strong>{formatBytes(job.outputSize)}</strong>
                        </span>
                      </span>
                    )}
                    {isError && <span className="job-error">{job.error || 'Processing error occurred'}</span>}
                  </div>

                  {isProcessing && (
                    <div className="job-metrics">
                      {job.progress?.fps && <span>{job.progress.fps} fps</span>}
                      {job.progress?.speed && <span>{job.progress.speed}</span>}
                      {job.progress?.eta && <span>ETA {job.progress.eta}</span>}
                    </div>
                  )}
                </div>

                {expandedLogId === job.jobId && (
                  <div className="job-log">
                    <div className="job-log-head">
                      <span>FFmpeg log</span>
                      <button className="btn-secondary btn-xs" onClick={() => handleCopyLogs(job)} title="Copy logs to clipboard">
                        {copiedJobId === job.jobId ? <Check size={12} /> : <Copy size={12} />}
                        <span>{copiedJobId === job.jobId ? 'Copied!' : 'Copy'}</span>
                      </button>
                    </div>
                    <div className="terminal-box">{job.logs && job.logs.length > 0 ? job.logs.join('') : 'No log messages captured yet.'}</div>
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
