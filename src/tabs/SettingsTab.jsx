import React, { useState } from 'react';
import {
  Settings,
  Cpu,
  Download,
  Folder,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  HardDrive,
  Info,
  Sparkles,
  Bug,
  FileText,
  Zap,
  Check,
  X,
} from 'lucide-react';

export default function SettingsTab({
  ffmpegStatus,
  defaultOutputDir,
  onRefreshFfmpeg,
  onDownloadFfmpeg,
  downloadProgress,
  isDownloading,
  animationsEnabled = true,
  onToggleAnimations,
  updateState,
  onCheckForUpdates,
  onInstallUpdate,
  onShowToast,
}) {
  const [outputDir, setOutputDir] = useState(defaultOutputDir);
  const [debugMode, setDebugMode] = useState(false);
  const [debugLogPath, setDebugLogPath] = useState('');

  React.useEffect(() => {
    if (window.itzCutAPI?.getDebugMode) {
      window.itzCutAPI.getDebugMode().then((res) => {
        if (res) {
          setDebugMode(!!res.isDebugMode);
          setDebugLogPath(res.logPath || '');
        }
      });
    }
  }, []);

  const handleToggleDebug = async () => {
    if (!window.itzCutAPI?.setDebugMode) return;
    const nextVal = !debugMode;
    const res = await window.itzCutAPI.setDebugMode(nextVal);
    setDebugMode(res?.isDebugMode ?? nextVal);
    if (res?.logPath) setDebugLogPath(res.logPath);
    onShowToast(
      nextVal
        ? 'Debug Mode enabled! Diagnostic logs are writing to itzCut-debug.log on your Desktop.'
        : 'Debug Mode disabled.',
      'info'
    );
  };

  const handleOpenDebugLog = async () => {
    if (!window.itzCutAPI?.openDebugLogFile) return;
    const opened = await window.itzCutAPI.openDebugLogFile();
    if (!opened) {
      onShowToast('No itzCut-debug.log exists on your Desktop yet. Enable debug mode first!', 'info');
    }
  };

  const handlePickOutputDir = async () => {
    if (!window.itzCutAPI) return;
    const folder = await window.itzCutAPI.selectFolderDialog();
    if (folder) {
      setOutputDir(folder);
      onShowToast(`Default destination updated: ${folder}`, 'success');
    }
  };

  const handleOpenFolder = async () => {
    if (!window.itzCutAPI) return;
    await window.itzCutAPI.showInFolder(outputDir || defaultOutputDir);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="grid-2">
        {/* FFmpeg Engine Status Card */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Cpu size={18} />
              <span>FFmpeg Engine & GPU Acceleration</span>
            </div>
            <button className="btn-secondary" onClick={onRefreshFfmpeg} title="Re-check environment">
              <RefreshCw size={13} />
              <span>Re-check</span>
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                background: 'rgba(255, 255, 255, 0.04)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>FFmpeg Status</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {ffmpegStatus?.available
                    ? `Version ${ffmpegStatus.version || '7.1'} (${ffmpegStatus.source === 'system' ? 'System PATH' : 'Local Binary'})`
                    : 'FFmpeg binaries not found'}
                </div>
              </div>

              <div>
                {ffmpegStatus?.available ? (
                  <span className="pill-tag" style={{ color: '#7ee787', borderColor: '#2ea043' }}>
                    <CheckCircle size={12} style={{ display: 'inline', marginRight: '4px' }} />
                    Active
                  </span>
                ) : (
                  <span className="pill-tag" style={{ color: '#f85149', borderColor: '#f85149' }}>
                    <AlertTriangle size={12} style={{ display: 'inline', marginRight: '4px' }} />
                    Missing
                  </span>
                )}
              </div>
            </div>

            {/* Hardware Encoders */}
            <div>
              <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>
                Active Hardware Encoders (GPU Forced by Default)
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span
                  className="pill-tag"
                  style={{
                    color: ffmpegStatus?.hardwareAccels?.nvenc ? '#7ee787' : 'var(--text-dim)',
                    borderColor: ffmpegStatus?.hardwareAccels?.nvenc ? '#2ea043' : 'var(--border-subtle)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                  title={ffmpegStatus?.hardwareAccels?.nvenc ? 'NVIDIA NVENC hardware encoding is available and will be forced' : 'NVIDIA hardware encoder not detected'}
                >
                  <span>NVIDIA NVENC</span>
                  {ffmpegStatus?.hardwareAccels?.nvenc ? <Check size={12} color="#7ee787" /> : <X size={12} color="var(--text-dim)" />}
                </span>
                <span
                  className="pill-tag"
                  style={{
                    color: ffmpegStatus?.hardwareAccels?.qsv ? '#7ee787' : 'var(--text-dim)',
                    borderColor: ffmpegStatus?.hardwareAccels?.qsv ? '#2ea043' : 'var(--border-subtle)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                  title={ffmpegStatus?.hardwareAccels?.qsv ? 'Intel QuickSync hardware encoding is available' : 'Intel QuickSync not detected'}
                >
                  <span>Intel QuickSync</span>
                  {ffmpegStatus?.hardwareAccels?.qsv ? <Check size={12} color="#7ee787" /> : <X size={12} color="var(--text-dim)" />}
                </span>
                <span
                  className="pill-tag"
                  style={{
                    color: ffmpegStatus?.hardwareAccels?.amf ? '#7ee787' : 'var(--text-dim)',
                    borderColor: ffmpegStatus?.hardwareAccels?.amf ? '#2ea043' : 'var(--border-subtle)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                  title={ffmpegStatus?.hardwareAccels?.amf ? 'AMD AMF hardware encoding is available' : 'AMD AMF not detected on this system'}
                >
                  <span>AMD AMF</span>
                  {ffmpegStatus?.hardwareAccels?.amf ? <Check size={12} color="#7ee787" /> : <X size={12} color="var(--text-dim)" />}
                </span>
                <span
                  className="pill-tag"
                  style={{
                    color: '#7ee787',
                    borderColor: '#2ea043',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                  title="Universal CPU software fallback: Always ready if GPU is busy or unsupported"
                >
                  <span>CPU Fallback (libx264)</span>
                  <Check size={12} color="#7ee787" />
                </span>
              </div>
            </div>

            {/* System Hardware Specifications */}
            {ffmpegStatus?.systemInfo && (
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Cpu size={14} color="#e6b422" />
                  <span>Hardware & System Capabilities</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', fontSize: '11.5px', fontFamily: 'var(--font-mono)' }}>
                  <div style={{ color: 'var(--text-muted)' }}>
                    <span style={{ color: 'var(--text-dim)' }}>CPU: </span>
                    <span>{ffmpegStatus.systemInfo.cpuModel || 'Detected CPU'} ({ffmpegStatus.systemInfo.cpuCores || 4} threads)</span>
                  </div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    <span style={{ color: 'var(--text-dim)' }}>RAM: </span>
                    <span>{ffmpegStatus.systemInfo.ramGb || 8} GB Total</span>
                  </div>
                </div>
                {ffmpegStatus.systemInfo.gpuDevices && ffmpegStatus.systemInfo.gpuDevices.length > 0 && (
                  <div style={{ fontSize: '11.5px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                    <span style={{ color: 'var(--text-dim)' }}>Detected GPUs: </span>
                    <span>{ffmpegStatus.systemInfo.gpuDevices.join(' • ')}</span>
                  </div>
                )}
              </div>
            )}

            {/* Path info */}
            {ffmpegStatus?.ffmpegPath && (
              <div style={{ fontSize: '11px', color: 'var(--text-dim)', wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>
                Binary: {ffmpegStatus.ffmpegPath}
              </div>
            )}

            {/* Auto-Downloader Section */}
            <div style={{ marginTop: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Automated Static FFmpeg Setup
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                Automatically downloads and extracts the official 64-bit static build of FFmpeg and FFprobe directly into the application's local sandbox folder.
              </p>

              {isDownloading ? (
                <div>
                  <div className="progress-track">
                    <div
                      className="progress-fill animated"
                      style={{ width: `${downloadProgress?.percent || 0}%` }}
                    />
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--gold-primary)', marginTop: '4px' }}>
                    {downloadProgress?.message || 'Downloading static build...'}
                  </div>
                </div>
              ) : (
                <button
                  className="btn-gold"
                  onClick={onDownloadFfmpeg}
                  disabled={isDownloading}
                  style={{ width: '100%' }}
                >
                  <Download size={15} />
                  <span>{ffmpegStatus?.available ? 'Reinstall Official Static FFmpeg' : 'Download FFmpeg Now'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Output Directory & General Settings */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <HardDrive size={18} />
              <span>Export Destination & Storage</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group">
              <label className="form-label">Default export folder for converted clips and audio</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="form-input"
                  value={outputDir || defaultOutputDir || ''}
                  readOnly
                  style={{ flex: 1 }}
                />
                <button className="btn-secondary" onClick={handlePickOutputDir}>
                  <Folder size={15} />
                  <span>Browse</span>
                </button>
              </div>
            </div>

            <button className="btn-secondary" onClick={handleOpenFolder} style={{ alignSelf: 'flex-start' }}>
              <Folder size={15} />
              <span>Open Export Folder in Windows Explorer</span>
            </button>

            {/* UI Effects & Performance Settings */}
            <div
              style={{
                padding: '14px',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={16} color="var(--gold-primary)" />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>Page Transition Animations</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      Subtle fade & slide transitions when switching tabs
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className={animationsEnabled ? 'btn-gold' : 'btn-secondary'}
                  style={{ padding: '6px 14px', fontSize: '12px', minWidth: '85px' }}
                  onClick={() => {
                    const nextVal = !animationsEnabled;
                    if (onToggleAnimations) onToggleAnimations(nextVal);
                    if (onShowToast) onShowToast(nextVal ? 'Animations enabled' : 'Animations disabled', 'info');
                  }}
                >
                  {animationsEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Zap size={13} color="#e6b422" style={{ flexShrink: 0 }} />
                <span><strong>RAM Optimization:</strong> Heap memory is capped at 512MB and preview playback pauses automatically in background.</span>
              </div>
            </div>

            {/* Diagnostics & Desktop Debug Logging */}
            <div
              style={{
                padding: '14px',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Bug size={16} color={debugMode ? '#e6b422' : 'var(--text-muted)'} />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>Diagnostic Debug Mode</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      Logs player scrubbing, decoding & FFmpeg events to Desktop
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className={debugMode ? 'btn-gold' : 'btn-secondary'}
                  style={{ padding: '6px 14px', fontSize: '12px', minWidth: '85px' }}
                  onClick={handleToggleDebug}
                >
                  {debugMode ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Folder size={12} style={{ flexShrink: 0 }} />
                  <span>{debugLogPath || 'itzCut-debug.log on Desktop'}</span>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '11px' }}
                  onClick={handleOpenDebugLog}
                  title="Open log file"
                >
                  <FileText size={12} style={{ display: 'inline', marginRight: '4px' }} />
                  Open Log
                </button>
              </div>
            </div>

            {/* Software Updates & Auto-Updater Card */}
            <div
              style={{
                padding: '14px',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RefreshCw size={16} color="var(--gold-primary)" className={updateState?.status === 'checking' ? 'spin' : ''} />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>Software Updates</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      Current: <strong>v{updateState?.currentVersion || '2.2.0'}</strong> • Auto-checks GitHub on startup
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '6px 14px', fontSize: '12px' }}
                  onClick={onCheckForUpdates}
                  disabled={updateState?.status === 'checking' || updateState?.status === 'downloading'}
                >
                  <RefreshCw size={12} className={updateState?.status === 'checking' ? 'spin' : ''} style={{ display: 'inline', marginRight: '4px' }} />
                  {updateState?.status === 'checking' ? 'Checking...' : 'Check for Updates'}
                </button>
              </div>

              {updateState?.status === 'downloading' && (
                <div>
                  <div className="progress-track">
                    <div
                      className="progress-fill animated"
                      style={{ width: `${updateState.downloadPercent || 0}%` }}
                    />
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--gold-primary)', marginTop: '4px' }}>
                    Downloading latest update package: {updateState.downloadPercent || 0}%...
                  </div>
                </div>
              )}

              {updateState?.status === 'ready' && (
                <button
                  type="button"
                  className="btn-gold"
                  onClick={onInstallUpdate}
                  style={{ width: '100%', padding: '9px 16px' }}
                >
                  <Zap size={14} />
                  <span>Restart & Install Update (v{updateState.latestVersion})</span>
                </button>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--text-dim)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
                <span>Repository: itzCrih/itzCut-Windows</span>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                  onClick={() => window.itzCutAPI && window.itzCutAPI.openExternal('https://github.com/itzCrih/itzCut-Windows/releases')}
                >
                  GitHub Releases
                </button>
              </div>
            </div>

            {/* Application Branding Info */}
            <div
              style={{
                marginTop: 'auto',
                paddingTop: '20px',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Info size={16} color="#e6b422" />
                <span style={{ fontSize: '13.5px', fontWeight: 700 }}>itzCut Windows Desktop Edition</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                Built as the native Windows companion to the web application <strong>cut.itzcrih.it</strong>.
                100% of rendering, trimming, compression, and audio filters are processed locally on your machine with complete privacy and zero upload bottlenecks.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
