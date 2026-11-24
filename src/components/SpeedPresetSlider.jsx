import React from 'react';
import { SPEED_PRESETS, isPowerfulMachine } from '../utils/presets';

/** x264 speed preset as a stepped slider; "slower" only appears on high-end machines. */
export default function SpeedPresetSlider({ value, onChange, systemInfo, disabled = false }) {
  const presets = isPowerfulMachine(systemInfo) ? SPEED_PRESETS : SPEED_PRESETS.filter((p) => p !== 'slower');
  const index = Math.max(0, presets.indexOf(value) >= 0 ? presets.indexOf(value) : presets.indexOf('medium'));
  const max = presets.length - 1;

  return (
    <div className={`speed-slider ${disabled ? 'disabled' : ''}`}>
      <div className="form-label">
        <span>Encoding Speed</span>
        <span className="value-chip accent mono">{presets[index]}</span>
      </div>
      <input
        type="range"
        className="range-slider stepped"
        min="0"
        max={max}
        step="1"
        value={index}
        disabled={disabled}
        onChange={(e) => onChange(presets[parseInt(e.target.value, 10)])}
        aria-label="Encoding speed preset"
        aria-valuetext={presets[index]}
        style={{ '--fill': `${(index / max) * 100}%` }}
      />
      {/* Labels sit under the thumb positions (the thumb centre travels 9px inside each edge). */}
      <div className="speed-ticks">
        {presets.map((preset, i) => (
          <button
            key={preset}
            type="button"
            className={`speed-tick ${i === index ? 'active' : ''} ${i === 0 ? 'first' : ''} ${i === max ? 'last' : ''}`}
            style={{ left: `calc(9px + (100% - 18px) * ${i / max})` }}
            onClick={() => onChange(preset)}
            disabled={disabled}
          >
            {preset}
          </button>
        ))}
      </div>
      <div className="speed-scale">
        <span>Faster encode</span>
        <span>Smaller file</span>
      </div>
    </div>
  );
}
