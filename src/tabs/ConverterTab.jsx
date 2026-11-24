import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Video, Music, Check, Folder, Zap, Gauge, Film, Sparkles, Camera, ShieldCheck, Layers } from 'lucide-react';
import MediaTray from '../components/MediaTray';
import Select from '../components/Select';
import AudioGainControl from '../components/AudioGainControl';
import SpeedPresetSlider from '../components/SpeedPresetSlider';
import { Segmented, Collapse, Toggle } from '../components/ui';
import {
  COMPRESSOR_PRESETS,
  CONVERTER_VIDEO_FORMATS,
  CONVERTER_AUDIO_FORMATS,
  RESOLUTION_OPTIONS,
  FPS_OPTIONS,
  AUDIO_BITRATES,
} from '../utils/presets';
import { formatBytes, formatTimecode } from '../utils/formatters';
import { isAudioMedia } from '../utils/fileTypes';
import { buildOutputPath } from '../utils/settings';

const WORKFLOW_TABS = [
  { value: 'crf', label: 'CRF Quality', icon: Gauge },
  { value: 'convert', label: 'Format Converter', icon: Film },
  { value: 'target_size', label: 'Target Size', icon: Zap },
];

const TRACK_MODES = [
  { value: 'keep', label: 'Keep all', title: 'Every audio track is kept as its own track' },
  { value: 'merge', label: 'Merge', title: 'All tracks are mixed into a single track' },
  { value: 'first', label: 'First only', title: 'Only the first audio track is kept' },
];

const FIT_MODES = [
  { value: 'pad', label: 'Fit', title: 'Black bars, nothing cropped' },
  { value: 'crop', label: 'Fill', title: 'Center crop, no bars' },
  { value: 'stretch', label: 'Stretch', title: 'Distort to fill the frame' },
];

const SAMPLE_RATES = [
  { value: '44100', label: '44.1 kHz', hint: 'CD' },
  { value: '48000', label: '48 kHz', hint: 'Video / broadcast' },
  { value: '96000', label: '96 kHz', hint: 'Hi-res' },
];

function crfQuality(crf) {
  if (crf <= 18) return 'Visually Lossless';
  if (crf <= 23) return 'Visually Sharp';
  if (crf <= 28) return 'Balanced';
  return 'High Compression';
}

