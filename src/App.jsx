import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import TitleBar from './components/TitleBar';
import Navbar from './components/Navbar';
import ToastContainer from './components/ToastContainer';
import ConverterTab from './tabs/ConverterTab';
import TrimmerTab from './tabs/TrimmerTab';
import QueueTab from './tabs/QueueTab';
import SettingsTab from './tabs/SettingsTab';
import { playCompletionChime } from './utils/sound';
import { validateMediaFile } from './utils/fileTypes';
import { loadSettings, saveSettings } from './utils/settings';

const PROBE_CONCURRENCY = 2;
const LOG_CHUNKS_PER_JOB = 150;
let idCounter = 0;
const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(idCounter += 1)}`;

/** Fields the main process needs; UI bookkeeping (logs, progress) stays in the renderer. */
function toJobConfig(job) {
  const { jobId, inputFile, outputFile, mode, duration, options } = job;
  return { jobId, inputFile, outputFile, mode, duration, options };
}

export default function App() {
  const [activeTab, setActiveTab] = useState('convert');
  const [files, setFiles] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [appOutputDir, setAppOutputDir] = useState('');
  const [ffmpegStatus, setFfmpegStatus] = useState(null);
  const [isDownloadingFfmpeg, setIsDownloadingFfmpeg] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [settings, setSettings] = useState(loadSettings);

  const [updateState, setUpdateState] = useState({
    status: 'idle',
    currentVersion: __APP_VERSION__,
    latestVersion: __APP_VERSION__,
    downloadPercent: 0,
    error: null,
  });

  const filesRef = useRef(files);
  filesRef.current = files;
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const startedJobsRef = useRef(new Set());
  const batchRef = useRef({ ids: new Set(), lastOutput: null });

  const outputDir = settings.outputDir || appOutputDir;
  const activeFile = files.find((f) => f.id === activeFileId) || null;
  const mediaInfo = activeFile?.mediaInfo || null;

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  // Toast helper with graceful exit animation
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300);
  }, []);

  const showToast = useCallback(
    (message, type = 'info') => {
      const id = nextId('toast');
      // Batches can produce many messages at once: keep the stack short.
      setToasts((prev) => [...prev.slice(-4), { id, message, type, exiting: false }]);
      setTimeout(() => dismissToast(id), 4200);
    },
    [dismissToast]
  );

  // Appearance
  useEffect(() => {
    document.documentElement.dataset.accent = settings.accent;
  }, [settings.accent]);

  // Engine preferences live in the main process
  useEffect(() => {
    window.itzCutAPI?.setEngineSettings?.({
      forceSoftware: settings.encoder === 'cpu',
      priority: settings.priority,
      hwDecode: settings.hwDecode,
    });
  }, [settings.encoder, settings.priority, settings.hwDecode]);

  // Startup + main-process subscriptions
  useEffect(() => {
    const api = window.itzCutAPI;
    if (!api) return undefined;

    api.getDefaultOutputDir().then(setAppOutputDir);
    api.getFfmpegStatus().then((status) => {
      setFfmpegStatus(status);
      if (!status.available) {
        showToast('FFmpeg was not detected on your system. Head to Settings to download it automatically.', 'error');
      }
    });

    const finishJob = (jobId, patch) =>
      setJobs((prev) => prev.map((j) => (j.jobId === jobId && j.status === 'processing' ? { ...j, ...patch, finishedAt: Date.now() } : j)));

    const unsubs = [
      api.onJobProgress((data) => {
        setJobs((prev) => prev.map((j) => (j.jobId === data.jobId && j.status === 'processing' ? { ...j, progress: data } : j)));
      }),
      api.onJobComplete((data) => {
        batchRef.current.lastOutput = data.outputPath;
        finishJob(data.jobId, { status: 'completed', outputSize: data.outputSize, outputPath: data.outputPath, progress: { percent: 100 } });
        const job = jobsRef.current.find((j) => j.jobId === data.jobId);
        showToast(`Finished: ${job?.inputName || 'export'}`, 'success');
      }),
      api.onJobCanceled((data) => {
        setJobs((prev) => prev.filter((j) => j.jobId !== data.jobId));
        showToast('Task canceled and partial file cleaned up.', 'info');
      }),
      api.onJobError((data) => {
        finishJob(data.jobId, { status: 'error', error: data.error });
        showToast(`Processing error: ${data.error}`, 'error');
      }),
      api.onFfmpegDownloadProgress(setDownloadProgress),
    ];

    // FFmpeg prints several status lines per second per job: buffer them and commit at most
    // a few times per second instead of re-rendering the whole app on every chunk.
    const pendingLogs = new Map();
    let logFlushTimer = null;
    const flushLogs = () => {
      logFlushTimer = null;
      if (pendingLogs.size === 0) return;
      const batch = new Map(pendingLogs);
      pendingLogs.clear();
      setJobs((prev) =>
        prev.map((j) => {
          const chunks = batch.get(j.jobId);
          if (!chunks) return j;
          const logs = [...(j.logs || []), ...chunks];
          return { ...j, logs: logs.length > LOG_CHUNKS_PER_JOB ? logs.slice(-LOG_CHUNKS_PER_JOB) : logs };
        })
      );
    };
    unsubs.push(
      api.onJobLog((data) => {
        const chunks = pendingLogs.get(data.jobId) || [];
        chunks.push(data.text);
        pendingLogs.set(data.jobId, chunks);
        if (!logFlushTimer) logFlushTimer = setTimeout(flushLogs, 250);
      })
    );

    // Auto-Updater subscriptions
    unsubs.push(
      api.onUpdateStatus((data) => {
        if (data.status === 'checking') {
          setUpdateState((prev) => ({ ...prev, status: 'checking', error: null }));
        } else if (data.status === 'available') {
          setUpdateState((prev) => ({ ...prev, status: 'downloading', latestVersion: data.updateInfo?.version || prev.latestVersion, downloadPercent: 0 }));
          showToast(`New update v${data.updateInfo.version} found! Downloading automatically...`, 'info');
        } else if (data.status === 'up-to-date') {
          setUpdateState((prev) => ({ ...prev, status: 'up-to-date', latestVersion: data.latestVersion || prev.currentVersion }));
          if (data.manual) showToast(`itzCut Desktop is up to date (v${data.currentVersion || __APP_VERSION__})!`, 'success');
        } else if (data.status === 'error') {
          setUpdateState((prev) => ({ ...prev, status: 'error', error: data.error }));
          if (data.manual) showToast(`Update check failed: ${data.error}`, 'error');
        }
      }),
      api.onUpdateDownloadProgress((data) => {
        setUpdateState((prev) => ({ ...prev, status: 'downloading', downloadPercent: data.percent }));
      }),
      api.onUpdateDownloaded((data) => {
        setUpdateState((prev) => ({ ...prev, status: 'ready', latestVersion: data.version, downloadPercent: 100 }));
        showToast(`Update v${data.version} downloaded and ready to install!`, 'success');
      })
    );

    return () => {
      unsubs.forEach((unsub) => unsub && unsub());
      if (logFlushTimer) clearTimeout(logFlushTimer);
    };
  }, [showToast]);

  // ---------------------------------------------------------------- Queue scheduler
  // Jobs wait as 'queued' and start only while fewer than `maxConcurrentJobs` are encoding, so
  // importing ten long recordings never launches ten FFmpeg processes at once.
  useEffect(() => {
    const running = jobs.filter((j) => j.status === 'processing').length;
    const slots = settings.maxConcurrentJobs - running;
    if (slots <= 0) return;
    const toStart = jobs.filter((j) => j.status === 'queued' && !startedJobsRef.current.has(j.jobId)).slice(0, slots);
    if (toStart.length === 0) return;

    const ids = new Set(toStart.map((j) => j.jobId));
    toStart.forEach((job) => startedJobsRef.current.add(job.jobId));
    setJobs((prev) => prev.map((j) => (ids.has(j.jobId) ? { ...j, status: 'processing', startedAt: Date.now() } : j)));

    toStart.forEach((job) => {
      window.itzCutAPI.startJob(toJobConfig(job)).catch((err) => {
        // Failures normally arrive as 'job:error'; this covers anything rejected before that.
        setJobs((prev) =>
          prev.map((j) => (j.jobId === job.jobId && j.status === 'processing' ? { ...j, status: 'error', error: err.message, finishedAt: Date.now() } : j))
        );
      });
    });
  }, [jobs, settings.maxConcurrentJobs]);

  // Taskbar progress, sleep prevention and the end-of-queue summary
  const lastReportRef = useRef('');
  const wasBusyRef = useRef(false);
  useEffect(() => {
    const processing = jobs.filter((j) => j.status === 'processing').length;
    const queued = jobs.filter((j) => j.status === 'queued').length;
    const busy = processing + queued > 0;
    const batch = batchRef.current;

    if (busy) jobs.forEach((j) => (j.status === 'processing' || j.status === 'queued') && batch.ids.add(j.jobId));
    const batchJobs = jobs.filter((j) => batch.ids.has(j.jobId));
    const progress = batchJobs.length
      ? batchJobs.reduce((sum, j) => sum + (j.status === 'queued' ? 0 : j.status === 'processing' ? j.progress?.percent || 0 : 100), 0) / (batchJobs.length * 100)
      : -1;

    const report = `${processing}|${queued}|${Math.round(progress * 100)}|${settings.keepAwake}`;
    if (report !== lastReportRef.current) {
      lastReportRef.current = report;
      window.itzCutAPI?.reportQueueState?.({ active: processing, queued, progress: busy ? progress : -1, keepAwake: settings.keepAwake });
    }

    if (wasBusyRef.current && !busy) {
      const done = batchJobs.filter((j) => j.status === 'completed').length;
      const failed = batchJobs.filter((j) => j.status === 'error').length;
      const prefs = settingsRef.current;
      if (done + failed > 0) {
        if (prefs.completionSound && done > 0) playCompletionChime();
        const summary = failed > 0 ? `${done} finished, ${failed} failed.` : `${done} ${done === 1 ? 'file is' : 'files are'} ready.`;
        if (prefs.notifyOnFinish) {
          window.itzCutAPI?.isFocused?.().then((focused) => {
            if (!focused) window.itzCutAPI.notify('itzCut: queue finished', summary);
          });
        }
        if (batchJobs.length > 1) showToast(`Queue finished: ${summary}`, failed > 0 ? 'error' : 'success');
        if (prefs.openFolderWhenDone && done > 0 && batch.lastOutput) window.itzCutAPI?.showInFolder(batch.lastOutput);
      }
      batchRef.current = { ids: new Set(), lastOutput: null };
    }
    wasBusyRef.current = busy;
  }, [jobs, settings.keepAwake, showToast]);

  // ---------------------------------------------------------------- Files
  const probeFiles = useCallback(async (items) => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        let info = null;
        let probeError = null;
        try {
          info = await window.itzCutAPI.probeFile(item.path);
        } catch (err) {
          probeError = err.message;
          info = {
            duration: 0,
            size: item.size,
            video: item.category === 'video' ? { width: 1920, height: 1080, fps: 30, codec: item.ext } : null,
            audio: item.category === 'audio' ? { codec: item.ext, channels: 2, sampleRate: 44100 } : null,
            audioTracks: [],
          };
        }
        setFiles((prev) => prev.map((f) => (f.id === item.id ? { ...f, mediaInfo: info, probing: false, probeError } : f)));
      }
    };
    await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));
  }, []);

  const handleAddFiles = useCallback(
    (list) => {
      const known = new Set(filesRef.current.map((f) => f.path.toLowerCase()));
      const added = [];
      let duplicates = 0;
      let rejected = 0;
      let lastError = '';

      for (const file of list || []) {
        if (!file || !file.path) {
          rejected += 1;
          continue;
        }
        const validation = validateMediaFile(file);
        if (!validation.valid) {
          rejected += 1;
          lastError = validation.error;
          continue;
        }
        const key = file.path.toLowerCase();
        if (known.has(key)) {
          duplicates += 1;
          continue;
        }
        known.add(key);
        added.push({
          id: nextId('file'),
          path: file.path,
          name: file.name,
          size: file.size || 0,
          ext: validation.ext,
          category: validation.category,
          mediaInfo: null,
          probing: true,
          probeError: null,
        });
      }

      if (added.length === 0) {
        if (duplicates > 0) showToast(duplicates === 1 ? 'That file is already loaded.' : 'Those files are already loaded.', 'info');
        else if (rejected > 0) showToast(lastError || 'Unsupported file.', 'error');
        return;
      }

      setFiles((prev) => [...prev, ...added]);
      setActiveFileId((current) => (current && filesRef.current.some((f) => f.id === current) ? current : added[0].id));
      if (window.itzCutAPI) probeFiles(added);

      const extra = [duplicates > 0 && `${duplicates} already loaded`, rejected > 0 && `${rejected} unsupported`].filter(Boolean).join(', ');
      const message = added.length === 1 ? `Loaded ${added[0].category}: ${added[0].name}` : `Added ${added.length} files`;
      showToast(extra ? `${message} (${extra})` : message, 'info');
    },
    [probeFiles, showToast]
  );

  const handleRemoveFile = useCallback((id) => {
    const index = filesRef.current.findIndex((f) => f.id === id);
    const remaining = filesRef.current.filter((f) => f.id !== id);
    setFiles(remaining);
    setActiveFileId((current) => {
      if (current !== id) return current;
      const neighbour = remaining[Math.min(index, remaining.length - 1)];
      return neighbour ? neighbour.id : null;
    });
  }, []);

  const handleClearFiles = useCallback(() => {
    setFiles([]);
    setActiveFileId(null);
  }, []);

  const handleResetApp = () => {
    handleClearFiles();
    setActiveTab('convert');
    showToast('Application reset to Home', 'info');
  };

  // ---------------------------------------------------------------- Jobs
  const handleAddJobs = useCallback(
    (configs) => {
      const now = Date.now();
      const newJobs = configs.map((config, i) => ({
        ...config,
        jobId: nextId(config.mode || 'job'),
        status: 'queued',
        queuedAt: now + i,
        progress: { percent: 0 },
        logs: [],
      }));
      setJobs((prev) => [...prev, ...newJobs]);
      if (settingsRef.current.autoSwitchToQueue) setActiveTab('queue');
      showToast(newJobs.length === 1 ? `Queued: ${newJobs[0].title}` : `Queued ${newJobs.length} jobs`, 'success');
    },
    [showToast]
  );

  const handleCancelJob = (jobId) => {
    const job = jobs.find((j) => j.jobId === jobId);
    if (!job) return;
    if (job.status === 'queued') {
      // Never started: just drop it.
      setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
      return;
    }
    // The 'job:canceled' event removes the job and shows the toast once cleanup has finished.
    window.itzCutAPI?.cancelJob(jobId);
  };

  const handleCancelAllQueued = () => setJobs((prev) => prev.filter((j) => j.status !== 'queued'));

  const handleRetryJob = (jobId) => {
    const job = jobs.find((j) => j.jobId === jobId);
    if (!job) return;
    const { jobId: _old, status, progress, logs, error, finishedAt, startedAt, outputSize, outputPath, ...config } = job;
    setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
    handleAddJobs([config]);
  };

  const handleClearCompleted = () => setJobs((prev) => prev.filter((j) => j.status === 'processing' || j.status === 'queued'));

  // ---------------------------------------------------------------- FFmpeg
  const handleRefreshFfmpeg = async () => {
    if (!window.itzCutAPI) return;
    const status = await window.itzCutAPI.getFfmpegStatus(true);
    setFfmpegStatus(status);
    showToast(status.available ? 'FFmpeg verified and ready!' : 'FFmpeg is still missing.', status.available ? 'success' : 'error');
  };

  const handleDownloadFfmpeg = async () => {
    if (!window.itzCutAPI) return;
    setIsDownloadingFfmpeg(true);
    try {
      showToast('FFmpeg download started...', 'info');
      const status = await window.itzCutAPI.downloadFfmpeg();
      setFfmpegStatus(status);
      showToast('FFmpeg downloaded and installed successfully!', 'success');
    } catch (err) {
      showToast(`Download failed: ${err.message}`, 'error');
    } finally {
      setIsDownloadingFfmpeg(false);
      setDownloadProgress(null);
    }
  };

  const pendingJobsCount = useMemo(() => jobs.filter((j) => j.status === 'processing' || j.status === 'queued').length, [jobs]);

  const fileProps = {
    files,
    activeFile,
    mediaInfo,
    onAddFiles: handleAddFiles,
    onRemoveFile: handleRemoveFile,
    onClearFiles: handleClearFiles,
    onSelectFile: setActiveFileId,
    outputDir,
    settings,
    ffmpegStatus,
    onAddJobs: handleAddJobs,
    onShowToast: showToast,
  };

  return (
    <div className="app-container">
      <TitleBar currentFile={activeFile} onResetApp={handleResetApp} />

      <div className="app-main">
        <Navbar activeTab={activeTab} setActiveTab={setActiveTab} activeJobsCount={pendingJobsCount} onResetApp={handleResetApp} />

        <main className="content-viewport">
          <div key={activeTab} className={settings.animations ? 'page-view-animated' : ''}>
            {activeTab === 'convert' && <ConverterTab {...fileProps} />}

            {activeTab === 'trim' && <TrimmerTab {...fileProps} />}

            {activeTab === 'queue' && (
              <QueueTab
                jobs={jobs}
                maxConcurrentJobs={settings.maxConcurrentJobs}
                onCancelJob={handleCancelJob}
                onCancelAllQueued={handleCancelAllQueued}
                onRetryJob={handleRetryJob}
                onClearCompleted={handleClearCompleted}
                onShowToast={showToast}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsTab
                ffmpegStatus={ffmpegStatus}
                settings={settings}
                onUpdateSettings={updateSettings}
                appOutputDir={appOutputDir}
                onRefreshFfmpeg={handleRefreshFfmpeg}
                onDownloadFfmpeg={handleDownloadFfmpeg}
                downloadProgress={downloadProgress}
                isDownloading={isDownloadingFfmpeg}
                updateState={updateState}
                onCheckForUpdates={async () => {
                  if (!window.itzCutAPI?.checkForUpdates) return;
                  setUpdateState((prev) => ({ ...prev, status: 'checking', error: null }));
                  try {
                    await window.itzCutAPI.checkForUpdates();
                  } catch (err) {
                    setUpdateState((prev) => ({ ...prev, status: 'error', error: err.message }));
                    showToast('Error checking for updates: ' + err.message, 'error');
                  }
                }}
                onInstallUpdate={() => window.itzCutAPI?.quitAndInstallUpdate?.()}
                onShowToast={showToast}
              />
            )}
          </div>
        </main>

        <footer className="app-footer-bar">
          <div>
            <span>© 2026 </span>
            <span className="app-footer-link" onClick={() => window.itzCutAPI && window.itzCutAPI.openExternal('https://itzcrih.it')}>
              itzcrih.it
            </span>
            <span> — Lightweight video renderer</span>
          </div>

          <div>
            <span>Join our Discord: </span>
            <span className="app-footer-link" onClick={() => window.itzCutAPI && window.itzCutAPI.openExternal('https://community.itzcrih.it')}>
              community.itzcrih.it
            </span>
          </div>

          <div>
            <span style={{ fontFamily: 'var(--font-mono)' }}>itzCut Desktop v{__APP_VERSION__}</span>
          </div>
        </footer>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
