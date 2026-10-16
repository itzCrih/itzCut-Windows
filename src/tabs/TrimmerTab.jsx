import React, { useState, useEffect } from 'react';
import {
  Scissors,
  VolumeX,
  Zap,
  Clock,
  Folder,
  Sliders,
  RotateCw,
  Crop,
  Volume2,
  Sparkles,
  Music,
} from 'lucide-react';
import DropZone from '../components/DropZone';
import MediaPreview from '../components/MediaPreview';
import AudioPreview from '../components/AudioPreview';
import { formatTimecode, parseTimecode } from '../utils/formatters';
import { isAudioMedia } from '../utils/fileTypes';

export default function TrimmerTab({
  currentFile,
  mediaInfo,
  onFileSelected,
  onFileCleared,
  defaultOutputDir,
  onAddJob,
  onShowToast,
}) {
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(mediaInfo?.duration || 0);
  const [muteAudio, setMuteAudio] = useState(false);
  const [losslessCopy, setLosslessCopy] = useState(true);
  const [speed, setSpeed] = useState(1);

  // Integrated Studio Features
  const [rotation, setRotation] = useState('none'); // 'none', '90cw', '90ccw', '180', 'hflip', 'vflip'
  const [aspectRatio, setAspectRatio] = useState('original'); // 'original', '16:9', '9:16', '1:1', '4:3'
  const [canvasFit, setCanvasFit] = useState('pad'); // 'pad', 'crop', 'stretch'
  const [audioBoostDb, setAudioBoostDb] = useState(0); // 0 = off, 1-24 dB
  const [loudnorm, setLoudnorm] = useState(false);
  const [exportAsGif, setExportAsGif] = useState(false);
  const [gifFps, setGifFps] = useState(15);
  const [audioExportFormat, setAudioExportFormat] = useState('original'); // 'original', 'mp3', 'wav', 'aac', 'flac', 'opus'

  const [outputDir, setOutputDir] = useState(defaultOutputDir || '');

  const isAudio = isAudioMedia(currentFile, mediaInfo);

  // Keep endTime updated if file loads later
  useEffect(() => {
    if (mediaInfo?.duration && (endTime === 0 || endTime > mediaInfo.duration)) {
      setEndTime(mediaInfo.duration);
    }
  }, [mediaInfo, endTime]);

  // If rotation, aspect ratio, stretch fit, audio boost, or speed is changed, lossless copy cannot be used
  const requiresReencode = isAudio
    ? (audioBoostDb > 0 || loudnorm || speed !== 1 || (audioExportFormat !== 'original' && audioExportFormat !== currentFile?.ext))
    : (rotation !== 'none' ||
      aspectRatio !== 'original' ||
      canvasFit === 'stretch' ||
      audioBoostDb > 0 ||
      loudnorm ||
      exportAsGif ||
      speed !== 1);

  const effectiveLossless = losslessCopy && !requiresReencode;

  const handlePickOutputDir = async () => {
    if (!window.itzCutAPI) return;
    const folder = await window.itzCutAPI.selectFolderDialog();
    if (folder) setOutputDir(folder);
  };

  const clipDuration = Math.max(0, endTime - startTime);

  const handleStartTrim = () => {
    if (!currentFile) {
      onShowToast('Please load a media file first!', 'error');
      return;
    }

    if (endTime <= startTime) {
      onShowToast('Cut Out time must be greater than Cut In time!', 'error');
      return;
    }

    const baseName = currentFile.name.substring(0, currentFile.name.lastIndexOf('.')) || currentFile.name;
    const ext = isAudio
      ? (audioExportFormat === 'original' ? (currentFile.ext || 'mp3') : audioExportFormat)
      : (exportAsGif ? 'gif' : (currentFile.ext || 'mp4'));

    const targetDir = outputDir || defaultOutputDir;
    const outputFile = `${targetDir}\\${baseName}_trimmed_${Date.now()}.${ext}`;

    const jobConfig = {
      jobId: `trim_${Date.now()}`,
      inputFile: currentFile.path,
      outputFile,
      mode: 'trim',
      duration: clipDuration,
      options: {
        start: startTime,
        end: endTime,
        muteAudio,
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
      },
      title: isAudio
        ? `Trim Audio (${formatTimecode(startTime)} - ${formatTimecode(endTime)})`
        : exportAsGif
        ? `HD GIF Clip (${formatTimecode(startTime)} - ${formatTimecode(endTime)})`
        : `Trim Clip (${formatTimecode(startTime)} - ${formatTimecode(endTime)})`,
      inputName: currentFile.name,
    };

    onAddJob(jobConfig);
    onShowToast(`Trimming started: ${Math.round(clipDuration)}s clip in progress!`, 'success');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <DropZone
        currentFile={currentFile}
        mediaInfo={mediaInfo}
        onFileSelected={onFileSelected}
        onFileCleared={onFileCleared}
        onShowToast={onShowToast}
      />

      {currentFile && (
        <>
          {/* Conditionally render dedicated Audio Player or Video Player */}
          {isAudio ? (
            <AudioPreview
              filePath={currentFile.path}
              fileName={currentFile.name}
              fileSize={currentFile.size}
              duration={mediaInfo?.duration || 0}
              trimStart={startTime}
              trimEnd={endTime}
              onSetTrimStart={(time) => setStartTime(time)}
              onSetTrimEnd={(time) => setEndTime(time)}
              isMuted={muteAudio}
              audioBoostDb={audioBoostDb}
              speed={speed}
              mediaInfo={mediaInfo}
            />
          ) : (
            <MediaPreview
              filePath={currentFile.path}
              duration={mediaInfo?.duration || 0}
              trimStart={startTime}
              trimEnd={endTime}
              onSetTrimStart={(time) => setStartTime(time)}
              onSetTrimEnd={(time) => setEndTime(time)}
              isMuted={muteAudio}
              rotation={rotation}
              aspectRatio={aspectRatio}
              canvasFit={canvasFit}
              audioBoostDb={audioBoostDb}
              speed={speed}
              mediaInfo={mediaInfo}
            />
          )}

          {/* Settings Grid */}
          <div className="grid-2">
            {/* Cut Points & Trimming Range */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">
                  <Scissors size={18} />
                  <span>Precision Cut Points</span>
                </div>
              </div>

              <div className="grid-2" style={{ marginBottom: '14px' }}>
                <div className="form-group">
                  <label className="form-label">
                    <span>Cut Start [ In ]</span>
                    <button
                      className="icon-btn"
                      onClick={() => setStartTime(0)}
                      title="Reset to video start"
                    >
                      Reset 0s
                    </button>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '15px' }}
                    value={formatTimecode(startTime)}
                    onChange={(e) => setStartTime(parseTimecode(e.target.value))}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    <span>Cut End [ Out ]</span>
                    <button
                      className="icon-btn"
                      onClick={() => setEndTime(mediaInfo?.duration || 0)}
                      title="Set to video end"
                    >
                      To End
                    </button>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '15px' }}
                    value={formatTimecode(endTime)}
                    onChange={(e) => setEndTime(parseTimecode(e.target.value))}
                  />
                </div>
              </div>

              {/* Clip Duration Summary */}
              <div
                style={{
                  padding: '12px 16px',
                  background: 'rgba(230, 180, 34, 0.08)',
                  border: '1px solid var(--border-gold)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Clock size={16} color="#e6b422" />
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Trimmed Clip Duration:</span>
                </div>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '15px',
                    fontWeight: 700,
                    color: 'var(--gold-primary)',
                  }}
                >
                  {formatTimecode(clipDuration)}
                </span>
              </div>

              {/* Mode: Stream-Copy vs Frame Accurate */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label className="toggle-wrapper">
                  <div
                    className={`toggle-switch ${muteAudio ? 'on' : ''}`}
                    onClick={() => setMuteAudio(!muteAudio)}
                  >
                    <div className="toggle-knob" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <VolumeX size={15} color={muteAudio ? '#e6b422' : 'var(--text-muted)'} />
                      <span style={{ fontSize: '13px', fontWeight: 600 }}>Mute Clip Audio</span>
                    </div>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      Completely silences and strips audio track from the exported cut clip.
                    </span>
                  </div>
                </label>

                <label className="toggle-wrapper">
                  <div
                    className={`toggle-switch ${effectiveLossless ? 'on' : ''}`}
                    onClick={() => {
                      if (!requiresReencode) setLosslessCopy(!losslessCopy);
                    }}
                    style={{ opacity: requiresReencode ? 0.5 : 1 }}
                  >
                    <div className="toggle-knob" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Zap size={15} color={effectiveLossless ? '#e6b422' : 'var(--text-muted)'} />
                      <span style={{ fontSize: '13px', fontWeight: 600 }}>
                        Instant Lossless Cut (Stream Copy)
                      </span>
                    </div>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      {requiresReencode
                        ? 'Disabled because rotation, aspect ratio, or audio filters require re-encoding.'
                        : 'Instant 0-second cut without re-encoding quality loss (-c copy).'}
                    </span>
                  </div>
                </label>

                {!effectiveLossless && (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Playback Speed</label>
                    <select
                      className="form-select"
                      value={speed}
                      onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    >
                      <option value="0.5">0.5x (Slow Motion)</option>
                      <option value="1">1.0x (Normal Speed)</option>
                      <option value="1.5">1.5x (Fast)</option>
                      <option value="2">2.0x (Double Speed)</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Integrated Studio Enhancements */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">
                  {isAudio ? <Music size={18} /> : <Sliders size={18} />}
                  <span>{isAudio ? 'Audio Studio & Export Format' : 'Studio Enhancements'}</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {isAudio ? (
                  <>
                    {/* Audio Export Format */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">
                        <span>Export Audio Format</span>
                        <Music size={14} color="#e6b422" />
                      </label>
                      <select
                        className="form-select"
                        value={audioExportFormat}
                        onChange={(e) => setAudioExportFormat(e.target.value)}
                      >
                        <option value="original">Original Format ({(currentFile?.ext || 'Audio').toUpperCase()})</option>
                        <option value="mp3">MP3 (Universal 320 kbps)</option>
                        <option value="wav">WAV (Uncompressed Studio PCM)</option>
                        <option value="aac">AAC (M4A High Efficiency)</option>
                        <option value="flac">FLAC (Lossless Master)</option>
                        <option value="opus">OPUS (OGG Opus)</option>
                      </select>
                    </div>

                    {/* Audio Gain Boost */}
                    {!muteAudio && (
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
                    )}

                    {/* EBU R128 Loudness Normalization */}
                    {!muteAudio && (
                      <label className="toggle-wrapper">
                        <div
                          className={`toggle-switch ${loudnorm ? 'on' : ''}`}
                          onClick={() => setLoudnorm(!loudnorm)}
                        >
                          <div className="toggle-knob" />
                        </div>
                        <span style={{ fontSize: '13px' }}>
                          EBU R128 Broadcast Loudness Normalization (-16 LUFS)
                        </span>
                      </label>
                    )}
                  </>
                ) : (
                  <>
                    {/* Rotate & Flip with Reset button */}
                    <div className="form-group">
                      <label className="form-label">
                        <span>Rotate & Flip</span>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => {
                            setRotation('none');
                            onShowToast('Rotation reset to default (0°)', 'info');
                          }}
                          title="Reset rotation to default (0°)"
                          style={{ padding: '3px 8px', borderColor: 'rgba(230, 180, 34, 0.4)' }}
                        >
                          <RotateCw size={13} color="#e6b422" />
                        </button>
                      </label>
                      <select
                        className="form-select"
                        value={rotation}
                        onChange={(e) => setRotation(e.target.value)}
                      >
                        <option value="none">Normal (No Rotation)</option>
                        <option value="90cw">Rotate 90° Clockwise</option>
                        <option value="90ccw">Rotate 90° Counter-Clockwise</option>
                        <option value="180">Rotate 180° (Upside Down)</option>
                        <option value="hflip">Flip Horizontally (Mirror)</option>
                        <option value="vflip">Flip Vertically</option>
                      </select>
                    </div>

                    {/* Live Aspect Ratio / Canvas */}
                    <div className="grid-2">
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">
                          <span>Aspect Ratio</span>
                          <Crop size={14} color="#e6b422" />
                        </label>
                        <select
                          className="form-select"
                          value={aspectRatio}
                          onChange={(e) => setAspectRatio(e.target.value)}
                        >
                          <option value="original">Original Aspect</option>
                          <option value="9:16">9:16 (TikTok / Reels / Shorts)</option>
                          <option value="16:9">16:9 (Landscape YouTube)</option>
                          <option value="1:1">1:1 (Instagram Square)</option>
                          <option value="4:3">4:3 (Classic Retro)</option>
                        </select>
                      </div>

                      {aspectRatio !== 'original' && (
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Fit Mode</label>
                          <select
                            className="form-select"
                            value={canvasFit}
                            onChange={(e) => setCanvasFit(e.target.value)}
                          >
                            <option value="pad">Fit with Black Bars (Pad)</option>
                            <option value="crop">Fill & Center Crop</option>
                            <option value="stretch">Stretch to Fit</option>
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Audio Gain Boost */}
                    {!muteAudio && (
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
                    )}

                    {/* EBU R128 Loudness Normalization & GIF Export */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {!muteAudio && (
                        <label className="toggle-wrapper">
                          <div
                            className={`toggle-switch ${loudnorm ? 'on' : ''}`}
                            onClick={() => setLoudnorm(!loudnorm)}
                          >
                            <div className="toggle-knob" />
                          </div>
                          <span style={{ fontSize: '13px' }}>
                            EBU R128 Broadcast Loudness Normalization (-16 LUFS)
                          </span>
                        </label>
                      )}

                      <label className="toggle-wrapper">
                        <div
                          className={`toggle-switch ${exportAsGif ? 'on' : ''}`}
                          onClick={() => setExportAsGif(!exportAsGif)}
                        >
                          <div className="toggle-knob" />
                        </div>
                        <span style={{ fontSize: '13px' }}>
                          Export Trimmed Clip as High-Definition Animated GIF
                        </span>
                      </label>
                    </div>
                  </>
                )}

                {/* Output Folder */}
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
                    <button className="btn-secondary" onClick={handlePickOutputDir}>
                      <Folder size={15} />
                      <span>Browse</span>
                    </button>
                  </div>
                </div>

                <button
                  className="btn-gold"
                  style={{ width: '100%', padding: '12px', marginTop: '6px' }}
                  onClick={handleStartTrim}
                >
                  <Scissors size={16} />
                  <span>{isAudio ? 'Execute Audio Trim' : 'Execute Clip Trim'}</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
