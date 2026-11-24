import React, { useState, useEffect } from 'react';
import {
  Scissors,
  Zap,
  Clock,
  Folder,
  Sliders,
  RotateCw,
  RotateCcw,
  Music,
  Layers,
  FlipHorizontal2,
  FlipVertical2,
  RectangleHorizontal,
  Film,
  Volume2,
  Image as ImageIcon,
} from 'lucide-react';
import MediaTray from '../components/MediaTray';
import MediaPreview from '../components/MediaPreview';
import AudioPreview from '../components/AudioPreview';
import AudioTracksPanel from '../components/AudioTracksPanel';
import AudioGainControl from '../components/AudioGainControl';
import Select from '../components/Select';
import { Segmented, Collapse, Toggle, SectionLabel } from '../components/ui';
import { formatTimecode, parseTimecode } from '../utils/formatters';
import { isAudioMedia } from '../utils/fileTypes';
import { buildOutputPath } from '../utils/settings';

const ROTATIONS = [
  { value: 'none', icon: RectangleHorizontal, title: 'Original orientation' },
  { value: '90cw', icon: RotateCw, title: 'Rotate 90° clockwise' },
  { value: '90ccw', icon: RotateCcw, title: 'Rotate 90° counter-clockwise' },
  { value: '180', label: '180°', title: 'Rotate 180° (upside down)' },
  { value: 'hflip', icon: FlipHorizontal2, title: 'Mirror horizontally' },
  { value: 'vflip', icon: FlipVertical2, title: 'Flip vertically' },
];

const ASPECTS = [
  { value: 'original', label: 'Original', w: 16, h: 10, title: 'Keep the source aspect ratio' },
  { value: '16:9', label: '16:9', w: 16, h: 9, title: 'Landscape (YouTube)' },
  { value: '9:16', label: '9:16', w: 9, h: 16, title: 'Vertical (TikTok, Reels, Shorts)' },
  { value: '1:1', label: '1:1', w: 12, h: 12, title: 'Square (Instagram)' },
  { value: '4:3', label: '4:3', w: 14, h: 10.5, title: 'Classic 4:3' },
];

const FIT_MODES = [
  { value: 'pad', label: 'Fit', title: 'Black bars, nothing cropped' },
  { value: 'crop', label: 'Fill', title: 'Center crop, no bars' },
  { value: 'stretch', label: 'Stretch', title: 'Distort to fill the frame' },
];

const SPEEDS = [
  { value: 0.5, label: '0.5×', title: 'Slow motion' },
  { value: 1, label: '1×', title: 'Normal speed' },
  { value: 1.5, label: '1.5×', title: 'Fast' },
  { value: 2, label: '2×', title: 'Double speed' },
];

const GIF_RATES = [10, 15, 24, 30].map((v) => ({ value: v, label: `${v} fps` }));

const AUDIO_EXPORT_FORMATS = [
  { value: 'mp3', label: 'MP3', hint: '320 kbps' },
  { value: 'wav', label: 'WAV', hint: 'Uncompressed' },
  { value: 'aac', label: 'AAC', hint: 'M4A' },
  { value: 'flac', label: 'FLAC', hint: 'Lossless' },
  { value: 'opus', label: 'Opus', hint: 'OGG' },
];

