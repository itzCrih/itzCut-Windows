import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  RotateCcw,
  RotateCw,
  Scissors,
  Music,
  Radio,
  Sliders,
  FastForward,
  Rewind,
} from 'lucide-react';
import { formatTimecode, formatSeconds, formatBytes } from '../utils/formatters';

export default function AudioPreview({
  filePath,
  fileName,
  fileSize,
  duration = 0,
  trimStart = 0,
  trimEnd = 0,
  onSetTrimStart,
  onSetTrimEnd,
  isMuted = false,
  audioBoostDb = 0,
  speed = 1,
  mediaInfo = null,
}) {
  const audioRef = useRef(null);
  const trackRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [playerMuted, setPlayerMuted] = useState(false);
  const [audioDuration, setAudioDuration] = useState(duration);

  // Web Audio Gain Boost Nodes & Analyser for real-time visualization
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceNodeRef = useRef(null);

  // Dragging & Scrubbing states
  const [activeDrag, setActiveDrag] = useState(null);
  const wasPlayingBeforeDragRef = useRef(false);

  useEffect(() => {
    if (duration > 0) setAudioDuration(duration);
  }, [duration]);

  // Apply playback speed to audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed || 1;
    }
  }, [speed]);

  // Setup Web Audio API for Gain Boost and Waveform Visualizer
  const ensureAudioNodes = useCallback(() => {
    if (!audioRef.current) return;
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;

      if (!audioCtxRef.current) {
        const ctx = new AudioCtxClass();
        const source = ctx.createMediaElementSource(audioRef.current);
        const gainNode = ctx.createGain();
        const analyser = ctx.createAnalyser();

        analyser.fftSize = 128;
        source.connect(gainNode);
        gainNode.connect(analyser);
        analyser.connect(ctx.destination);

        audioCtxRef.current = ctx;
        gainNodeRef.current = gainNode;
        analyserRef.current = analyser;
        sourceNodeRef.current = source;
      }

      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    } catch (e) {
      // Audio source already connected or browser autoplay policy
    }
  }, []);

  // Update Gain node when audioBoostDb changes
  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      const multiplier = audioBoostDb > 0 ? Math.pow(10, audioBoostDb / 20) : 1.0;
      gainNodeRef.current.gain.setTargetAtTime(multiplier, audioCtxRef.current.currentTime, 0.05);
    }
  }, [audioBoostDb]);

  // Canvas Audio Visualizer Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let bars = 64;
    const dataArray = new Uint8Array(bars);

    const renderFrame = () => {
      animFrameRef.current = requestAnimationFrame(renderFrame);

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      if (analyserRef.current && isPlaying) {
        analyserRef.current.getByteFrequencyData(dataArray);
      } else {
        // Subtle resting idle waveform
        for (let i = 0; i < bars; i++) {
          dataArray[i] = Math.sin(i * 0.2 + Date.now() * 0.002) * 12 + 18;
        }
      }

      const barWidth = (width / bars) - 2;
      const centerY = height / 2;

      for (let i = 0; i < bars; i++) {
        const val = dataArray[i] / 255;
        const barHeight = Math.max(4, val * (height * 0.78));

        // Amber to purple neon gradient
        const gradient = ctx.createLinearGradient(0, centerY - barHeight / 2, 0, centerY + barHeight / 2);
        gradient.addColorStop(0, '#e6b422');
        gradient.addColorStop(0.5, '#f59e0b');
        gradient.addColorStop(1, '#a855f7');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        const x = i * (barWidth + 2);
        const y = centerY - barHeight / 2;
        const radius = Math.min(barWidth / 2, 3);
        ctx.roundRect(x, y, barWidth, barHeight, [radius, radius, radius, radius]);
        ctx.fill();
      }
    };

    renderFrame();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying]);

  // Play / Pause toggle
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    ensureAudioNodes();

    if (audio.paused || audio.ended) {
      const maxDur = audioDuration || duration || audio.duration || 0;
      if (maxDur > 0 && audio.currentTime >= maxDur - 0.08) {
        audio.currentTime = trimStart || 0;
      }

      audio.play().then(() => setIsPlaying(true)).catch((err) => {
        console.warn('Audio play error:', err);
      });
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [audioDuration, duration, trimStart, ensureAudioNodes]);

  // Seeking logic
  const seekTo = useCallback((sec) => {
    const maxDur = audioDuration || duration || 0;
    const safeSec = Math.max(0, Math.min(sec, maxDur));
    setCurrentTime(safeSec);
    if (audioRef.current) {
      audioRef.current.currentTime = safeSec;
    }
  }, [audioDuration, duration]);

  const stepTime = useCallback((seconds) => {
    seekTo(currentTime + seconds);
  }, [currentTime, seekTo]);

  // Keyboard Shortcuts (Space / K for Play/Pause, ArrowLeft / Right)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

      if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        stepTime(-1);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        stepTime(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, stepTime]);

  const getTimeFromEvent = useCallback((e) => {
    if (!trackRef.current || audioDuration <= 0) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return ratio * audioDuration;
  }, [audioDuration]);

  // Dragging event handlers for trim handles & playhead
  useEffect(() => {
    if (!activeDrag) return;

    const handleMouseMove = (e) => {
      const newTime = getTimeFromEvent(e);
      if (activeDrag === 'start' && onSetTrimStart) {
        const clamped = Math.max(0, Math.min(newTime, (trimEnd || audioDuration) - 0.1));
        onSetTrimStart(clamped);
        seekTo(clamped);
      } else if (activeDrag === 'end' && onSetTrimEnd) {
        const clamped = Math.max((trimStart || 0) + 0.1, Math.min(newTime, audioDuration));
        onSetTrimEnd(clamped);
        seekTo(clamped);
      } else if (activeDrag === 'playhead') {
        seekTo(newTime);
      }
    };

    const handleMouseUp = () => {
      if (activeDrag === 'playhead' && wasPlayingBeforeDragRef.current) {
        if (audioRef.current) {
          audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
        }
      }
      setActiveDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeDrag, getTimeFromEvent, audioDuration, trimStart, trimEnd, onSetTrimStart, onSetTrimEnd, seekTo]);

  const handleTrackClick = (e) => {
    if (activeDrag) return;
    const clickTime = getTimeFromEvent(e);
    seekTo(clickTime);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const dur = audioRef.current.duration;
      if (dur && !isNaN(dur) && dur > 0) {
        setAudioDuration(dur);
      }
    }
  };

  const safeAudioUrl = filePath ? `itzcut-media://local/${encodeURIComponent(filePath)}` : '';
  const effectiveDuration = audioDuration || duration || 1;
  const startPercent = Math.max(0, Math.min(100, (trimStart / effectiveDuration) * 100));
  const endPercent = trimEnd > 0 ? Math.max(0, Math.min(100, (trimEnd / effectiveDuration) * 100)) : 100;
  const playheadPercent = Math.max(0, Math.min(100, (currentTime / effectiveDuration) * 100));
  const rangeWidth = Math.max(0, endPercent - startPercent);

  // Metadata tags
  const audioCodec = (mediaInfo?.audio?.codec || filePath?.split('.').pop() || 'AUDIO').toUpperCase();
  const sampleRate = mediaInfo?.audio?.sampleRate ? `${mediaInfo.audio.sampleRate} Hz` : 'Standard';
  const channels = mediaInfo?.audio?.channels === 1 ? 'Mono (1.0)' : 'Stereo (2.0)';
  const bitRateKbps = mediaInfo?.audio?.bitRate ? `${Math.round(mediaInfo.audio.bitRate / 1000)} kbps` : null;

  return (
    <div className="player-container audio-preview-container">
      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        src={safeAudioUrl}
        crossOrigin="anonymous"
        onTimeUpdate={() => {
          if (!activeDrag && audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => {
          setIsPlaying(true);
          ensureAudioNodes();
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          if (audioRef.current) audioRef.current.currentTime = trimStart || 0;
        }}
        muted={playerMuted || isMuted}
      />

      {/* Modern Audio Player Card */}
      <div className="audio-player-hero-card">
        {/* Animated Disc / Vinyl Glowing Icon */}
        <div className={`audio-disc-wrap ${isPlaying ? 'spinning' : ''}`}>
          <div className="audio-disc-inner">
            <Radio size={28} className="audio-disc-icon" />
          </div>
        </div>

        {/* Audio Track Info & Codec Badges */}
        <div className="audio-hero-meta">
          <div className="audio-hero-title" title={fileName || filePath}>
            {fileName || (filePath ? filePath.split(/[\/\\]/).pop() : 'Audio Track')}
          </div>
          <div className="audio-badges-row">
            <span className="badge-pill active">{audioCodec}</span>
            <span className="badge-pill">{sampleRate}</span>
            <span className="badge-pill">{channels}</span>
            {bitRateKbps && <span className="badge-pill">{bitRateKbps}</span>}
            {fileSize > 0 && <span className="badge-pill">{formatBytes(fileSize)}</span>}
            {audioBoostDb > 0 && (
              <span className="badge-pill boost-active">
                Boost +{audioBoostDb}dB
              </span>
            )}
          </div>
        </div>

        {/* Real-time Frequency Waveform Visualizer */}
        <div className="audio-waveform-visualizer">
          <canvas
            ref={canvasRef}
            width={380}
            height={60}
            className="audio-canvas"
          />
        </div>
      </div>

      {/* Sleek Scrubber & Precision Cutting Timeline */}
      <div className="player-scrubber-container">
        {/* Timeline Track with In/Out Cut Range */}
        <div
          className="timeline-track-wrap"
          ref={trackRef}
          onClick={handleTrackClick}
          title="Click to seek | Drag handles to set cut points"
        >
          {/* Highlighted Cut Range */}
          <div
            className="timeline-cut-range"
            style={{
              left: `${startPercent}%`,
              width: `${rangeWidth}%`,
            }}
          />

          {/* Draggable Cut Start Handle (Handle 1 / In) */}
          {onSetTrimStart && (
            <div
              className="timeline-handle-start"
              style={{ left: `${startPercent}%` }}
              onMouseDown={(e) => {
                e.stopPropagation();
                setActiveDrag('start');
              }}
              title="Drag to adjust Cut Start [ In ]"
            >
              <div className="handle-grip-icon" />
            </div>
          )}

          {/* Draggable Cut End Handle (Handle 2 / Out) */}
          {onSetTrimEnd && (
            <div
              className="timeline-handle-end"
              style={{ left: `${endPercent}%` }}
              onMouseDown={(e) => {
                e.stopPropagation();
                setActiveDrag('end');
              }}
              title="Drag to adjust Cut End [ Out ]"
            >
              <div className="handle-grip-icon" />
            </div>
          )}

          {/* Draggable Playhead Needle */}
          <div
            className="timeline-playhead-needle"
            style={{ left: `${playheadPercent}%` }}
          />

          {/* Draggable Scrubber Arrow */}
          <div
            className="timeline-playhead-arrow"
            style={{ left: `${playheadPercent}%` }}
            onMouseDown={(e) => {
              e.stopPropagation();
              wasPlayingBeforeDragRef.current = isPlaying;
              if (audioRef.current && !audioRef.current.paused) {
                audioRef.current.pause();
              }
              setActiveDrag('playhead');
            }}
            title="Drag to scrub audio"
          >
            <div className="arrow-head" />
          </div>
        </div>

        {/* Player Controls Bar */}
        <div className="player-controls-bar">
          <div className="player-btns-left">
            {/* Step -1s */}
            <button
              className="icon-btn"
              onClick={() => stepTime(-1)}
              title="Step back 1 second (ArrowLeft)"
            >
              <Rewind size={14} />
            </button>

            {/* Play / Pause Button */}
            <button
              className="icon-btn play-circle"
              onClick={togglePlay}
              title={isPlaying ? 'Pause (Space / K)' : 'Play (Space / K)'}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: '2px' }} />}
            </button>

            {/* Step +1s */}
            <button
              className="icon-btn"
              onClick={() => stepTime(1)}
              title="Step forward 1 second (ArrowRight)"
            >
              <FastForward size={14} />
            </button>

            {/* Volume Slider & Mute */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginLeft: '6px' }}>
              <button
                className="icon-btn"
                onClick={() => {
                  const newMuted = !playerMuted;
                  setPlayerMuted(newMuted);
                  if (audioRef.current) audioRef.current.muted = newMuted || isMuted;
                }}
                title={playerMuted ? 'Unmute' : 'Mute'}
              >
                {playerMuted || isMuted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={playerMuted ? 0 : volume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setVolume(val);
                  setPlayerMuted(false);
                  if (audioRef.current) {
                    audioRef.current.volume = val;
                    audioRef.current.muted = false;
                  }
                }}
                className="volume-slider"
                title={`Volume: ${Math.round(volume * 100)}%`}
              />
            </div>
          </div>

          {/* Timecodes Display */}
          <div className="player-timecodes">
            <span className="current-tc">{formatTimecode(currentTime)}</span>
            <span className="tc-slash">/</span>
            <span className="total-tc">{formatTimecode(effectiveDuration)}</span>
          </div>

          <div className="player-btns-right">
            {/* Quick Set Trim Points Buttons */}
            {onSetTrimStart && (
              <button
                className="btn-tiny"
                onClick={() => onSetTrimStart(currentTime)}
                title="Set Cut Start at playhead"
              >
                <Scissors size={11} style={{ transform: 'rotate(90deg)' }} />
                <span>Mark In</span>
              </button>
            )}

            {onSetTrimEnd && (
              <button
                className="btn-tiny"
                onClick={() => onSetTrimEnd(currentTime)}
                title="Set Cut End at playhead"
              >
                <Scissors size={11} />
                <span>Mark Out</span>
              </button>
            )}

            {/* Selected Duration Badge */}
            <div className="clip-length-pill" title="Duration of selected cut">
              <span>Cut:</span>
              <strong style={{ color: 'var(--accent-primary)', marginLeft: '4px' }}>
                {formatSeconds(Math.max(0, (trimEnd || effectiveDuration) - trimStart))}
              </strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
