import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * Segmented control with a sliding selection pill. `variant="tabs"` is the large version used to
 * switch between workflows.
 */
export function Segmented({ options, value, onChange, size = 'md', variant = 'default', stretch = true, disabled = false, ariaLabel, className = '' }) {
  const containerRef = useRef(null);
  const measuredRef = useRef(false);
  const [indicator, setIndicator] = useState(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const update = () => {
      const active = el.querySelector('[data-active="true"]');
      setIndicator(active ? { left: active.offsetLeft, width: active.offsetWidth, animate: measuredRef.current } : null);
      if (active) measuredRef.current = true;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, options.length]);

  return (
    <div
      ref={containerRef}
      className={`seg seg-${size} seg-${variant} ${stretch ? 'seg-stretch' : ''} ${disabled ? 'seg-disabled' : ''} ${className}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {indicator && (
        <span
          className={`seg-indicator ${indicator.animate ? 'animate' : ''}`}
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
          aria-hidden="true"
        />
      )}
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active}
            className={`seg-btn ${active ? 'active' : ''}`}
            disabled={disabled || opt.disabled}
            title={opt.title}
            onClick={() => {
              if (!active) onChange(opt.value);
            }}
          >
            {Icon && <Icon size={variant === 'tabs' ? 15 : 13} />}
            {opt.label !== undefined && <span>{opt.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Animated height reveal. Content stays mounted so its state survives collapsing. */
export function Collapse({ open, children, className = '' }) {
  const [settled, setSettled] = useState(open);
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    setSettled(false);
  }

  return (
    <div
      className={`collapse ${open ? 'open' : ''} ${settled && open ? 'settled' : ''} ${className}`}
      aria-hidden={!open}
      inert={open ? undefined : ''}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows') setSettled(true);
      }}
    >
      <div className="collapse-inner">{children}</div>
    </div>
  );
}

/** Switch with a label; the whole row is the hit target. */
export function Toggle({ checked, onChange, label, description, icon: Icon, disabled = false, title, compact = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle-row ${compact ? 'compact' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={() => onChange(!checked)}
      title={title}
      aria-disabled={disabled}
    >
      <span className={`toggle-switch ${checked ? 'on' : ''}`}>
        <span className="toggle-knob" />
      </span>
      <span className="toggle-text">
        <span className="toggle-label">
          {Icon && <Icon size={14} className={checked ? 'icon-accent' : 'icon-muted'} />}
          <span>{label}</span>
        </span>
        {description && <span className="toggle-desc">{description}</span>}
      </span>
    </button>
  );
}

/** Small section heading inside a card. */
export function SectionLabel({ icon: Icon, children, right }) {
  return (
    <div className="section-label">
      <span className="section-label-text">
        {Icon && <Icon size={13} />}
        <span>{children}</span>
      </span>
      {right}
    </div>
  );
}
