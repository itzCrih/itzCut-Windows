import React from 'react';
import { Collapse } from './ui';

/** Speaker whose sound waves fade out and a red slash draws across it when muted. */
export function SpeakerIcon({ muted, size = 16 }) {
  return (
    <svg className={`speaker-icon ${muted ? 'muted' : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className="speaker-body" d="M11 5 6 9H3v6h3l5 4V5z" />
      <path className="speaker-wave wave-1" d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path className="speaker-wave wave-2" d="M18.5 5.5a9 9 0 0 1 0 13" />
      <line className="speaker-slash" x1="3" y1="3" x2="21" y2="21" pathLength="1" />
    </svg>
  );
}

/**
 * Audio gain slider with the mute switch built into its speaker icon. Muting collapses the slider
 * (and anything passed as `children`, e.g. bitrate or loudness options) since none of it applies.
 */
export default function AudioGainControl({ boostDb, onBoostChange, muted = false, onMutedChange, allowMute = true, max = 20, children }) {
  const isMuted = allowMute && muted;
  const valueLabel = boostDb > 0 ? `+${boostDb} dB` : 'Off';

  return (
    <div className={`gain-control ${isMuted ? 'is-muted' : ''}`}>
      <div className="gain-head">
        <span className="gain-title">
          <span className="gain-title-text">{isMuted ? 'Audio Muted' : 'Audio Gain Boost'}</span>
          {!isMuted && <span className={`value-chip ${boostDb > 0 ? 'accent' : ''}`}>{valueLabel}</span>}
          {isMuted && <span className="value-chip danger">No audio track</span>}
        </span>
        {allowMute && (
          <button
            type="button"
            className={`mute-btn ${isMuted ? 'muted' : ''}`}
            onClick={() => onMutedChange(!isMuted)}
            aria-pressed={isMuted}
            title={isMuted ? 'Unmute: keep the audio in the export' : 'Mute: remove the audio from the export'}
          >
            <SpeakerIcon muted={isMuted} />
          </button>
        )}
      </div>

      <Collapse open={!isMuted}>
        <div className="gain-body">
          <input
            type="range"
            className="range-slider"
            min="0"
            max={max}
            value={boostDb}
            onChange={(e) => onBoostChange(parseInt(e.target.value, 10))}
            aria-label="Audio gain boost in decibels"
            style={{ '--fill': `${(boostDb / max) * 100}%` }}
          />
          {children}
        </div>
      </Collapse>
    </div>
  );
}