function AspectPicker({ value, onChange }) {
  return (
    <div className="aspect-picker" role="radiogroup" aria-label="Aspect ratio">
      {ASPECTS.map((aspect) => (
        <button
          key={aspect.value}
          type="button"
          role="radio"
          aria-checked={value === aspect.value}
          className={`aspect-chip ${value === aspect.value ? 'active' : ''}`}
          onClick={() => onChange(aspect.value)}
          title={aspect.title}
        >
          <span className={`aspect-shape ${aspect.value === 'original' ? 'dashed' : ''}`} style={{ width: aspect.w, height: aspect.h }} />
          <span>{aspect.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function TrimmerTab({
  files,
  activeFile,
  mediaInfo,
  onAddFiles,
  onRemoveFile,
  onClearFiles,
  onSelectFile,
  outputDir,
  settings,
  onAddJobs,
  onShowToast,
}) {
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(mediaInfo?.duration || 0);
  const [muteAudio, setMuteAudio] = useState(false);
  const [losslessCopy, setLosslessCopy] = useState(true);
  const [speed, setSpeed] = useState(1);

  const [rotation, setRotation] = useState('none');
  const [aspectRatio, setAspectRatio] = useState('original');
  const [canvasFit, setCanvasFit] = useState('pad');
  const [audioBoostDb, setAudioBoostDb] = useState(0);
  const [loudnorm, setLoudnorm] = useState(false);
  const [exportAsGif, setExportAsGif] = useState(false);
  const [gifFps, setGifFps] = useState(15);
  const [audioExportFormat, setAudioExportFormat] = useState('original');
  const [frameBlend, setFrameBlend] = useState(false);
  const [trackMode, setTrackMode] = useState('keep');
  const [includedTracks, setIncludedTracks] = useState([]);
  const [customDir, setCustomDir] = useState('');

  const isAudio = isAudioMedia(activeFile, mediaInfo);
  const tracks = mediaInfo?.audioTracks || [];
  const hasTrackChoice = tracks.length > 1;
  const destination = customDir || outputDir;

  // Every new file starts from its full length with all of its tracks enabled.
  useEffect(() => {
    setStartTime(0);
    setEndTime(mediaInfo?.duration || 0);
    setIncludedTracks((mediaInfo?.audioTracks || []).map((t) => t.order));
  }, [activeFile?.path, mediaInfo]);

  // Vegas-style frame blending (high-FPS source -> 60 fps). Eligibility is computed by the main process
  // from the probed frame rate: below 90 fps there is nothing to blend, 360 fps and above is refused.
  const blendInfo = mediaInfo?.video?.frameBlend || null;
  const blendEligible = !isAudio && !!blendInfo?.eligible;
  const blendActive = frameBlend && blendEligible && !exportAsGif;
  const blendFramesPerOutput = blendInfo?.sourceFps ? (blendInfo.sourceFps * speed) / (blendInfo.outputFps || 60) : 0;

  useEffect(() => {
    if (!blendEligible) setFrameBlend(false);
  }, [blendEligible, activeFile?.path]);

  const mergeTracks = hasTrackChoice && trackMode === 'merge' && includedTracks.length > 1;
  const audioFiltered = audioBoostDb > 0 || loudnorm || mergeTracks;

  // Stream copy needs an untouched picture; audio changes only re-encode the audio.
  const requiresReencode = isAudio
    ? audioFiltered || speed !== 1 || (audioExportFormat !== 'original' && audioExportFormat !== activeFile?.ext)
    : rotation !== 'none' || aspectRatio !== 'original' || exportAsGif || blendActive || speed !== 1;
  const effectiveLossless = losslessCopy && !requiresReencode;

  const handlePickOutputDir = async () => {
    if (!window.itzCutAPI) return;
    const folder = await window.itzCutAPI.selectFolderDialog();
    if (folder) setCustomDir(folder);
  };

  const toggleTrack = (order) =>
    setIncludedTracks((prev) => (prev.includes(order) ? prev.filter((o) => o !== order) : [...prev, order].sort((a, b) => a - b)));

  const clipDuration = Math.max(0, endTime - startTime);
  const silent = !isAudio && (muteAudio || (hasTrackChoice && includedTracks.length === 0));

  const handleStartTrim = () => {
    if (!activeFile) {
      onShowToast('Please load a media file first!', 'error');
      return;
    }
    if (endTime <= startTime) {
      onShowToast('Cut Out time must be greater than Cut In time!', 'error');
      return;
    }
    if (!destination) {
      onShowToast('Choose a destination folder first.', 'error');
      return;
    }

    const ext = isAudio
      ? audioExportFormat === 'original'
        ? activeFile.ext || 'mp3'
        : audioExportFormat === 'aac'
        ? 'm4a'
        : audioExportFormat
      : exportAsGif
      ? 'gif'
      : effectiveLossless || ['mp4', 'mov', 'mkv', 'm4v'].includes(activeFile.ext)
      ? activeFile.ext || 'mp4'
      : 'mp4'; // re-encodes produce H.264 + AAC, which WebM / AVI / WMV / FLV cannot carry

    const range = `${formatTimecode(startTime)} - ${formatTimecode(endTime)}`;
    onAddJobs([
      {
        inputFile: activeFile.path,
        outputFile: buildOutputPath(destination, activeFile.name, `${settings.fileSuffix}_trim`, ext),
        mode: 'trim',
        duration: clipDuration,
        options: {
          start: startTime,
          end: endTime,
          muteAudio: !isAudio && muteAudio,
          losslessCopy: effectiveLossless,
          speed,
          rotation,
          aspectRatio,
          canvasFit,
          audioBoostDb,
          loudnorm,
          exportAsGif,
          gifFps,
          isAudioOnly: isAudio,
          audioExportFormat: ext,
          frameBlend: blendActive,
          audioTracks: hasTrackChoice ? { mode: trackMode, include: includedTracks } : undefined,
        },
        title: isAudio
          ? `Trim Audio (${range})`
          : exportAsGif
          ? `HD GIF Clip (${range})`
          : blendActive
          ? `Frame Blend ${blendInfo.sourceFps}→${blendInfo.outputFps} fps (${range})`
          : `Trim Clip (${range})`,
        inputName: activeFile.name,
      },
    ]);
  };

  let losslessDescription = 'Instant cut without re-encoding: no quality loss.';
  if (requiresReencode) {
    losslessDescription = isAudio
      ? 'Unavailable: audio filters, speed or format changes need re-encoding.'
      : 'Unavailable: rotation, aspect ratio, speed, GIF or frame blending need re-encoding.';
  } else if (effectiveLossless && !isAudio && audioFiltered && !silent) {
    losslessDescription = 'Video copied untouched; only the audio is re-encoded.';
  }

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
        batchHint={files.length > 1 ? 'The trimmer works on the selected file.' : null}
      />

      {activeFile && (
        <>
          {isAudio ? (
            <AudioPreview
              filePath={activeFile.path}
              fileName={activeFile.name}
              fileSize={activeFile.size}
              duration={mediaInfo?.duration || 0}
              trimStart={startTime}
              trimEnd={endTime}
              onSetTrimStart={setStartTime}
              onSetTrimEnd={setEndTime}
              isMuted={false}
              audioBoostDb={audioBoostDb}
              speed={speed}
              mediaInfo={mediaInfo}
            />
          ) : (
            <MediaPreview
              filePath={activeFile.path}
              duration={mediaInfo?.duration || 0}
              trimStart={startTime}
              trimEnd={endTime}
              onSetTrimStart={setStartTime}
              onSetTrimEnd={setEndTime}
              isMuted={silent}
              rotation={rotation}
              aspectRatio={aspectRatio}
              canvasFit={canvasFit}
              audioBoostDb={audioBoostDb}
              speed={speed}
              mediaInfo={mediaInfo}
            />
          )}

          {hasTrackChoice && (
            <AudioTracksPanel
              tracks={tracks}
              included={includedTracks}
              onToggleTrack={toggleTrack}
              mode={trackMode}
              onModeChange={setTrackMode}
              disabled={!isAudio && muteAudio}
              duration={mediaInfo?.duration || 0}
              start={startTime}
              end={endTime}
            />
          )}

          <div className="grid-2">
            {/* Cut points */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">
                  <Scissors size={18} />
                  <span>Precision Cut Points</span>
                </div>
              </div>

              <div className="grid-2 tight">
                <div className="form-group">
                  <label className="form-label">
                    <span>Cut Start [ In ]</span>
                    <button type="button" className="link-btn" onClick={() => setStartTime(0)} title="Back to the start of the file">
                      Reset
                    </button>
                  </label>
                  <input
                    type="text"
                    className="form-input timecode-input"
                    value={formatTimecode(startTime)}
                    onChange={(e) => setStartTime(parseTimecode(e.target.value))}
                    aria-label="Cut start"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    <span>Cut End [ Out ]</span>
                    <button type="button" className="link-btn" onClick={() => setEndTime(mediaInfo?.duration || 0)} title="To the end of the file">
                      To End
                    </button>
                  </label>
                  <input
                    type="text"
                    className="form-input timecode-input"
                    value={formatTimecode(endTime)}
                    onChange={(e) => setEndTime(parseTimecode(e.target.value))}
                    aria-label="Cut end"
                  />
                </div>
              </div>

              <div className="duration-summary">
                <span className="duration-summary-label">
                  <Clock size={15} className="icon-accent" />
                  Clip Duration
                </span>
                <span className="duration-summary-value">{formatTimecode(clipDuration / speed)}</span>
              </div>

              <div className="options-stack">
                <Toggle
                  checked={effectiveLossless}
                  onChange={(value) => {
                    if (requiresReencode) {
                      onShowToast(losslessDescription, 'info');
                      return;
                    }
                    setLosslessCopy(value);
                  }}
                  disabled={requiresReencode}
                  icon={Zap}
                  label="Instant Lossless Cut"
                  description={losslessDescription}
                />

                <div className="inline-field">
                  <span className="inline-field-label">Playback Speed</span>
                  <Segmented size="sm" stretch={false} options={SPEEDS} value={speed} onChange={setSpeed} ariaLabel="Playback speed" />
                </div>
                {!isAudio && (
                  <>
                        <SectionLabel icon={Film}>Picture</SectionLabel>
                        <div className="inline-field">
                          <span className="inline-field-label">Orientation</span>
                          <Segmented size="sm" stretch={false} options={ROTATIONS} value={rotation} onChange={setRotation} ariaLabel="Rotate and flip" />
                        </div>
                        <div className="stack-tight">
                          <span className="inline-field-label">Aspect Ratio</span>
                          <AspectPicker value={aspectRatio} onChange={setAspectRatio} />
                          <Collapse open={aspectRatio !== 'original'}>
                            <div className="inline-field nested">
                              <span className="inline-field-label">Fit Mode</span>
                              <Segmented size="sm" stretch={false} options={FIT_MODES} value={canvasFit} onChange={setCanvasFit} ariaLabel="Fit mode" />
                            </div>
                          </Collapse>
                        </div>
    
                        <Toggle
                          compact
                          checked={blendActive}
                          onChange={(value) => {
                            if (!blendEligible) {
                              if (blendInfo?.reason) onShowToast(blendInfo.reason, 'info');
                              return;
                            }
                            if (exportAsGif) {
                              onShowToast('Frame blending is not available for GIF exports.', 'info');
                              return;
                            }
                            setFrameBlend(value);
                          }}
                          disabled={!blendEligible || exportAsGif}
                          icon={Layers}
                          label={`Frame Blending${blendInfo?.sourceFps ? ` · ${blendInfo.sourceFps} → ${blendInfo.outputFps} fps` : ''}`}
                          description={
                            !blendEligible
                              ? blendInfo?.reason || 'Needs a high frame rate video (90–359 fps).'
                              : blendActive
                              ? blendFramesPerOutput > 1.01
                                ? `About ${Math.round(blendFramesPerOutput * 100) / 100} source frames merged into every frame for natural motion blur.`
                                : 'At this speed there are no extra frames to merge: the clip is conformed to 60 fps.'
                              : 'Merges the extra frames of high-FPS footage into smooth 60 fps motion blur.'
                          }
                        />
                  </>
                )}
              </div>
            </div>

            {/* Studio */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">
                  {isAudio ? <Music size={18} /> : <Sliders size={18} />}
                  <span>{isAudio ? 'Audio Studio' : 'Studio Enhancements'}</span>
                </div>
              </div>

              <div className="options-stack">
                {isAudio ? (
                  <>
                    <div className="form-group">
                      <label className="form-label">Export Format</label>
                      <Select
                        value={audioExportFormat}
                        onChange={setAudioExportFormat}
                        options={[{ value: 'original', label: 'Original', hint: (activeFile.ext || 'audio').toUpperCase() }, ...AUDIO_EXPORT_FORMATS]}
                        ariaLabel="Export format"
                      />
                    </div>
                    <AudioGainControl boostDb={audioBoostDb} onBoostChange={setAudioBoostDb} allowMute={false}>
                      <Toggle compact checked={loudnorm} onChange={setLoudnorm} label="Loudness Normalization" description="EBU R128 broadcast level, -16 LUFS." />
                    </AudioGainControl>
                  </>
                ) : (
                  <>

                    <SectionLabel icon={Volume2}>Audio</SectionLabel>
                    <AudioGainControl boostDb={audioBoostDb} onBoostChange={setAudioBoostDb} muted={muteAudio} onMutedChange={setMuteAudio}>
                      <Toggle compact checked={loudnorm} onChange={setLoudnorm} label="Loudness Normalization" description="EBU R128 broadcast level, -16 LUFS." />
                    </AudioGainControl>

                    <SectionLabel icon={ImageIcon}>Export</SectionLabel>
                    <Toggle compact checked={exportAsGif} onChange={setExportAsGif} label="Export as Animated GIF" description="High-definition looping GIF, no audio." />
                    <Collapse open={exportAsGif}>
                      <div className="inline-field nested">
                        <span className="inline-field-label">GIF Frame Rate</span>
                        <Segmented size="sm" stretch={false} options={GIF_RATES} value={gifFps} onChange={setGifFps} ariaLabel="GIF frame rate" />
                      </div>
                    </Collapse>
                  </>
                )}

                <div className="form-group">
                  <label className="form-label">
                    <span>Destination Folder</span>
                    {customDir && customDir !== outputDir && (
                      <button type="button" className="link-btn" onClick={() => setCustomDir('')}>
                        Reset
                      </button>
                    )}
                  </label>
                  <div className="path-field">
                    <span className="path-value" title={destination}>
                      {destination || '…'}
                    </span>
                    <button type="button" className="btn-secondary btn-compact" onClick={handlePickOutputDir}>
                      <Folder size={14} />
                      <span>Browse</span>
                    </button>
                  </div>
                </div>

                <button className="btn-gold btn-block" onClick={handleStartTrim}>
                  <Scissors size={16} />
                  <span>{isAudio ? 'Export Audio Clip' : 'Export Clip'}</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
