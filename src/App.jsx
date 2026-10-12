import React, { useState, useEffect } from 'react';
import TitleBar from './components/TitleBar';
import Navbar from './components/Navbar';
import ToastContainer from './components/ToastContainer';
import ConverterTab from './tabs/ConverterTab';
import TrimmerTab from './tabs/TrimmerTab';
import QueueTab from './tabs/QueueTab';
import SettingsTab from './tabs/SettingsTab';
import { playCompletionChime } from './utils/sound';

export default function App() {
  const [activeTab, setActiveTab] = useState('convert');
  const [currentFile, setCurrentFile] = useState(null);
  const [mediaInfo, setMediaInfo] = useState(null);
  const [defaultOutputDir, setDefaultOutputDir] = useState('');
  const [ffmpegStatus, setFfmpegStatus] = useState(null);
  const [isDownloadingFfmpeg, setIsDownloadingFfmpeg] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [animationsEnabled, setAnimationsEnabled] = useState(() => {
    try {
      return localStorage.getItem('itzcut_animations') !== 'false';
    } catch {
      return true;
    }
  });

  // Toast helper with graceful exit animation
  const showToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type, exiting: false }]);
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
      );
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 300);
    }, 4200);
  };

  const dismissToast = (id) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  };

  // Initial startup probe
  useEffect(() => {
    if (!window.itzCutAPI) return;

    window.itzCutAPI.getDefaultOutputDir().then(setDefaultOutputDir);

    window.itzCutAPI.getFfmpegStatus().then((status) => {
      setFfmpegStatus(status);
      if (!status.available) {
        showToast('FFmpeg was not detected on your system. Head to Settings to download it automatically.', 'error');
      }
    });

    // Subscriptions
    const unsubProgress = window.itzCutAPI.onJobProgress((data) => {
      setJobs((prev) =>
        prev.map((j) => (j.jobId === data.jobId ? { ...j, progress: data } : j))
      );
    });

    const unsubComplete = window.itzCutAPI.onJobComplete((data) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.jobId === data.jobId
            ? { ...j, status: 'completed', outputSize: data.outputSize, outputPath: data.outputPath }
            : j
        )
      );
      playCompletionChime();
      showToast(`Processing finished successfully!`, 'success');
    });

    const unsubCanceled = window.itzCutAPI.onJobCanceled && window.itzCutAPI.onJobCanceled((data) => {
      setJobs((prev) => prev.filter((j) => j.jobId !== data.jobId));
      showToast('Task canceled and partial file cleaned up.', 'info');
    });

    const unsubError = window.itzCutAPI.onJobError((data) => {
      setJobs((prev) =>
        prev.map((j) => (j.jobId === data.jobId ? { ...j, status: 'error', error: data.error } : j))
      );
      showToast(`Processing error: ${data.error}`, 'error');
    });

    const unsubLog = window.itzCutAPI.onJobLog((data) => {
      setJobs((prev) =>
        prev.map((j) => {
          if (j.jobId === data.jobId) {
            const logs = j.logs ? [...j.logs, data.text] : [data.text];
            if (logs.length > 150) logs.shift();
            return { ...j, logs };
          }
          return j;
        })
      );
    });

    const unsubDownload = window.itzCutAPI.onFfmpegDownloadProgress((data) => {
      setDownloadProgress(data);
    });

    return () => {
      if (unsubProgress) unsubProgress();
      if (unsubComplete) unsubComplete();
      if (unsubCanceled) unsubCanceled();
      if (unsubError) unsubError();
      if (unsubLog) unsubLog();
      if (unsubDownload) unsubDownload();
    };
  }, []);

  // Application Reset handler
  const handleResetApp = () => {
    setCurrentFile(null);
    setMediaInfo(null);
    setActiveTab('convert');
    showToast('Application reset to Home', 'info');
  };

  // When a file is selected, probe its metadata
  const handleFileSelected = async (file) => {
    if (!file || !file.path) {
      showToast('Could not resolve file path. Please use the Browse button to select this file.', 'error');
      return;
    }
    setCurrentFile(file);
    setMediaInfo(null);
    if (!window.itzCutAPI) return;

    try {
      const probeData = await window.itzCutAPI.probeFile(file.path);
      setMediaInfo(probeData);
      showToast(`Loaded file: ${file.name}`, 'info');
    } catch (err) {
      console.warn('Probe error:', err);
      setMediaInfo({
        duration: 0,
        size: file.size,
        video: { width: 1920, height: 1080, fps: 30, codec: file.ext },
      });
    }
  };

  const handleFileCleared = () => {
    setCurrentFile(null);
    setMediaInfo(null);
  };

  const handleAddJob = async (jobConfig) => {
    const newJob = {
      ...jobConfig,
      status: 'processing',
      progress: { percent: 0 },
      logs: [],
    };
    setJobs((prev) => [newJob, ...prev]);

    // Automatically switch to queue tab to show realtime progress
    setActiveTab('queue');

    try {
      await window.itzCutAPI.startJob(jobConfig);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCancelJob = (jobId) => {
    if (window.itzCutAPI) {
      window.itzCutAPI.cancelJob(jobId);
      setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
      showToast('Task canceled and file cleaned up.', 'info');
    }
  };

  const handleClearCompleted = () => {
    setJobs((prev) => prev.filter((j) => j.status === 'processing'));
  };

  const handleRefreshFfmpeg = async () => {
    if (!window.itzCutAPI) return;
    const status = await window.itzCutAPI.getFfmpegStatus();
    setFfmpegStatus(status);
    showToast(status.available ? 'FFmpeg verified and ready!' : 'FFmpeg is still missing.', status.available ? 'success' : 'error');
  };

  const handleDownloadFfmpeg = async () => {
    if (!window.itzCutAPI) return;
    setIsDownloadingFfmpeg(true);
    try {
      showToast('Static FFmpeg download started...', 'info');
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

  const activeJobsCount = jobs.filter((j) => j.status === 'processing').length;

  return (
    <div className="app-container">
      <TitleBar currentFile={currentFile} onResetApp={handleResetApp} />

      <div className="app-main">
        <Navbar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          activeJobsCount={activeJobsCount}
          ffmpegStatus={ffmpegStatus}
          onResetApp={handleResetApp}
        />

        <main className="content-viewport">
          <div key={activeTab} className={animationsEnabled ? 'page-view-animated' : ''}>
            {activeTab === 'convert' && (
              <ConverterTab
                currentFile={currentFile}
                mediaInfo={mediaInfo}
                onFileSelected={handleFileSelected}
                onFileCleared={handleFileCleared}
                defaultOutputDir={defaultOutputDir}
                onAddJob={handleAddJob}
                onShowToast={showToast}
              />
            )}

            {activeTab === 'trim' && (
              <TrimmerTab
                currentFile={currentFile}
                mediaInfo={mediaInfo}
                onFileSelected={handleFileSelected}
                onFileCleared={handleFileCleared}
                defaultOutputDir={defaultOutputDir}
                onAddJob={handleAddJob}
                onShowToast={showToast}
              />
            )}

            {activeTab === 'queue' && (
              <QueueTab
                jobs={jobs}
                onCancelJob={handleCancelJob}
                onClearCompleted={handleClearCompleted}
                onShowToast={showToast}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsTab
                ffmpegStatus={ffmpegStatus}
                defaultOutputDir={defaultOutputDir}
                onRefreshFfmpeg={handleRefreshFfmpeg}
                onDownloadFfmpeg={handleDownloadFfmpeg}
                downloadProgress={downloadProgress}
                isDownloading={isDownloadingFfmpeg}
                animationsEnabled={animationsEnabled}
                onToggleAnimations={(val) => {
                  setAnimationsEnabled(val);
                  localStorage.setItem('itzcut_animations', val ? 'true' : 'false');
                }}
                onShowToast={showToast}
              />
            )}
          </div>
        </main>

        <footer className="app-footer-bar">
          <div>
            <span>© 2026 </span>
            <span
              className="app-footer-link"
              onClick={() => window.itzCutAPI && window.itzCutAPI.openExternal('https://itzcrih.it')}
            >
              itzcrih.it
            </span>
            <span> — Lightweight video renderer</span>
          </div>

          <div>
            <span>Join our Discord: </span>
            <span
              className="app-footer-link"
              onClick={() => window.itzCutAPI && window.itzCutAPI.openExternal('https://community.itzcrih.it')}
            >
              community.itzcrih.it
            </span>
          </div>

          <div>
            <span style={{ fontFamily: 'var(--font-mono)' }}>itzCut Desktop v2.0.0</span>
          </div>
        </footer>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
