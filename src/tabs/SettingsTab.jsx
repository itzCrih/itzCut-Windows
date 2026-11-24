import React, { useEffect, useState } from 'react';
import {
  Cpu,
  Download,
  Folder,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Info,
  Bug,
  FileText,
  Zap,
  Check,
  X,
  SlidersHorizontal,
  Palette,
  Bell,
  HardDrive,
  FolderOpen,
  ChevronDown,
} from 'lucide-react';
import { Segmented, Collapse } from '../components/ui';
import { ACCENTS, cleanSuffix } from '../utils/settings';

function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle-switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="toggle-knob" />
    </button>
  );
}

function SettingRow({ label, description, children }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {description && <span className="setting-desc">{description}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function SettingGroup({ icon: Icon, title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="setting-group">
      <div className="setting-group-title">
        <Icon size={13} />
        <span>{title}</span>
        <button
          type="button"
          className={`group-toggle ${open ? 'open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
          title={open ? 'Collapse' : 'Expand'}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      <Collapse open={open}>
        <div className="setting-group-body">{children}</div>
      </Collapse>
    </div>
  );
}

function AccelPill({ label, available, title }) {
  return (
    <span className={`accel-pill ${available ? 'on' : ''}`} title={title}>
      <span>{label}</span>
      {available ? <Check size={12} /> : <X size={12} />}
    </span>
  );
}

export default function SettingsTab({
  ffmpegStatus,
  settings,
  onUpdateSettings,
  appOutputDir,
  onRefreshFfmpeg,
  onDownloadFfmpeg,
  downloadProgress,
  isDownloading,
  updateState,
  onCheckForUpdates,
  onInstallUpdate,
  onShowToast,
}) {
  const [debugMode, setDebugMode] = useState(false);
  const [debugLogPath, setDebugLogPath] = useState('');
  const [suffixDraft, setSuffixDraft] = useState(settings.fileSuffix);
  const accels = ffmpegStatus?.hardwareAccels || {};
  const hasGpuEncoder = !!(accels.nvenc || accels.qsv || accels.amf);
  const outputDir = settings.outputDir || appOutputDir;

  useEffect(() => {
    window.itzCutAPI?.getDebugMode?.().then((res) => {
      if (res) {
        setDebugMode(!!res.isDebugMode);
        setDebugLogPath(res.logPath || '');
      }
    });
  }, []);

  const handleToggleDebug = async () => {
    if (!window.itzCutAPI?.setDebugMode) return;
    const next = !debugMode;
    const res = await window.itzCutAPI.setDebugMode(next);
    setDebugMode(res?.isDebugMode ?? next);
    if (res?.logPath) setDebugLogPath(res.logPath);
    onShowToast(next ? 'Debug mode enabled: logs are written to itzCut-debug.log on your Desktop.' : 'Debug mode disabled.', 'info');
  };

  const handleOpenDebugLog = async () => {
    if (!window.itzCutAPI?.openDebugLogFile) return;
    const opened = await window.itzCutAPI.openDebugLogFile();
    if (!opened) onShowToast('No itzCut-debug.log exists on your Desktop yet. Enable debug mode first!', 'info');
  };

  const handlePickOutputDir = async () => {
    if (!window.itzCutAPI) return;
    const folder = await window.itzCutAPI.selectFolderDialog();
    if (folder) {
      onUpdateSettings({ outputDir: folder });
      onShowToast(`Default destination: ${folder}`, 'success');
    }
  };

  const commitSuffix = () => {
    const clean = cleanSuffix(suffixDraft);
    setSuffixDraft(clean);
    if (clean !== settings.fileSuffix) onUpdateSettings({ fileSuffix: clean });
  };

  return (
    <div className="settings-layout">
      {/* Engine */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Cpu size={18} />
            <span>FFmpeg Engine</span>
          </div>
          <button className="btn-secondary btn-compact" onClick={onRefreshFfmpeg} title="Re-check FFmpeg and the GPU encoders">
            <RefreshCw size={13} />
            <span>Re-check</span>
          </button>
        </div>

        <div className="options-stack">
          <div className="engine-status">
            <div>
              <div className="setting-label">FFmpeg</div>
              <div className="setting-desc">
                {ffmpegStatus?.available
                  ? `Version ${ffmpegStatus.version || 'unknown'} · ${ffmpegStatus.source === 'system' ? 'System PATH' : 'Local binary'}`
                  : 'FFmpeg binaries not found'}
              </div>
            </div>
            {ffmpegStatus?.available ? (
              <span className="status-pill completed">
                <CheckCircle size={12} /> Active
              </span>
            ) : (
              <span className="status-pill error">
                <AlertTriangle size={12} /> Missing
              </span>
            )}
          </div>

          <div>
            <div className="setting-group-title">
              <Zap size={13} />
              <span>Hardware Encoders</span>
            </div>
            <div className="accel-pills">
              <AccelPill label="NVIDIA NVENC" available={accels.nvenc} title="NVIDIA hardware encoder" />
              <AccelPill label="Intel QuickSync" available={accels.qsv} title="Intel hardware encoder" />
              <AccelPill label="AMD AMF" available={accels.amf} title="AMD hardware encoder" />
              <AccelPill label="CPU x264 / x265" available title="Software encoders, always available" />
            </div>
          </div>

          {ffmpegStatus?.systemInfo && (
            <div className="system-info">
              <div>
                <span className="dim">CPU</span> {ffmpegStatus.systemInfo.cpuModel || 'Detected CPU'} · {ffmpegStatus.systemInfo.cpuCores || 4} threads
              </div>
              <div>
                <span className="dim">RAM</span> {ffmpegStatus.systemInfo.ramGb || 8} GB
              </div>
              {ffmpegStatus.systemInfo.gpuDevices?.length > 0 && (
                <div>
                  <span className="dim">GPU</span> {ffmpegStatus.systemInfo.gpuDevices.join(' · ')}
                </div>
              )}
              {ffmpegStatus.ffmpegPath && (
                <div className="path-line" title={ffmpegStatus.ffmpegPath}>
                  <span className="dim">Binary</span> {ffmpegStatus.ffmpegPath}
                </div>
              )}
            </div>
          )}

          <div className="engine-download">
            {isDownloading ? (
              <>
                <div className="progress-track">
                  <div className="progress-fill animated" style={{ width: `${downloadProgress?.percent || 0}%` }} />
                </div>
                <div className="setting-desc accent">{downloadProgress?.message || 'Downloading FFmpeg…'}</div>
              </>
            ) : (
              <button className={ffmpegStatus?.available ? 'btn-secondary btn-block' : 'btn-gold btn-block'} onClick={onDownloadFfmpeg} disabled={isDownloading}>
                <Download size={15} />
                <span>{ffmpegStatus?.available ? 'Reinstall FFmpeg' : 'Download FFmpeg Now'}</span>
              </button>
            )}
            <div className="setting-desc">Downloads the official 64-bit FFmpeg build into the app's own folder.</div>
          </div>

          <div className="divider" />

          <SettingRow label="Diagnostic Debug Mode" description="Logs player and FFmpeg events to itzCut-debug.log on the Desktop.">
            <button type="button" className="btn-secondary btn-xs" onClick={handleOpenDebugLog} title={debugLogPath || 'itzCut-debug.log'}>
              <FileText size={12} />
              <span>Open Log</span>
            </button>
            <Switch checked={debugMode} onChange={handleToggleDebug} label="Debug mode" />
          </SettingRow>

          <SettingRow
            label="Software Updates"
            description={
              updateState?.status === 'downloading'
                ? `Downloading v${updateState.latestVersion}: ${updateState.downloadPercent || 0}%`
                : `Installed: v${updateState?.currentVersion || __APP_VERSION__}`
            }
          >
            {updateState?.status === 'ready' ? (
              <button type="button" className="btn-gold btn-xs" onClick={onInstallUpdate}>
                <Zap size={12} />
                <span>Restart & Install v{updateState.latestVersion}</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary btn-xs"
                onClick={onCheckForUpdates}
                disabled={updateState?.status === 'checking' || updateState?.status === 'downloading'}
              >
                <RefreshCw size={12} className={updateState?.status === 'checking' ? 'spin' : ''} />
                <span>{updateState?.status === 'checking' ? 'Checking…' : 'Check Now'}</span>
              </button>
            )}
          </SettingRow>

          <div className="about-line">
            <Info size={13} className="icon-accent" />
            <span>
              itzCut Desktop is the Windows companion to <strong>cut.itzcrih.it</strong>. Everything is processed locally on this PC.
            </span>
            <button
              type="button"
              className="link-btn"
              onClick={() => window.itzCutAPI?.openExternal('https://github.com/itzCrih/itzCut-Windows/releases')}
            >
              Releases
            </button>
          </div>
        </div>
      </div>

      {/* Preferences */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <SlidersHorizontal size={18} />
            <span>Preferences</span>
          </div>
        </div>

        <div className="settings-groups">
          <SettingGroup icon={HardDrive} title="Output">
            <div className="setting-row column">
              <div className="setting-text">
                <span className="setting-label">Default Folder</span>
              </div>
              <div className="path-field">
                <span className="path-value" title={outputDir}>
                  {outputDir || '…'}
                </span>
                <button type="button" className="btn-secondary btn-compact btn-icon-only" onClick={() => window.itzCutAPI?.showInFolder(outputDir)} title="Open in Explorer">
                  <FolderOpen size={14} />
                </button>
                <button type="button" className="btn-secondary btn-compact" onClick={handlePickOutputDir}>
                  <Folder size={14} />
                  <span>Change</span>
                </button>
              </div>
              {settings.outputDir && (
                <button type="button" className="link-btn self-start" onClick={() => onUpdateSettings({ outputDir: '' })}>
                  Reset to Videos\itzCut
                </button>
              )}
            </div>
            <SettingRow label="File Name Suffix" description={`clip${settings.fileSuffix}_20261124.mp4`}>
              <input
                type="text"
                className="form-input small-input"
                value={suffixDraft}
                maxLength={40}
                onChange={(e) => setSuffixDraft(e.target.value)}
                onBlur={commitSuffix}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                aria-label="File name suffix"
              />
            </SettingRow>
          </SettingGroup>

          <SettingGroup icon={Cpu} title="Performance">
            <SettingRow label="Simultaneous Jobs" description="Long encodes finish fastest one at a time.">
              <Segmented size="sm" stretch={false} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} value={settings.maxConcurrentJobs} onChange={(v) => onUpdateSettings({ maxConcurrentJobs: v })} ariaLabel="Simultaneous jobs" />
            </SettingRow>
            <SettingRow label="Video Encoder" description={hasGpuEncoder ? 'GPU is much faster; CPU gives the smallest files.' : 'No GPU encoder detected on this PC.'}>
              <Segmented
                size="sm"
                stretch={false}
                options={[
                  { value: 'auto', label: 'GPU', title: 'Use the GPU encoder when available', disabled: !hasGpuEncoder },
                  { value: 'cpu', label: 'CPU', title: 'Always use x264 / x265' },
                ]}
                value={hasGpuEncoder ? settings.encoder : 'cpu'}
                onChange={(v) => onUpdateSettings({ encoder: v })}
                ariaLabel="Video encoder"
              />
            </SettingRow>
            <SettingRow label="CPU Priority" description="Lower keeps the PC responsive during encodes.">
              <Segmented
                size="sm"
                stretch={false}
                options={[
                  { value: 'normal', label: 'Normal' },
                  { value: 'below', label: 'Lower' },
                  { value: 'low', label: 'Idle' },
                ]}
                value={settings.priority}
                onChange={(v) => onUpdateSettings({ priority: v })}
                ariaLabel="CPU priority"
              />
            </SettingRow>
            <SettingRow label="GPU Decoding" description="Decodes sources on the GPU; falls back to CPU automatically.">
              <Switch checked={settings.hwDecode} onChange={(v) => onUpdateSettings({ hwDecode: v })} label="GPU decoding" />
            </SettingRow>
            <SettingRow label="Keep PC Awake" description="Prevents sleep while the queue is running.">
              <Switch checked={settings.keepAwake} onChange={(v) => onUpdateSettings({ keepAwake: v })} label="Keep PC awake" />
            </SettingRow>
          </SettingGroup>

          <SettingGroup icon={Bell} title="When Jobs Finish">
            <SettingRow label="Desktop Notification" description="When the queue finishes and itzCut is in the background.">
              <Switch checked={settings.notifyOnFinish} onChange={(v) => onUpdateSettings({ notifyOnFinish: v })} label="Desktop notification" />
            </SettingRow>
            <SettingRow label="Completion Sound">
              <Switch checked={settings.completionSound} onChange={(v) => onUpdateSettings({ completionSound: v })} label="Completion sound" />
            </SettingRow>
            <SettingRow label="Open Output Folder">
              <Switch checked={settings.openFolderWhenDone} onChange={(v) => onUpdateSettings({ openFolderWhenDone: v })} label="Open output folder" />
            </SettingRow>
            <SettingRow label="Show Queue on Start" description="Switch to the Queue tab when a job is added.">
              <Switch checked={settings.autoSwitchToQueue} onChange={(v) => onUpdateSettings({ autoSwitchToQueue: v })} label="Show queue on start" />
            </SettingRow>
          </SettingGroup>

          <SettingGroup icon={Palette} title="Appearance">
            <SettingRow label="Accent Color">
              <div className="accent-swatches" role="radiogroup" aria-label="Accent color">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.id}
                    type="button"
                    role="radio"
                    aria-checked={settings.accent === accent.id}
                    className={`accent-swatch ${settings.accent === accent.id ? 'active' : ''}`}
                    style={{ '--swatch': accent.color }}
                    onClick={() => onUpdateSettings({ accent: accent.id })}
                    title={accent.label}
                  />
                ))}
              </div>
            </SettingRow>
            <SettingRow label="Page Animations">
              <Switch checked={settings.animations} onChange={(v) => onUpdateSettings({ animations: v })} label="Page animations" />
            </SettingRow>
          </SettingGroup>
        </div>
      </div>
    </div>
  );
}
