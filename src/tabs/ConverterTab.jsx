import React, { useState, useEffect } from 'react';
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
import { isAudioMedia } from '../utils/fileTypes';

export default function ConverterTab({
  currentFile,
  mediaInfo,
  onFileSelected,
  onFileCleared,
  defaultOutputDir,
  onAddJob,
  onShowToast,
}) {
  const isFileAudio = isAudioMedia(currentFile, mediaInfo);

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
  const [customResolution, setCustomResolution] = useState('');
  const [canvasFit, setCanvasFit] = useState('pad');
  const [fps, setFps] = useState('original');
  const [audioBitrate, setAudioBitrate] = useState('192k');
  const [audioSampleRate, setAudioSampleRate] = useState('original');
  const [audioChannels, setAudioChannels] = useState('original');
  const [muteAudio, setMuteAudio] = useState(false);
  const [audioBoostDb, setAudioBoostDb] = useState(0);
  const [stripMetadata, setStripMetadata] = useState(false);
  const [outputDir, setOutputDir] = useState(defaultOutputDir || '');

  // Auto-switch to audio converter mode when input file is audio
  useEffect(() => {
    if (isFileAudio) {
      setMediaType('audio');
      setActiveWorkflow('convert');
      if (!CONVERTER_AUDIO_FORMATS.some((f) => f.ext === selectedFormat)) {
        setSelectedFormat('mp3');
      }
    } else if (currentFile) {
      setMediaType('video');
    }
  }, [currentFile, mediaInfo, isFileAudio]);

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
    const isAudioOnly = mediaType === 'audio' || isFileAudio;

    let outExt = 'mp4';
    let jobMode = 'convert';
    let jobOptions = {};
    let jobTitle = 'Processing';

    let cleanCustomRes = '';
    if (!isAudioOnly && resolution === 'custom') {
      const match = (customResolution || '').trim().match(/(\d{2,5})\s*[*xX:\-,\s]\s*(\d{2,5})/);
      if (!match) {
        onShowToast('Please enter a valid resolution in WIDTHxHEIGHT format (e.g. 1920x1080)', 'error');
        return;
      }
      cleanCustomRes = `${match[1]}x${match[2]}`;
    }

    if (isAudioOnly) {
      const fmtConfig = CONVERTER_AUDIO_FORMATS.find((f) => f.ext === selectedFormat) || CONVERTER_AUDIO_FORMATS[0];
      outExt = fmtConfig.ext;
      jobMode = 'convert';
      jobTitle = `Convert Audio to ${fmtConfig.label}`;
      const isUncompressedOrLossless = fmtConfig.defaultBitrate === 'uncompressed' || fmtConfig.defaultBitrate === 'lossless';
      jobOptions = {
        format: selectedFormat,
        videoCodec: 'none',
        audioCodec: fmtConfig.audioCodec,
        audioBitrate: isUncompressedOrLossless ? null : audioBitrate,
        sampleRate: audioSampleRate !== 'original' ? parseInt(audioSampleRate, 10) : null,
        channels: audioChannels !== 'original' ? parseInt(audioChannels, 10) : null,
        audioOnly: true,
        muteAudio: false,
        audioBoostDb: parseInt(audioBoostDb, 10) || 0,
        stripMetadata,
      };
    } else if (activeWorkflow === 'target_size' && selectedPresetId === 'tiktok') {
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
      const resLabel = resolution === 'custom' ? ` - ${cleanCustomRes}` : (resolution !== 'original' ? ` - ${resolution.toUpperCase()}` : '');
      jobTitle = `Target Size Compression (${customTargetMB} MB${resLabel})`;
      jobOptions = {
        type: 'target_size',
        targetSizeMB: customTargetMB,
        preset: speedPreset,
        resolution,
        customResolution: cleanCustomRes,
        canvasFit,
        fps,
        muteAudio,
        audioBoostDb: parseInt(audioBoostDb, 10) || 0,
        stripMetadata,
      };
    } else if (activeWorkflow === 'crf') {
      outExt = 'mp4';
      jobMode = 'compress';
      const resLabel = resolution === 'custom' ? ` (${cleanCustomRes})` : (resolution !== 'original' ? ` (${resolution.toUpperCase()})` : '');
      jobTitle = `CRF ${crf} Optimization${resLabel}`;
      jobOptions = {
        type: 'crf',
        crf: parseInt(crf, 10),
        preset: speedPreset,
        resolution,
        customResolution: cleanCustomRes,
        canvasFit,
        fps,
        muteAudio,
        audioBoostDb: parseInt(audioBoostDb, 10) || 0,
        stripMetadata,
      };
    } else {
      // Format convert workflow
      const fmtConfig = formats.find((f) => f.ext === selectedFormat) || formats[0];
      outExt = selectedFormat === 'mp4-hevc' ? 'mp4' : selectedFormat;
      jobMode = 'convert';
      const resLabel = resolution === 'custom' ? ` (${cleanCustomRes})` : (resolution !== 'original' ? ` (${resolution.toUpperCase()})` : '');
      jobTitle = `Convert to ${fmtConfig.label}${resLabel}`;
      jobOptions = {
        format: selectedFormat,
        videoCodec: fmtConfig.defaultCodec || 'libx264',
        audioCodec: muteAudio ? 'none' : 'aac',
        resolution,
        customResolution: cleanCustomRes,
        canvasFit,
        fps,
        crf: parseInt(crf, 10),
        audioBitrate,
        audioOnly: false,
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
        onShowToast={onShowToast}
      />

      {currentFile && (
        <div className="grid-2">
          {/* Left Column: Modes & Presets */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                {isFileAudio ? <Music size={18} /> : <RefreshCw size={18} />}
                <span>{isFileAudio ? 'Real Audio Formats' : 'Conversion & Compression Mode'}</span>
              </div>
            </div>

            {isFileAudio ? (
              <div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                  Choose a real audio format to transcode your input audio file:
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {CONVERTER_AUDIO_FORMATS.map((fmt) => (
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
            ) : (
              <>
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
              </>
            )}
          </div>

          {/* Right Column: Encoding Parameters & Actions */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <Sliders size={18} />
                <span>{isFileAudio ? 'Audio Quality & Destination' : 'Encoding Options & Destination'}</span>
              </div>
            </div>

            {isFileAudio ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Audio Bitrate */}
                {selectedFormat !== 'wav' && selectedFormat !== 'flac' ? (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Audio Bitrate</label>
                    <select
                      className="form-select"
                      value={audioBitrate}
                      onChange={(e) => setAudioBitrate(e.target.value)}
                    >
                      <option value="320k">320 kbps (Maximum Studio Fidelity)</option>
                      <option value="256k">256 kbps (Very High Quality)</option>
                      <option value="192k">192 kbps (Standard CD/Web)</option>
                      <option value="128k">128 kbps (Compact Streaming)</option>
                      <option value="64k">64 kbps (Voice / Speech)</option>
                    </select>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '10px 14px',
                      background: 'rgba(230, 180, 34, 0.08)',
                      border: '1px solid var(--border-gold)',
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--gold-primary)' }}>
                      Bit-Perfect Uncompressed Master
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {selectedFormat === 'wav'
                        ? 'Studio uncompressed linear PCM with 100% acoustic fidelity.'
                        : 'Lossless FLAC encoding with bit-perfect audio preservation.'}
                    </div>
                  </div>
                )}

                {/* Sample Rate */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Sample Rate</label>
                  <select
                    className="form-select"
                    value={audioSampleRate}
                    onChange={(e) => setAudioSampleRate(e.target.value)}
                  >
                    <option value="original">Original ({mediaInfo?.audio?.sampleRate || 'Auto'} Hz)</option>
                    <option value="44100">44,100 Hz (CD Audio Standard)</option>
                    <option value="48000">48,000 Hz (Broadcast / Studio Standard)</option>
                    <option value="96000">96,000 Hz (Hi-Res Audio Master)</option>
                  </select>
                </div>

                {/* Audio Channels */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Audio Channels</label>
                  <select
                    className="form-select"
                    value={audioChannels}
                    onChange={(e) => setAudioChannels(e.target.value)}
                  >
                    <option value="original">Original ({mediaInfo?.audio?.channels === 1 ? 'Mono' : 'Stereo'})</option>
                    <option value="2">Stereo (2.0 Channels)</option>
                    <option value="1">Mono (1.0 Channel)</option>
                  </select>
                </div>

                {/* Audio Gain Boost */}
                <div className="form-group" style={{ marginBottom: 0 }}>
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

                {/* Strip Metadata */}
                <label className="toggle-wrapper">
                  <div
                    className={`toggle-switch ${stripMetadata ? 'on' : ''}`}
                    onClick={() => setStripMetadata(!stripMetadata)}
                  >
                    <div className="toggle-knob" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>Strip Metadata</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Removes personal tags and device metadata
                    </span>
                  </div>
                </label>

                {/* Output Directory Picker */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Destination Folder</label>
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
                <div style={{ marginTop: '6px' }}>
                  <button
                    className="btn-gold"
                    style={{ width: '100%', padding: '12px' }}
                    onClick={handleStartProcess}
                  >
                    <RefreshCw size={15} />
                    <span>Execute Audio Conversion</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Resolution & FPS */}
                {selectedPresetId !== 'tiktok' && (
                  <>
                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label">
                          <span>Resolution</span>
                          {resolution === 'custom' && (
                            <span className="form-label-tag">Custom</span>
                          )}
                        </label>
                        <select
                          className="form-select"
                          value={resolution}
                          onChange={(e) => setResolution(e.target.value)}
                        >
                          <option value="original">Original ({mediaInfo?.video?.width ? `${mediaInfo.video.width}×${mediaInfo.video.height || ''}` : 'Auto'})</option>
                          <option value="4k">4K Ultra HD (3840×2160)</option>
                          <option value="1440p">2K QHD (2560×1440)</option>
                          <option value="1080p">Full HD (1920×1080)</option>
                          <option value="720p">HD (1280×720)</option>
                          <option value="480p">SD (854×480)</option>
                          <option value="custom">Custom resolution...</option>
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

                    {/* Custom Resolution Text Input */}
                    {resolution === 'custom' && (
                      <div className="form-group" style={{ marginTop: '-4px' }}>
                        <label className="form-label">
                          <span>Custom Resolution</span>
                          <span className="form-label-tag">Width × Height</span>
                        </label>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="e.g. 1920x1080 or 1080x1920"
                            value={customResolution}
                            onChange={(e) => setCustomResolution(e.target.value)}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ whiteSpace: 'nowrap', padding: '7px 11px', fontSize: '11.5px' }}
                            onClick={() => setCustomResolution('1920x1080')}
                            title="16:9 Landscape Full HD"
                          >
                            1920×1080
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ whiteSpace: 'nowrap', padding: '7px 11px', fontSize: '11.5px' }}
                            onClick={() => setCustomResolution('1080x1920')}
                            title="9:16 Vertical (TikTok / Reels / Shorts)"
                          >
                            1080×1920
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ whiteSpace: 'nowrap', padding: '7px 11px', fontSize: '11.5px' }}
                            onClick={() => setCustomResolution('1080x1080')}
                            title="1:1 Square"
                          >
                            1080×1080
                          </button>
                        </div>
                        <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                          Enter custom resolution as <strong>Width×Height</strong> (e.g. 1920x1080, 1080x1920, 2560x1080).
                        </span>
                      </div>
                    )}

                    {/* Scaling Fit Mode when Resolution is modified */}
                    {resolution !== 'original' && (
                      <div className="form-group" style={{ marginTop: '-4px' }}>
                        <label className="form-label">
                          <span>Scaling Fit Mode</span>
                          <span className="form-label-tag">Aspect ratio handling</span>
                        </label>
                        <select
                          className="form-select"
                          value={canvasFit}
                          onChange={(e) => setCanvasFit(e.target.value)}
                        >
                          <option value="pad">Fit with Black Bars (Preserve Aspect Ratio)</option>
                          <option value="crop">Fill & Center Crop</option>
                          <option value="stretch">Stretch to Fit</option>
                        </select>
                      </div>
                    )}
                  </>
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
                {!muteAudio && (
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