function PresetCard({ active, title, tag, desc, onClick }) {
  return (
    <button type="button" className={`preset-card ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="preset-header">
        <span className="preset-title">{title}</span>
        {tag ? <span className="preset-badge">{tag}</span> : active && <Check size={14} className="icon-accent" />}
      </span>
      <span className="preset-desc">{desc}</span>
    </button>
  );
}

function DestinationField({ dir, onPick, onReset, isCustom }) {
  return (
    <div className="form-group">
      <label className="form-label">
        <span>Destination Folder</span>
        {isCustom && (
          <button type="button" className="link-btn" onClick={onReset} title="Use the default folder from Settings">
            Reset
          </button>
        )}
      </label>
      <div className="path-field">
        <span className="path-value" title={dir}>
          {dir || '…'}
        </span>
        <button type="button" className="btn-secondary btn-compact" onClick={onPick}>
          <Folder size={14} />
          <span>Browse</span>
        </button>
      </div>
    </div>
  );
}

export default function ConverterTab({
  files,
  activeFile,
  mediaInfo,
  onAddFiles,
  onRemoveFile,
  onClearFiles,
  onSelectFile,
  outputDir,
  settings,
  ffmpegStatus,
  onAddJobs,
  onShowToast,
}) {
  const isFileAudio = isAudioMedia(activeFile, mediaInfo);
  // A batch applies to every loaded file of the same kind as the one on screen.
  const targets = files.filter((f) => isAudioMedia(f, f.mediaInfo) === isFileAudio);
  const otherKind = files.length - targets.length;

  const [activeWorkflow, setActiveWorkflow] = useState('crf');
  const [mediaType, setMediaType] = useState('video'); // 'video' | 'audio'
  const [selectedFormat, setSelectedFormat] = useState('mp4');
  const [selectedPresetId, setSelectedPresetId] = useState('crf-balanced');
  const [customTargetMB, setCustomTargetMB] = useState(25);

  const [crf, setCrf] = useState(23);
  const [speedPreset, setSpeedPreset] = useState('medium');
  const [resolution, setResolution] = useState('original');
  const [customResolution, setCustomResolution] = useState('');
  const [canvasFit, setCanvasFit] = useState('pad');
  const [fps, setFps] = useState('original');
  const [customFps, setCustomFps] = useState('');
  const [fpsMode, setFpsMode] = useState('cfr');
  const [audioBitrate, setAudioBitrate] = useState('192k');
  const [audioSampleRate, setAudioSampleRate] = useState('original');
  const [audioChannels, setAudioChannels] = useState('original');
  const [muteAudio, setMuteAudio] = useState(false);
  const [audioBoostDb, setAudioBoostDb] = useState(0);
  const [trackMode, setTrackMode] = useState('keep');
  const [stripMetadata, setStripMetadata] = useState(false);
  const [customDir, setCustomDir] = useState('');

  const [previewFrame, setPreviewFrame] = useState(null);
  const [isLoadingFrame, setIsLoadingFrame] = useState(false);

  const destination = customDir || outputDir;
  const isTikTok = activeWorkflow === 'target_size' && selectedPresetId === 'tiktok';
  const isGif = activeWorkflow === 'convert' && mediaType === 'video' && selectedFormat === 'gif';
  const extractAudio = activeWorkflow === 'convert' && mediaType === 'audio';
  const multiTrack = targets.some((f) => (f.mediaInfo?.audioTracks?.length || 0) > 1);

  const fetchRandomFrame = useCallback(async (filePath) => {
    if (!filePath || !window.itzCutAPI?.extractFrame) return;
    setIsLoadingFrame(true);
    try {
      const res = await window.itzCutAPI.extractFrame(filePath);
      if (res && res.dataUrl) setPreviewFrame({ ...res, filePath });
    } catch (err) {
      console.warn('Failed to extract preview frame:', err);
    } finally {
      setIsLoadingFrame(false);
    }
  }, []);

  useEffect(() => {
    setPreviewFrame(null);
    if (activeFile && !isFileAudio) fetchRandomFrame(activeFile.path);
  }, [activeFile?.path, isFileAudio, fetchRandomFrame]);

  // Audio sources go straight to the audio converter.
  useEffect(() => {
    if (isFileAudio) {
      setMediaType('audio');
      setActiveWorkflow('convert');
      setSelectedFormat((fmt) => (CONVERTER_AUDIO_FORMATS.some((f) => f.ext === fmt) ? fmt : 'mp3'));
    } else if (activeFile) {
      setMediaType('video');
      setSelectedFormat((fmt) => (CONVERTER_VIDEO_FORMATS.some((f) => f.ext === fmt) ? fmt : 'mp4'));
    }
  }, [activeFile?.path, isFileAudio]);

  const handlePickOutputDir = async () => {
    if (!window.itzCutAPI) return;
    const folder = await window.itzCutAPI.selectFolderDialog();
    if (folder) setCustomDir(folder);
  };

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

  const switchWorkflow = (workflow) => {
    setActiveWorkflow(workflow);
    if (workflow !== 'convert') setMediaType('video');
    if (workflow === 'target_size' && !COMPRESSOR_PRESETS.some((p) => p.id === selectedPresetId && p.type !== 'crf')) setSelectedPresetId('');
  };

  // Estimate for the file on screen
  const duration = mediaInfo?.duration || 60;
  const originalSizeMB = activeFile ? activeFile.size / (1024 * 1024) : 100;
  const targetMB = isTikTok ? Math.round((duration * 20.2) / 8) : customTargetMB;
  const estimatedSaving = originalSizeMB > 0 ? Math.max(0, Math.round((1 - targetMB / originalSizeMB) * 100)) : 0;

  const effectiveFps =
    fps === 'custom' ? (customFps && parseFloat(customFps) > 0 ? String(Math.min(300, Math.max(1, parseFloat(customFps)))) : 'original') : fps;

  const handleStartProcess = () => {
    if (targets.length === 0) {
      onShowToast('Please load a media file first!', 'error');
      return;
    }
    if (!destination) {
      onShowToast('Choose a destination folder first.', 'error');
      return;
    }

    const isAudioOnly = mediaType === 'audio' || isFileAudio;
    let cleanCustomRes = '';
    if (!isAudioOnly && resolution === 'custom' && !isTikTok) {
      const match = (customResolution || '').trim().match(/(\d{2,5})\s*[*xX:\-,\s]\s*(\d{2,5})/);
      if (!match) {
        onShowToast('Enter a valid resolution as WIDTHxHEIGHT (e.g. 1920x1080).', 'error');
        return;
      }
      cleanCustomRes = `${match[1]}x${match[2]}`;
    }

    const audioTracks = muteAudio ? undefined : { mode: trackMode };
    const boost = parseInt(audioBoostDb, 10) || 0;
    const resLabel = resolution === 'custom' ? ` · ${cleanCustomRes}` : resolution !== 'original' ? ` · ${resolution.toUpperCase()}` : '';
    const picture = { resolution, customResolution: cleanCustomRes, canvasFit, fps: effectiveFps, fpsMode };

    let outExt;
    let mode;
    let title;
    let options;

    if (isAudioOnly) {
      const fmt = CONVERTER_AUDIO_FORMATS.find((f) => f.ext === selectedFormat) || CONVERTER_AUDIO_FORMATS[0];
      const lossless = fmt.defaultBitrate === 'uncompressed' || fmt.defaultBitrate === 'lossless';
      outExt = fmt.ext;
      mode = 'convert';
      title = `Convert Audio to ${fmt.label}`;
      options = {
        format: selectedFormat,
        videoCodec: 'none',
        audioCodec: fmt.audioCodec,
        audioBitrate: lossless ? null : audioBitrate,
        sampleRate: audioSampleRate !== 'original' ? parseInt(audioSampleRate, 10) : null,
        channels: audioChannels !== 'original' ? parseInt(audioChannels, 10) : null,
        audioOnly: true,
        muteAudio: false,
        audioBoostDb: boost,
        audioTracks: { mode: trackMode },
        stripMetadata,
      };
    } else if (isTikTok) {
      outExt = 'mp4';
      mode = 'compress';
      title = 'TikTok 2-Pass VBR';
      options = { type: 'tiktok', preset: speedPreset, fpsMode: 'cfr', muteAudio, audioBoostDb: boost, audioTracks, stripMetadata };
    } else if (activeWorkflow === 'target_size') {
      outExt = 'mp4';
      mode = 'compress';
      title = `Target Size ${customTargetMB} MB${resLabel}`;
      options = { type: 'target_size', targetSizeMB: customTargetMB, preset: speedPreset, ...picture, muteAudio, audioBoostDb: boost, audioTracks, stripMetadata };
    } else if (activeWorkflow === 'crf') {
      outExt = 'mp4';
      mode = 'compress';
      title = `CRF ${crf} Optimization${resLabel}`;
      options = { type: 'crf', crf, preset: speedPreset, ...picture, audioBitrate, muteAudio, audioBoostDb: boost, audioTracks, stripMetadata };
    } else {
      const fmt = CONVERTER_VIDEO_FORMATS.find((f) => f.ext === selectedFormat) || CONVERTER_VIDEO_FORMATS[0];
      outExt = selectedFormat === 'mp4-hevc' ? 'mp4' : selectedFormat;
      mode = 'convert';
      title = `Convert to ${fmt.label} ${fmt.tag}${resLabel}`;
      options = {
        format: selectedFormat,
        videoCodec: fmt.defaultCodec || 'libx264',
        audioCodec: 'aac',
        preset: speedPreset,
        ...picture,
        crf,
        audioBitrate,
        audioOnly: false,
        muteAudio: muteAudio || isGif,
        audioBoostDb: boost,
        audioTracks: isGif ? undefined : audioTracks,
        stripMetadata,
      };
    }

    const jobs = targets.map((file) => ({
      inputFile: file.path,
      outputFile: buildOutputPath(destination, file.name, settings.fileSuffix, outExt),
      mode,
      duration: file.mediaInfo?.duration || 0,
      options,
      title,
      inputName: file.name,
    }));
    onAddJobs(jobs);
  };

  const sourceRes = mediaInfo?.video?.width ? `${mediaInfo.video.width}×${mediaInfo.video.height}` : 'Auto';
  const resolutionOptions = [{ value: 'original', label: 'Original', hint: sourceRes }, ...RESOLUTION_OPTIONS];
  const fpsOptions = [{ value: 'original', label: 'Original', hint: mediaInfo?.video?.fps ? `${mediaInfo.video.fps} fps` : 'Auto' }, ...FPS_OPTIONS];
  const startLabel =
    targets.length > 1 ? `Queue ${targets.length} ${isFileAudio ? 'Audio Files' : 'Videos'}` : isFileAudio || extractAudio ? 'Start Audio Conversion' : 'Start Processing';

  const destinationField = (
    <DestinationField dir={destination} onPick={handlePickOutputDir} onReset={() => setCustomDir('')} isCustom={!!customDir && customDir !== outputDir} />
  );

  const startButton = (
    <button className="btn-gold btn-block" onClick={handleStartProcess} disabled={targets.length === 0}>
      {targets.length > 1 ? <Layers size={16} /> : <Sparkles size={16} />}
      <span>{startLabel}</span>
    </button>
  );

  const trackSelector = multiTrack && (
    <div className="inline-field">
      <span className="inline-field-label">Audio Tracks</span>
      <Segmented size="sm" stretch={false} options={TRACK_MODES} value={trackMode} onChange={setTrackMode} ariaLabel="Audio track handling" />
    </div>
  );

  return (
    <div className="tab-stack">
      <MediaTray
        files={files}
        activeFileId={activeFile?.id}
        onSelect={onSelectFile}
        onRemove={onRemoveFile}
        onClear={onClearFiles}
        onAddFiles={onAddFiles}
        onShowToast={onShowToast}
        batchHint={otherKind > 0 ? `Settings apply to the ${targets.length} ${isFileAudio ? 'audio files' : 'videos'}; select a ${isFileAudio ? 'video' : 'audio file'} for the other ${otherKind}.` : null}
      />

      {activeFile && (
        <div className="grid-2 converter-grid">
          {/* Left: workflow */}
          <div className="card">
            {isFileAudio ? (
              <>
                <div className="card-header">
                  <div className="card-title">
                    <Music size={18} />
                    <span>Audio Format</span>
                  </div>
                </div>
                <div className="format-grid">
                  {CONVERTER_AUDIO_FORMATS.map((fmt) => (
                    <PresetCard key={fmt.ext} active={selectedFormat === fmt.ext} title={fmt.label} tag={fmt.tag} desc={fmt.desc} onClick={() => setSelectedFormat(fmt.ext)} />
                  ))}
                </div>
              </>
            ) : (
              <>
                <Segmented variant="tabs" options={WORKFLOW_TABS} value={activeWorkflow} onChange={switchWorkflow} ariaLabel="Workflow" className="workflow-tabs" />

                <div key={activeWorkflow} className="workflow-panel">
                  {activeWorkflow === 'crf' && (
                    <>
                      <div className="format-grid">
                        {COMPRESSOR_PRESETS.filter((p) => p.type === 'crf').map((p) => (
                          <PresetCard key={p.id} active={selectedPresetId === p.id} title={p.title} tag={p.tag} desc={p.desc} onClick={() => handlePresetSelect(p)} />
                        ))}
                      </div>

                      <div className="form-group">
                        <div className="form-label">
                          <span>Constant Rate Factor</span>
                          <span className="label-badges">
                            <span className="quality-tag">{crfQuality(crf)}</span>
                            <span className="value-chip accent mono">{crf}</span>
                          </span>
                        </div>
                        <input
                          type="range"
                          className="range-slider"
                          min="14"
                          max="35"
                          value={crf}
                          style={{ '--fill': `${((crf - 14) / 21) * 100}%` }}
                          onChange={(e) => {
                            setCrf(parseInt(e.target.value, 10));
                            setSelectedPresetId('');
                          }}
                          aria-label="Constant rate factor"
                        />
                        <div className="slider-scale">
                          <span>Higher quality</span>
                          <span>Smaller file</span>
                        </div>
                      </div>

                      <div className="frame-preview">
                        <div className="frame-preview-head">
                          <span className="frame-preview-title">
                            <Camera size={14} />
                            Source Frame
                          </span>
                          <button
                            type="button"
                            className="btn-secondary btn-xs"
                            onClick={() => fetchRandomFrame(activeFile.path)}
                            disabled={isLoadingFrame}
                            title="Sample another random frame from the video"
                          >
                            <RefreshCw size={11} className={isLoadingFrame ? 'spin' : ''} />
                            <span>{isLoadingFrame ? 'Sampling…' : 'Random Frame'}</span>
                          </button>
                        </div>
                        {previewFrame?.dataUrl && previewFrame.filePath === activeFile.path ? (
                          <div className="frame-preview-image">
                            <img src={previewFrame.dataUrl} alt="Frame from the source video" />
                            <span className="frame-badge accent">{formatTimecode(previewFrame.timestamp || 0)}</span>
                            <span className="frame-badge right">{sourceRes}</span>
                          </div>
                        ) : (
                          <div className="frame-preview-empty">
                            {isLoadingFrame ? (
                              <>
                                <RefreshCw size={14} className="spin icon-accent" />
                                <span>Extracting frame…</span>
                              </>
                            ) : (
                              <span>No preview frame available.</span>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {activeWorkflow === 'convert' && (
                    <>
                      <Segmented
                        size="sm"
                        options={[
                          { value: 'video', label: 'Video / GIF', icon: Video },
                          { value: 'audio', label: 'Extract Audio', icon: Music },
                        ]}
                        value={mediaType}
                        onChange={(type) => {
                          setMediaType(type);
                          setSelectedFormat(type === 'video' ? 'mp4' : 'mp3');
                        }}
                        ariaLabel="Output kind"
                      />
                      <div className="format-grid">
                        {(mediaType === 'video' ? CONVERTER_VIDEO_FORMATS : CONVERTER_AUDIO_FORMATS).map((fmt) => (
                          <PresetCard key={fmt.ext} active={selectedFormat === fmt.ext} title={fmt.label} tag={fmt.tag} desc={fmt.desc} onClick={() => setSelectedFormat(fmt.ext)} />
                        ))}
                      </div>
                    </>
                  )}

                  {activeWorkflow === 'target_size' && (
                    <>
                      <div className="format-grid">
                        {COMPRESSOR_PRESETS.filter((p) => p.type !== 'crf').map((p) => (
                          <PresetCard key={p.id} active={selectedPresetId === p.id} title={p.title} tag={p.tag} desc={p.desc} onClick={() => handlePresetSelect(p)} />
                        ))}
                      </div>

                      {isTikTok ? (
                        <div className="info-panel">
                          <div className="info-panel-title">
                            <ShieldCheck size={14} /> TikTok profile
                          </div>
                          <div className="info-panel-text">
                            Genuine two-pass VBR: 20 Mbps average with 40 Mbps peaks, constant frame rate, H.264 Main profile, 4 reference frames and the
                            source resolution.
                          </div>
                        </div>
                      ) : (
                        <div className="form-group">
                          <div className="form-label">
                            <span>Custom Size Limit</span>
                            <span className="number-chip">
                              <input
                                type="number"
                                min="1"
                                max="100000"
                                value={customTargetMB}
                                onChange={(e) => {
                                  const value = Math.max(1, Math.min(100000, parseInt(e.target.value, 10) || 1));
                                  setCustomTargetMB(value);
                                  setSelectedPresetId('');
                                }}
                                aria-label="Target size in megabytes"
                              />
                              <span>MB</span>
                            </span>
                          </div>
                          <input
                            type="range"
                            className="range-slider"
                            min="2"
                            max="500"
                            step="1"
                            value={Math.min(500, customTargetMB)}
                            style={{ '--fill': `${((Math.min(500, customTargetMB) - 2) / 498) * 100}%` }}
                            onChange={(e) => {
                              setCustomTargetMB(parseInt(e.target.value, 10));
                              setSelectedPresetId('');
                            }}
                            aria-label="Target size"
                          />
                        </div>
                      )}

                      <div className="estimate-card">
                        <div>
                          <div className="estimate-label">Estimated Reduction</div>
                          <div className="estimate-value">{estimatedSaving > 0 ? `About -${estimatedSaving}%` : 'Larger than source'}</div>
                        </div>
                        <div className="estimate-sizes">
                          <span className="old">{formatBytes(activeFile.size)}</span>
                          <span className="new">~ {formatBytes(targetMB * 1024 * 1024)}</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Right: encoding options */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                {isFileAudio || extractAudio ? <Music size={18} /> : <Gauge size={18} />}
                <span>{isFileAudio || extractAudio ? 'Audio Options' : 'Encoding Options'}</span>
              </div>
            </div>

            <div className="options-stack">
              {isFileAudio || extractAudio ? (
                <>
                  {selectedFormat === 'wav' || selectedFormat === 'flac' ? (
                    <div className="info-panel">
                      <div className="info-panel-title">{selectedFormat === 'wav' ? 'Uncompressed PCM' : 'Lossless FLAC'}</div>
                      <div className="info-panel-text">Bit-perfect output: no bitrate to choose.</div>
                    </div>
                  ) : (
                    <div className="form-group">
                      <label className="form-label">Audio Bitrate</label>
                      <Select value={audioBitrate} onChange={setAudioBitrate} options={AUDIO_BITRATES} ariaLabel="Audio bitrate" />
                    </div>
                  )}

                  <div className="grid-2 tight">
                    <div className="form-group">
                      <label className="form-label">Sample Rate</label>
                      <Select
                        value={audioSampleRate}
                        onChange={setAudioSampleRate}
                        options={[{ value: 'original', label: 'Original', hint: mediaInfo?.audio?.sampleRate ? `${mediaInfo.audio.sampleRate / 1000} kHz` : 'Auto' }, ...SAMPLE_RATES]}
                        ariaLabel="Sample rate"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Channels</label>
                      <Select
                        value={audioChannels}
                        onChange={setAudioChannels}
                        options={[
                          { value: 'original', label: 'Original', hint: mediaInfo?.audio?.channels === 1 ? 'Mono' : 'Stereo' },
                          { value: '2', label: 'Stereo', hint: '2.0' },
                          { value: '1', label: 'Mono', hint: '1.0' },
                        ]}
                        ariaLabel="Channels"
                      />
                    </div>
                  </div>

                  <AudioGainControl boostDb={audioBoostDb} onBoostChange={setAudioBoostDb} allowMute={false} />
                  {trackSelector}
                  <Toggle checked={stripMetadata} onChange={setStripMetadata} label="Strip Metadata" description="Removes personal tags and device information." />
                </>
              ) : (
                <>
                  {!isTikTok && (
                    <>
                      <div className="grid-2 tight">
                        <div className="form-group">
                          <label className="form-label">Resolution</label>
                          <Select value={resolution} onChange={setResolution} options={resolutionOptions} ariaLabel="Resolution" />
                        </div>
                        <div className="form-group">
                          <div className="form-label">
                            <span>Framerate (FPS)</span>
                            {!isGif && (
                              <Segmented
                                size="xs"
                                stretch={false}
                                options={[
                                  { value: 'cfr', label: 'CFR', title: 'Constant frame rate: every frame has the same duration' },
                                  { value: 'vfr', label: 'VFR', title: 'Variable frame rate: repeated frames are dropped' },
                                ]}
                                value={fpsMode}
                                onChange={setFpsMode}
                                ariaLabel="Frame rate mode"
                              />
                            )}
                          </div>
                          <Select value={fps} onChange={setFps} options={fpsOptions} ariaLabel="Frame rate" />
                        </div>
                      </div>

                      <Collapse open={fps === 'custom'}>
                        <div className="form-group">
                          <div className="form-label">
                            <span>Custom Framerate</span>
                            <span className="hint-text">1 – 300 fps</span>
                          </div>
                          <div className="input-with-chips">
                            <input
                              type="number"
                              min="1"
                              max="300"
                              step="any"
                              className="form-input"
                              placeholder="e.g. 120"
                              value={customFps}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') return setCustomFps('');
                                const n = parseFloat(val);
                                return setCustomFps(n > 300 ? '300' : n < 1 ? '1' : val);
                              }}
                            />
                            {['120', '144', '240'].map((v) => (
                              <button key={v} type="button" className={`chip ${customFps === v ? 'active' : ''}`} onClick={() => setCustomFps(v)}>
                                {v}
                              </button>
                            ))}
                          </div>
                        </div>
                      </Collapse>

                      <Collapse open={resolution === 'custom'}>
                        <div className="form-group">
                          <div className="form-label">
                            <span>Custom Resolution</span>
                            <span className="hint-text">Width × Height</span>
                          </div>
                          <div className="input-with-chips">
                            <input
                              type="text"
                              className="form-input"
                              placeholder="e.g. 2560x1080"
                              value={customResolution}
                              onChange={(e) => setCustomResolution(e.target.value)}
                            />
                            {[
                              ['1920x1080', '16:9'],
                              ['1080x1920', '9:16'],
                              ['1080x1080', '1:1'],
                            ].map(([v, label]) => (
                              <button key={v} type="button" className={`chip ${customResolution === v ? 'active' : ''}`} onClick={() => setCustomResolution(v)} title={v}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </Collapse>

                      <Collapse open={resolution !== 'original'}>
                        <div className="inline-field">
                          <span className="inline-field-label">Scaling</span>
                          <Segmented size="sm" stretch={false} options={FIT_MODES} value={canvasFit} onChange={setCanvasFit} ariaLabel="Scaling fit mode" />
                        </div>
                      </Collapse>
                    </>
                  )}

                  {!isGif && <SpeedPresetSlider value={speedPreset} onChange={setSpeedPreset} systemInfo={ffmpegStatus?.systemInfo} />}

                  {!isGif && (
                    <AudioGainControl boostDb={audioBoostDb} onBoostChange={setAudioBoostDb} muted={muteAudio} onMutedChange={setMuteAudio}>
                      {activeWorkflow !== 'target_size' && (
                        <div className="inline-field">
                          <span className="inline-field-label">Bitrate</span>
                          <div className="inline-field-control">
                            <Select value={audioBitrate} onChange={setAudioBitrate} options={AUDIO_BITRATES.filter((b) => b.value !== '64k')} ariaLabel="Audio bitrate" />
                          </div>
                        </div>
                      )}
                      {trackSelector}
                    </AudioGainControl>
                  )}

                  <Toggle
                    checked={stripMetadata}
                    onChange={setStripMetadata}
                    label="Strip EXIF / Metadata"
                    description="Clears device models, GPS coordinates and creation tags."
                  />
                </>
              )}

              {destinationField}
              {startButton}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
