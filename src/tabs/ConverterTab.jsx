import React, { useState } from 'react';
import {
  RefreshCw,
  Video,
  Music,
  Check,
  Folder,
  Zap,
  Sliders,
  Sparkles,
  ShieldCheck,
  VolumeX,
  Volume2,
} from 'lucide-react';
import DropZone from '../components/DropZone';
import {
  COMPRESSOR_PRESETS,
  CONVERTER_VIDEO_FORMATS,
  CONVERTER_AUDIO_FORMATS,
} from '../utils/presets';
import { formatBytes } from '../utils/formatters';

export default function ConverterTab({
  currentFile,
  mediaInfo,
  onFileSelected,
  onFileCleared,
  defaultOutputDir,
  onAddJob,
  onShowToast,
}) {
  // Top Workflow mode: 'crf' (Quality tuning), 'convert' (Format change), or 'target_size' (Target file size limit)
  const [activeWorkflow, setActiveWorkflow] = useState('crf');

  // Format selection
  const [mediaType, setMediaType] = useState('video'); // 'video' | 'audio'
  const [selectedFormat, setSelectedFormat] = useState('mp4');

  // Target size / Discord options
  const [selectedPresetId, setSelectedPresetId] = useState('crf-balanced');
  const [customTargetMB, setCustomTargetMB] = useState(25);

  // Quality & encoding options
  const [crf, setCrf] = useState(23);
  const [speedPreset, setSpeedPreset] = useState('medium');
  const [resolution, setResolution] = useState('original');
  const [fps, setFps] = useState('original');
  const [audioBitrate, setAudioBitrate] = useState('192k');
  const [muteAudio, setMuteAudio] = useState(false);
  const [audioBoostDb, setAudioBoostDb] = useState(0);
  const [stripMetadata, setStripMetadata] = useState(false);
  const [outputDir, setOutputDir] = useState(defaultOutputDir || '');

  const formats = mediaType === 'video' ? CONVERTER_VIDEO_FORMATS : CONVERTER_AUDIO_FORMATS;

  const handlePickOutputDir = async () => {
    if (!window.itzCutAPI) return;
    const folder = await window.itzCutAPI.selectFolderDialog();
    if (folder) setOutputDir(folder);
  };

  // Preset Selection
  const handlePresetSelect = (preset) => {
    setSelectedPresetId(preset.id);
    if (preset.type === 'target_size') {
      setActiveWorkflow('target_size');
      setCustomTargetMB(preset.targetSizeMB);
    } else if (preset.type === 'tiktok') {
      setActiveWorkflow('target_size');
    } else {
      setActiveWorkflow('crf');
      setCrf(preset.crf);
      if (preset.preset) setSpeedPreset(preset.preset);
    }
  };

  // Calculations for estimation
  const duration = mediaInfo?.duration || 60;
  const originalSizeMB = currentFile ? currentFile.size / (1024 * 1024) : 100;
  const currentTargetMB =
    activeWorkflow === 'target_size'
      ? (selectedPresetId === 'tiktok' ? Math.round((duration * 20) / 8) : customTargetMB)
      : (originalSizeMB * 0.45);
  const estimatedSaving = originalSizeMB > 0 ? Math.max(0, Math.round((1 - (currentTargetMB / originalSizeMB)) * 100)) : 50;

  const handleStartProcess = () => {
    if (!currentFile) {
      onShowToast('Please select a media file first!', 'error');
      return;
    }

    const baseName = currentFile.name.substring(0, currentFile.name.lastIndexOf('.')) || currentFile.name;
    const targetDir = outputDir || defaultOutputDir;
    const isAudioOnly = mediaType === 'audio';

    let outExt = 'mp4';
    let jobMode = 'convert';
    let jobOptions = {};
    let jobTitle = 'Processing';

    if (activeWorkflow === 'target_size' && selectedPresetId === 'tiktok') {
      outExt = 'mp4';
      jobMode = 'compress';
      jobTitle = 'TikTok 2-Pass CFR (20 Mbps VBR)';
      jobOptions = {
        type: 'tiktok',
        preset: speedPreset,
        muteAudio,
        audioBoostDb: parseInt(audioBoostDb, 10) || 0,
        stripMetadata,
      };
    } else if (activeWorkflow === 'target_size') {
      outExt = 'mp4';
      jobMode = 'compress';
      jobTitle = `Target Size Compression (${customTargetMB} MB)`;
      jobOptions = {
        type: 'target_size',
        targetSizeMB: customTargetMB,
        preset: speedPreset,
        muteAudio,
        audioBoostDb: parseInt(audioBoostDb, 10) || 0,
        stripMetadata,
      };
    } else if (activeWorkflow === 'crf') {
      outExt = 'mp4';
      jobMode = 'compress';
      jobTitle = `CRF ${crf} Optimization`;
      jobOptions = {
        type: 'crf',
        crf: parseInt(crf, 10),
        preset: speedPreset,
        muteAudio,
        audioBoostDb: parseInt(audioBoostDb, 10) || 0,
        stripMetadata,
      };
    } else {
      // Format convert workflow
      const fmtConfig = formats.find((f) => f.ext === selectedFormat) || formats[0];
      outExt = isAudioOnly ? fmtConfig.ext : (selectedFormat === 'mp4-hevc' ? 'mp4' : selectedFormat);
      jobMode = 'convert';
      jobTitle = `Convert to ${fmtConfig.label}`;
      jobOptions = {
        format: selectedFormat,
        videoCodec: isAudioOnly ? 'none' : (fmtConfig.defaultCodec || 'libx264'),
        audioCodec: muteAudio ? 'none' : (isAudioOnly ? fmtConfig.audioCodec : 'aac'),
        resolution,
        fps,
        crf: parseInt(crf, 10),
        audioBitrate,
        audioOnly: isAudioOnly,
        muteAudio,
        audioBoostDb: parseInt(audioBoostDb, 10) || 0,
        stripMetadata,
      };
    }

    const outputFile = `${targetDir}\\${baseName}_itzCut_${Date.now()}.${outExt}`;

    const jobConfig = {
      jobId: `job_${Date.now()}`,
      inputFile: currentFile.path,
      outputFile,
      mode: jobMode,
      duration: mediaInfo?.duration || 0,
      options: jobOptions,
      title: jobTitle,
      inputName: currentFile.name,
    };

    onAddJob(jobConfig);
    onShowToast(`Task queued: ${jobTitle}`, 'success');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <DropZone
        currentFile={currentFile}
        mediaInfo={mediaInfo}
        onFileSelected={onFileSelected}
        onFileCleared={onFileCleared}
      />

      {currentFile && (
        <div className="grid-2">
          {/* Left Column: Unified Modes & Presets */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <RefreshCw size={18} />
                <span>Conversion & Compression Mode</span>
              </div>
            </div>

            {/* Segmented Top Mode Switch */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
              <button
                className={`btn-secondary ${activeWorkflow === 'crf' ? 'active' : ''}`}
                onClick={() => setActiveWorkflow('crf')}
                style={{ flex: 1, padding: '8px 10px', fontSize: '12px' }}
              >
                <Sliders size={14} />
                <span>CRF Quality</span>
              </button>
              <button
                className={`btn-secondary ${activeWorkflow === 'convert' ? 'active' : ''}`}
                onClick={() => setActiveWorkflow('convert')}
                style={{ flex: 1, padding: '8px 10px', fontSize: '12px' }}
              >
                <Video size={14} />
                <span>Format Converter</span>
              </button>
              <button
                className={`btn-secondary ${activeWorkflow === 'target_size' ? 'active' : ''}`}
                onClick={() => setActiveWorkflow('target_size')}
                style={{ flex: 1, padding: '8px 10px', fontSize: '12px' }}
              >
                <Zap size={14} />
                <span>Target Size</span>
              </button>
            </div>

            {/* Sub-view: CRF Quality Tuning */}
            {activeWorkflow === 'crf' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                  {COMPRESSOR_PRESETS.filter((p) => p.type === 'crf').map((p) => (
                    <div
                      key={p.id}
                      className={`preset-card ${selectedPresetId === p.id ? 'active' : ''}`}
                      onClick={() => handlePresetSelect(p)}
                    >
                      <div className="preset-header">
                        <span className="preset-title">{p.title}</span>
                        <span className="preset-badge">{p.tag}</span>
                      </div>
                      <span className="preset-desc">{p.desc}</span>
                    </div>
                  ))}
                </div>

                <div className="form-group">
                  <label className="form-label">
                    <span>Constant Rate Factor (CRF): {crf}</span>
                    <span className="form-label-tag">
                      {crf <= 18 ? 'Lossless Master' : crf <= 23 ? 'Visually Sharp' : 'High Compression'}
                    </span>
                  </label>
                  <input
                    type="range"
                    className="range-slider"
                    min="14"
                    max="35"
                    value={crf}
                    onChange={(e) => {
                      setCrf(parseInt(e.target.value, 10));
                      setSelectedPresetId('');
                    }}
                  />
                </div>
              </div>
            )}

            {/* Sub-view: Format Converter */}
            {activeWorkflow === 'convert' && (
              <div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <button
                    className={`btn-secondary ${mediaType === 'video' ? 'active' : ''}`}
                    onClick={() => {
                      setMediaType('video');
                      setSelectedFormat('mp4');
                    }}
                    style={{ flex: 1 }}
                  >
                    <Video size={13} />
                    <span>Video / GIF</span>
                  </button>
                  <button
                    className={`btn-secondary ${mediaType === 'audio' ? 'active' : ''}`}
                    onClick={() => {
                      setMediaType('audio');
                      setSelectedFormat('mp3');
                    }}
                    style={{ flex: 1 }}
                  >
                    <Music size={13} />
                    <span>Extract Audio Only</span>
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {formats.map((fmt) => (
                    <div
                      key={fmt.ext}
                      className={`preset-card ${selectedFormat === fmt.ext ? 'active' : ''}`}
                      onClick={() => setSelectedFormat(fmt.ext)}
                    >
                      <div className="preset-header">
                        <span className="preset-title">{fmt.label}</span>
                        {selectedFormat === fmt.ext && <Check size={14} color="#e6b422" />}
                      </div>
                      <span className="preset-desc">{fmt.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sub-view: Target Size */}
            {activeWorkflow === 'target_size' && (
              <div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                  Choose a target size or platform preset, or adjust custom target file size in MB:
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginBottom: '16px' }}>
                  {COMPRESSOR_PRESETS.filter((p) => p.type === 'target_size' || p.type === 'tiktok').map((p) => (
                    <div
                      key={p.id}
                      className={`preset-card ${selectedPresetId === p.id ? 'active' : ''}`}
                      onClick={() => handlePresetSelect(p)}
                    >
                      <div className="preset-header">
                        <span className="preset-title">{p.title}</span>
                        <span className="preset-badge">{p.tag}</span>
                      </div>
                      <span className="preset-desc">{p.desc}</span>
                    </div>
                  ))}
                </div>

                {selectedPresetId === 'tiktok' ? (
                  <div
                    style={{
                      padding: '12px 14px',
                      background: 'rgba(230, 180, 34, 0.08)',
                      border: '1px solid var(--border-gold)',
                      borderRadius: 'var(--radius-md)',
                      marginBottom: '10px',
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--gold-primary)', marginBottom: '4px' }}>
                      TikTok Profile Active (2-Pass VBR)
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      2-Pass VBR (20 Mbps target, 40 Mbps peak), strict Constant Frame Rate (CFR), Main profile, 4 reference frames, and native source resolution in MP4 container.
                    </div>
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">
                      <span>Custom Max Size Limit:</span>
                      <span className="form-label-tag">{customTargetMB} MB</span>
                    </label>
                    <input
                      type="range"
                      className="range-slider"
                      min="2"
                      max="100"
                      step="1"
                      value={customTargetMB}
                      onChange={(e) => {
                        setCustomTargetMB(parseInt(e.target.value, 10));
                        setSelectedPresetId('');
                      }}
                    />
                  </div>
                )}

                {/* Estimation Card */}
                <div
                  style={{
                    padding: '12px 14px',
                    background: 'rgba(230, 180, 34, 0.08)',
                    border: '1px solid var(--border-gold)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Estimated Reduction</div>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--gold-primary)' }}>
                      Approx -{estimatedSaving}% file size
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                    <span style={{ color: 'var(--text-dim)', textDecoration: 'line-through' }}>
                      {formatBytes(currentFile.size)}
                    </span>
                    <span style={{ color: 'var(--color-success)', fontWeight: 700, marginLeft: '8px' }}>
                      ~ {formatBytes(customTargetMB * 1024 * 1024)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Encoding Parameters & Actions */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <span>Encoding Options & Destination</span>
              </div>
            </div>

            {/* Resolution & FPS */}
            {mediaType === 'video' && activeWorkflow !== 'target_size' && selectedPresetId !== 'tiktok' && (
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Resolution</label>
                  <select
                    className="form-select"
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                  >
                    <option value="original">Original ({mediaInfo?.video?.width || 'Auto'}p)</option>
                    <option value="4k">4K Ultra HD (3840×2160)</option>
                    <option value="1440p">2K QHD (2560×1440)</option>
                    <option value="1080p">Full HD (1920×1080)</option>
                    <option value="720p">HD (1280×720)</option>
                    <option value="480p">SD (854×480)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Framerate (FPS)</label>
                  <select
                    className="form-select"
                    value={fps}
                    onChange={(e) => setFps(e.target.value)}
                  >
                    <option value="original">Original ({mediaInfo?.video?.fps || 'Auto'} fps)</option>
                    <option value="60">60 FPS (Smooth)</option>
                    <option value="30">30 FPS (Standard)</option>
                    <option value="24">24 FPS (Cinematic)</option>
                  </select>
                </div>
              </div>
            )}

            {/* Encoder Speed */}
            <div className="form-group">
              <label className="form-label">Encoding Speed Preset</label>
              <select
                className="form-select"
                value={speedPreset}
                onChange={(e) => setSpeedPreset(e.target.value)}
              >
                <option value="ultrafast">Ultrafast (Instant, slightly larger file)</option>
                <option value="veryfast">Veryfast (Very fast)</option>
                <option value="fast">Fast (Recommended for gaming clips)</option>
                <option value="medium">Medium (Optimal balance)</option>
                <option value="slow">Slow (Maximum compression efficiency)</option>
              </select>
            </div>

            {/* Audio Settings */}
            {!muteAudio && mediaType === 'video' && (
              <div className="form-group">
                <label className="form-label">Audio Bitrate (AAC)</label>
                <select
                  className="form-select"
                  value={audioBitrate}
                  onChange={(e) => setAudioBitrate(e.target.value)}
                >
                  <option value="320k">320 kbps (Maximum Studio Fidelity)</option>
                  <option value="256k">256 kbps (Very High)</option>
                  <option value="192k">192 kbps (Standard High Quality)</option>
                  <option value="128k">128 kbps (Compact Web)</option>
                </select>
              </div>
            )}

            {/* Audio Gain Boost */}
            {!muteAudio && (
              <div className="form-group">
                <label className="form-label">
                  <span>Audio Gain Boost: {audioBoostDb > 0 ? `+${audioBoostDb} dB` : 'Off'}</span>
                  <Volume2 size={14} color="#e6b422" />
                </label>
                <input
                  type="range"
                  className="range-slider"
                  min="0"
                  max="20"
                  value={audioBoostDb}
                  onChange={(e) => setAudioBoostDb(parseInt(e.target.value, 10))}
                />
              </div>
            )}

            {/* Toggles */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: '14px 0' }}>
              {mediaType === 'video' && (
                <label className="toggle-wrapper">
                  <div
                    className={`toggle-switch ${muteAudio ? 'on' : ''}`}
                    onClick={() => setMuteAudio(!muteAudio)}
                  >
                    <div className="toggle-knob" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>Mute Audio</span>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      Strips audio track to save valuable bit budget for video sharpness.
                    </span>
                  </div>
                </label>
              )}

              <label className="toggle-wrapper">
                <div
                  className={`toggle-switch ${stripMetadata ? 'on' : ''}`}
                  onClick={() => setStripMetadata(!stripMetadata)}
                >
                  <div className="toggle-knob" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>Strip EXIF / Metadata</span>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    Clears device models, GPS coordinates, and creation tags for privacy.
                  </span>
                </div>
              </label>
            </div>

            {/* Output Directory Picker */}
            <div className="form-group">
              <label className="form-label">Output Directory</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="form-input"
                  value={outputDir || defaultOutputDir || ''}
                  readOnly
                  style={{ flex: 1 }}
                />
                <button className="btn-secondary" onClick={handlePickOutputDir} title="Browse folder">
                  <Folder size={15} />
                  <span>Browse</span>
                </button>
              </div>
            </div>

            {/* Execute Button */}
            <div style={{ marginTop: '18px' }}>
              <button
                className="btn-gold"
                style={{ width: '100%', padding: '12px' }}
                onClick={handleStartProcess}
              >
                <Sparkles size={16} />
                <span>Start Local Processing</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
