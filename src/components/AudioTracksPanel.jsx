import React from 'react';
import { AudioLines } from 'lucide-react';
import { Segmented } from './ui';
import { SpeakerIcon } from './AudioGainControl';

const MODES = [
  { value: 'keep', label: 'Keep separate', title: 'Each enabled track stays its own track in the export' },
  { value: 'merge', label: 'Merge into one', title: 'Enabled tracks are mixed down into a single track' },
];

function describeTrack(track) {
  const parts = [];
  if (track.codec) parts.push(track.codec.toUpperCase());
  if (track.channelLayout) parts.push(track.channelLayout);
  else if (track.channels) parts.push(track.channels === 1 ? 'mono' : track.channels === 2 ? 'stereo' : `${track.channels} ch`);
  if (track.sampleRate) parts.push(`${Math.round(track.sampleRate / 100) / 10} kHz`);
  if (track.language) parts.push(track.language.toUpperCase());
  return parts.join(' · ');
}

/**
 * Every audio track of a multi-track recording as a lane under the player: switch tracks on or
 * off, and export them separately or mixed into one. The lanes mirror the cut range.
 */
export default function AudioTracksPanel({ tracks, included, onToggleTrack, mode, onModeChange, disabled = false, duration = 0, start = 0, end = 0 }) {
  const enabledCount = tracks.filter((t) => included.includes(t.order)).length;
  const left = duration > 0 ? (start / duration) * 100 : 0;
  const width = duration > 0 ? Math.max(0, ((end || duration) - start) / duration) * 100 : 100;

  let summary;
  if (disabled) summary = 'Audio is muted for this export.';
  else if (enabledCount === 0) summary = 'No track enabled: the export will be silent.';
  else if (mode === 'merge' && enabledCount > 1) summary = `${enabledCount} tracks mixed into one.`;
  else summary = `${enabledCount} of ${tracks.length} tracks exported${enabledCount > 1 ? ' as separate tracks' : ''}.`;

  return (
    <div className={`card tracks-card ${disabled ? 'is-disabled' : ''}`}>
      <div className="card-header compact">
        <div className="card-title">
          <AudioLines size={18} />
          <span>Audio Tracks</span>
          <span className="value-chip">{tracks.length}</span>
        </div>
        <Segmented size="sm" stretch={false} options={MODES} value={mode} onChange={onModeChange} disabled={disabled} ariaLabel="Track export mode" />
      </div>

      <div className="track-lanes">
        {tracks.map((track) => {
          const on = included.includes(track.order);
          return (
            <div key={track.order} className={`track-lane ${on ? 'on' : 'off'}`}>
              <span className="track-id">A{track.order + 1}</span>
              <div className="track-info">
                <span className="track-name" title={track.title || `Track ${track.order + 1}`}>
                  {track.title || `Track ${track.order + 1}`}
                  {track.isDefault && <span className="track-default">default</span>}
                </span>
                <span className="track-meta">{describeTrack(track)}</span>
              </div>
              <div className="track-bar" aria-hidden="true">
                <span className="track-bar-range" style={{ left: `${left}%`, width: `${width}%` }} />
              </div>
              <button
                type="button"
                className={`mute-btn small ${on ? '' : 'muted'}`}
                onClick={() => onToggleTrack(track.order)}
                disabled={disabled}
                aria-pressed={!on}
                title={on ? `Mute track ${track.order + 1}` : `Unmute track ${track.order + 1}`}
              >
                <SpeakerIcon muted={!on} size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="tracks-summary">{summary}</div>
    </div>
  );
}
