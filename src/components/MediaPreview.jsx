import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  RotateCcw,
  RotateCw,
  Scissors,
  RefreshCw,
} from 'lucide-react';
import { formatTimecode, formatSeconds } from '../utils/formatters';

let hevcSupport = null;
/** Whether this Chromium build can decode HEVC (hardware decoder + Windows HEVC extension). */
function canPlayHevc() {
  if (hevcSupport === null) {
    try {
      hevcSupport = document.createElement('video').canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== '';
    } catch {
      hevcSupport = false;
    }
  }
  return hevcSupport;
}

export default function MediaPreview({
  filePath,
  duration = 0,
  trimStart = 0,
  trimEnd = 0,
  onSetTrimStart,
  onSetTrimEnd,
  isMuted = false,
  rotation = 'none', // 'none', '90cw', '90ccw', '180', 'hflip', 'vflip'
  aspectRatio = 'original', // 'original', '16:9', '9:16', '1:1', '4:3'
  canvasFit = 'pad', // 'pad', 'crop', 'stretch'
  audioBoostDb = 0, // In preview
  speed = 1, // Playback rate in preview
  mediaInfo = null,
}) {
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [playerMuted, setPlayerMuted] = useState(false);
  const [videoDuration, setVideoDuration] = useState(duration);
  const [naturalDimensions, setNaturalDimensions] = useState({ width: 1920, height: 1080 });

  // Proxy state for ProRes, PCM, HEVC, and non-native web video containers
  const [proxyPath, setProxyPath] = useState(null);
  const [isGeneratingProxy, setIsGeneratingProxy] = useState(false);
  const [proxyError, setProxyError] = useState(null);

  // Web Audio Gain Boost Nodes for live audio preview
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);

  // Dragging & Smooth Scrubbing states
  const [activeDrag, setActiveDrag] = useState(null);
  const wasPlayingBeforeDragRef = useRef(false);
  const rafSeekRef = useRef(null);

  // Size of the preview frame, needed to lay out a rotated video.
  const frameRef = useRef(null);
  const [frameSize, setFrameSize] = useState(null);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => setFrameSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const currentFileRef = useRef(filePath);
  currentFileRef.current = filePath;

  // Reset proxy state on file change. Leaving a file (or the Trimmer) stops its proxy encode:
  // otherwise a multi-hour source keeps FFmpeg busy in the background for nothing.
  useEffect(() => {
    setProxyPath(null);
    setIsGeneratingProxy(false);
    setProxyError(null);
    return () => {
      if (filePath) window.itzCutAPI?.cancelPreviewProxy?.(filePath);
    };
  }, [filePath]);

  // Request high-speed preview proxy when needed
  const requestProxy = useCallback(async () => {
    if (!filePath || isGeneratingProxy || proxyPath) return;
    if (!window.itzCutAPI?.getPreviewProxy) return;

    setIsGeneratingProxy(true);
    setProxyError(null);
    try {
      const pPath = await window.itzCutAPI.getPreviewProxy(filePath);
      if (pPath && currentFileRef.current === filePath) setProxyPath(pPath);
    } catch (err) {
      if (currentFileRef.current === filePath && !/canceled/i.test(err.message)) {
        console.warn('Failed to generate preview proxy:', err);
        setProxyError(err.message);
      }
    } finally {
      if (currentFileRef.current === filePath) setIsGeneratingProxy(false);
    }
  }, [filePath, isGeneratingProxy, proxyPath]);

  // Auto-trigger the proxy when the container / codec cannot play natively. HEVC is tried
  // natively first: Chromium decodes it on the GPU when Windows has the HEVC extension.
  useEffect(() => {
    if (proxyPath || isGeneratingProxy || proxyError || !mediaInfo) return;
    const hevcUnsupported = mediaInfo.video?.codec === 'hevc' && !canPlayHevc();
    if (mediaInfo.needsPreviewProxy || hevcUnsupported) requestProxy();
  }, [mediaInfo, proxyPath, isGeneratingProxy, proxyError, requestProxy]);


  useEffect(() => {
    if (duration > 0) setVideoDuration(duration);
  }, [duration]);

  // Apply playback speed to video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed || 1;
    }
  }, [speed]);

  // Setup Web Audio API for Live Audio Gain Boost in preview
  const ensureAudioNodes = useCallback(() => {
    if (!videoRef.current) return;
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;

      if (!audioCtxRef.current) {
        const ctx = new AudioCtxClass();
        const source = ctx.createMediaElementSource(videoRef.current);
        const gainNode = ctx.createGain();

        source.connect(gainNode);
        gainNode.connect(ctx.destination);

        audioCtxRef.current = ctx;
        gainNodeRef.current = gainNode;
        sourceNodeRef.current = source;
      }

      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    } catch (e) {
      // Audio node already attached or browser policy
    }
  }, []);

  // Update Gain node when audioBoostDb changes
  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      const multiplier = audioBoostDb > 0 ? Math.pow(10, audioBoostDb / 20) : 1.0;
      gainNodeRef.current.gain.setTargetAtTime(multiplier, audioCtxRef.current.currentTime, 0.05);
    }
  }, [audioBoostDb]);

  // Robust play / pause toggle that never freezes
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    ensureAudioNodes();

    if (video.paused || video.ended) {
      const maxDuration = videoDuration || duration || video.duration || 0;
      if (maxDuration > 0 && video.currentTime >= maxDuration - 0.08) {
        video.currentTime = trimStart || 0;
      }

      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
          })
          .catch((err) => {
            console.warn('Playback resume caught:', err);
            video.currentTime = trimStart || 0;
            video.play().catch(() => {});
          });
      }
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [videoDuration, duration, trimStart, ensureAudioNodes]);

  // Non-blocking seek synchronization to avoid decoder pipeline stalls and eliminate scrub lag
  const isSeekingRef = useRef(false);
  const pendingSeekTimeRef = useRef(null);
  const lastDispatchedSeekRef = useRef(0);

  const logPlayerDebug = useCallback((message, details = null) => {
    if (window.itzCutAPI?.writeDebugLog) {
      window.itzCutAPI.writeDebugLog('PLAYER', message, details);
    }
  }, []);

  const dispatchVideoSeek = useCallback((targetSec) => {
    const v = videoRef.current;
    if (!v) return;

    if (isSeekingRef.current) {
      // Decoder busy with previous frame: queue latest target without stalling main thread
      pendingSeekTimeRef.current = targetSec;
      return;
    }

    isSeekingRef.current = true;
    lastDispatchedSeekRef.current = targetSec;
    v.currentTime = targetSec;
  }, []);

  const handleSeeked = useCallback(() => {
    isSeekingRef.current = false;
    if (pendingSeekTimeRef.current !== null) {
      const nextTime = pendingSeekTimeRef.current;
      pendingSeekTimeRef.current = null;
      if (Math.abs(nextTime - lastDispatchedSeekRef.current) > 0.015) {
        dispatchVideoSeek(nextTime);
      }
    }
  }, [dispatchVideoSeek]);

  // Smooth, Instant 60fps seek without blocking decoder queues
  const smoothSeek = useCallback((sec) => {
    const safeSec = Math.max(0, Math.min(sec, videoDuration || duration));
    setCurrentTime(safeSec);
    dispatchVideoSeek(safeSec);
  }, [videoDuration, duration, dispatchVideoSeek]);

  const stepFrame = useCallback((frames) => {
    const fps = mediaInfo?.video?.fps > 0 ? mediaInfo.video.fps : 30;
    smoothSeek(currentTime + frames / fps);
  }, [currentTime, smoothSeek, mediaInfo]);

  // Keyboard Shortcuts (Space / K for Play/Pause, ArrowLeft / ArrowRight for 1 Frame)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

      if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        stepFrame(-1);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        stepFrame(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, stepFrame]);

  // Calculate time from clientX on track
  const getTimeFromEvent = useCallback((e) => {
    if (!trackRef.current || videoDuration <= 0) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return ratio * videoDuration;
  }, [videoDuration]);

  // Dragging logic for Playhead, In, and Out handles
  useEffect(() => {
    if (!activeDrag) return;

    const handleMouseMove = (e) => {
      const time = getTimeFromEvent(e);
      if (activeDrag === 'playhead') {
        smoothSeek(time);
      } else if (activeDrag === 'start') {
        const safeStart = Math.min(time, trimEnd > 0 ? trimEnd - 0.05 : videoDuration);
        if (onSetTrimStart) onSetTrimStart(Math.max(0, safeStart));
      } else if (activeDrag === 'end') {
        const safeEnd = Math.max(time, trimStart + 0.05);
        if (onSetTrimEnd) onSetTrimEnd(Math.min(videoDuration, safeEnd));
      }
    };

    const handleMouseUp = () => {
      logPlayerDebug('Timeline scrub finished', { finalTime: currentTime });
      setActiveDrag(null);
      isSeekingRef.current = false;
      pendingSeekTimeRef.current = null;
      if (videoRef.current) {
        videoRef.current.currentTime = currentTime;
      }
      if (wasPlayingBeforeDragRef.current && videoRef.current) {
        videoRef.current.play().catch(() => {});
        wasPlayingBeforeDragRef.current = false;
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeDrag, getTimeFromEvent, smoothSeek, currentTime, trimStart, trimEnd, videoDuration, onSetTrimStart, onSetTrimEnd, logPlayerDebug]);

  const handleTrackClick = (e) => {
    if (activeDrag) return;
    const time = getTimeFromEvent(e);
    smoothSeek(time);
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const v = videoRef.current;
      const dur = v.duration || duration;
      setVideoDuration(dur);
      if (v.videoWidth && v.videoHeight) {
        setNaturalDimensions({ width: v.videoWidth, height: v.videoHeight });
      }
      logPlayerDebug('Metadata loaded', {
        duration: dur,
        width: v.videoWidth,
        height: v.videoHeight,
        file: filePath,
      });
    }
  };

  const playheadPercent = videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0;
  const startPercent = videoDuration > 0 ? (trimStart / videoDuration) * 100 : 0;
  const endPercent = videoDuration > 0 && trimEnd > 0 ? (trimEnd / videoDuration) * 100 : 100;
  const rangeWidth = Math.max(0, endPercent - startPercent);

  // Compute live visual rotation transform
  let transformStyle = '';
  if (rotation === '90cw') transformStyle = 'rotate(90deg)';
  else if (rotation === '90ccw') transformStyle = 'rotate(-90deg)';
  else if (rotation === '180') transformStyle = 'rotate(180deg)';
  else if (rotation === 'hflip') transformStyle = 'scaleX(-1)';
  else if (rotation === 'vflip') transformStyle = 'scaleY(-1)';

  // Compute live video object-fit based on canvasFit ('pad' = contain, 'crop' = cover, 'stretch' = fill)
  let videoObjectFit = 'contain';
  if (canvasFit === 'crop') videoObjectFit = 'cover';
  else if (canvasFit === 'stretch') videoObjectFit = 'fill';
  else videoObjectFit = 'contain'; // 'pad'

  // Dimensions
  const isRotated90 = rotation === '90cw' || rotation === '90ccw';
  const effectiveWidth = isRotated90 ? naturalDimensions.height : naturalDimensions.width;
  const effectiveHeight = isRotated90 ? naturalDimensions.width : naturalDimensions.height;

  // The frame gets an explicit height so its width follows from the aspect ratio (the video inside
  // may be absolutely positioned and cannot size it).
  const frameHeight = 'min(480px, 56vh)';
  const ratios = { '9:16': '9 / 16', '1:1': '1 / 1', '4:3': '4 / 3' };
  let containerAspectStyle;
  if (aspectRatio === '16:9') {
    containerAspectStyle = { aspectRatio: '16 / 9', maxHeight: frameHeight, width: '100%' };
  } else {
    containerAspectStyle = {
      aspectRatio: ratios[aspectRatio] || `${effectiveWidth} / ${effectiveHeight}`,
      height: frameHeight,
      maxWidth: '100%',
    };
  }

  // A 90° turn swaps the picture's footprint: the video element is laid out with the frame's
  // height as its width (and vice versa) and then rotated, so it fills the frame exactly.
  let videoLayout = { width: '100%', height: '100%', transform: transformStyle };
  if (isRotated90 && frameSize) {
    videoLayout = {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: frameSize.height,
      height: frameSize.width,
      maxWidth: 'none',
      maxHeight: 'none',
      transform: `translate(-50%, -50%) ${transformStyle}`,
    };
  }

  // Use fast preview proxy path if generated, otherwise direct file path
  const effectivePreviewPath = proxyPath || filePath;
  const safeVideoUrl = effectivePreviewPath ? `itzcut-media://local/${encodeURIComponent(effectivePreviewPath)}` : '';

  return (
    <div className="player-container">
      {/* Live Video Preview Box: clean, uncluttered, with full breathing room */}
      <div className="player-video-box">
        <div
          ref={frameRef}
          style={{
            ...containerAspectStyle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            background: '#000000',
            border: aspectRatio !== 'original' ? '1px dashed rgba(var(--accent-rgb), 0.5)' : 'none',
            borderRadius: '4px',
            position: 'relative',
          }}
        >
          {isGeneratingProxy && (
            <div className="preview-loading-overlay">
              <RefreshCw size={28} className="spin" style={{ color: 'var(--gold-primary)' }} />
              <div style={{ fontWeight: 600, fontSize: '13.5px' }}>Preparing a smooth preview…</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: 360, textAlign: 'center' }}>
                This format cannot play directly, so a lightweight preview copy is being made. Exports never wait for it, and it stops when you leave the file.
              </div>
            </div>
          )}
          {!isGeneratingProxy && proxyError && (
            <div className="preview-loading-overlay">
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-error)' }}>Preview unavailable</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: 360, textAlign: 'center' }}>
                Cut points can still be typed in, and the export works normally.
              </div>
            </div>
          )}

          <video
            ref={videoRef}
            src={safeVideoUrl}
            style={{
              ...videoLayout,
              objectFit: videoObjectFit,
              transition: 'transform 0.15s ease',
              display: 'block',
            }}
            crossOrigin="anonymous"
            playsInline
            disableRemotePlayback
            onTimeUpdate={() => {
              if (!activeDrag && videoRef.current) {
                setCurrentTime(videoRef.current.currentTime);
              }
            }}
            onSeeked={handleSeeked}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => {
              setIsPlaying(true);
              ensureAudioNodes();
              logPlayerDebug('Playback started', { time: videoRef.current?.currentTime, rate: videoRef.current?.playbackRate });
            }}
            onPause={() => {
              setIsPlaying(false);
              logPlayerDebug('Playback paused', { time: videoRef.current?.currentTime });
            }}
            onError={(e) => {
              logPlayerDebug('Video error occurred', {
                error: videoRef.current?.error?.message || videoRef.current?.error?.code,
                src: safeVideoUrl,
              });
              if (!proxyPath && !isGeneratingProxy) {
                requestProxy();
              }
            }}
            onEnded={() => {
              setIsPlaying(false);
              if (videoRef.current) videoRef.current.currentTime = trimStart || 0;
            }}
            onClick={togglePlay}
            muted={playerMuted || isMuted}
          />
        </div>
      </div>

      {/* Sleek, Low-Profile Scrubber Toolbar below video without covering it */}
      <div className="player-scrubber-container">
        {/* Slim Modern Timeline Track */}
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
              if (videoRef.current && !videoRef.current.paused) {
                videoRef.current.pause();
              }
              setActiveDrag('playhead');
            }}
            title="Drag to scrub video"
          >
            <div className="arrow-head" />
          </div>
        </div>

        {/* Player Controls Bar */}
        <div className="player-controls-bar">
          <div className="player-btns-left">
            {/* Play / Pause Button */}
            <button
              className="icon-btn play-circle"
              onClick={togglePlay}
              title={isPlaying ? 'Pause (Space / K)' : 'Play (Space / K)'}
            >
              {isPlaying ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: '2px' }} />}
            </button>

            {/* Audio Volume Slider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginLeft: '4px' }}>
              <button
                className="icon-btn"
                onClick={() => setPlayerMuted(!playerMuted)}
                title={playerMuted ? 'Unmute Player' : 'Mute Player'}
                style={{ padding: '5px 7px' }}
              >
                {playerMuted || isMuted ? <VolumeX size={14} color="#f85149" /> : <Volume2 size={14} />}
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
                  if (videoRef.current) videoRef.current.volume = val;
                  if (val > 0) setPlayerMuted(false);
                }}
                style={{ width: '64px' }}
                title="Preview Volume"
              />
            </div>

            {/* Skip Buttons: -5s and +5s */}
            <button
              className="icon-btn"
              onClick={() => smoothSeek(currentTime - 5)}
              title="Rewind 5 seconds"
              style={{ marginLeft: '4px' }}
            >
              <RotateCcw size={12} />
              <span>-5s</span>
            </button>

            <button
              className="icon-btn"
              onClick={() => smoothSeek(currentTime + 5)}
              title="Forward 5 seconds"
            >
              <RotateCw size={12} />
              <span>+5s</span>
            </button>

            {/* Timestamp HUD */}
            <div className="timestamp-hud">
              <span className="current">{formatTimecode(currentTime)}</span>
              <span>/</span>
              <span>{formatSeconds(videoDuration)}</span>
            </div>
          </div>

          <div className="player-btns-right">
            {/* Hotkeys reminder pills */}
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginRight: '4px' }}>
              <span className="kbd-pill" title="Press Space or K to toggle Play/Pause">Space / K</span>
              <span className="kbd-pill" title="Press Left / Right arrows to step 1 frame">← / → 1 Fr</span>
            </div>

            {onSetTrimStart && (
              <button
                className="btn-gold"
                style={{ padding: '5px 10px', fontSize: '11.5px' }}
                onClick={() => onSetTrimStart(currentTime)}
                title="Set current position as Cut Start"
              >
                <Scissors size={12} />
                <span>Set [ In ]</span>
              </button>
            )}

            {onSetTrimEnd && (
              <button
                className="btn-gold"
                style={{ padding: '5px 10px', fontSize: '11.5px' }}
                onClick={() => onSetTrimEnd(currentTime)}
                title="Set current position as Cut End"
              >
                <Scissors size={12} />
                <span>Set [ Out ]</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
