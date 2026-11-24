import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

const OPTION_HEIGHT = 34;
const MENU_MAX_HEIGHT = 288;

/**
 * Styled dropdown replacing the native <select>: each option shows a label and a dimmed hint
 * (e.g. "Full HD · 1920×1080"), opens above the field when there is no room below, and supports
 * the keyboard (arrows, Home/End, Enter, Escape).
 */
export default function Select({ value, onChange, options, disabled = false, placeholder = 'Select…', title, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [placement, setPlacement] = useState('down');
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const selectedIndex = options.findIndex((opt) => opt.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onScroll = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpen(false);
    };
    const onBlur = () => setOpen(false);
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);

  // Keep the highlighted option visible while navigating with the keyboard.
  useEffect(() => {
    if (!open || highlight < 0 || !menuRef.current) return;
    const item = menuRef.current.children[highlight];
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [open, highlight]);

  const openMenu = () => {
    if (disabled) return;
    const rect = rootRef.current.getBoundingClientRect();
    const menuHeight = Math.min(options.length * OPTION_HEIGHT + 10, MENU_MAX_HEIGHT);
    const spaceBelow = window.innerHeight - rect.bottom - 40; // footer bar
    setPlacement(spaceBelow < menuHeight && rect.top > spaceBelow ? 'up' : 'down');
    setHighlight(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const choose = (opt) => {
    if (opt.disabled) return;
    setOpen(false);
    if (opt.value !== value) onChange(opt.value);
  };

  const move = (delta) => {
    if (!open) {
      openMenu();
      return;
    }
    let next = highlight;
    for (let i = 0; i < options.length; i += 1) {
      next = (next + delta + options.length) % options.length;
      if (!options[next].disabled) break;
    }
    setHighlight(next);
  };

  const onKeyDown = (event) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        if (open) {
          event.preventDefault();
          setHighlight(0);
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setHighlight(options.length - 1);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open && options[highlight]) choose(options[highlight]);
        else openMenu();
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
    }
  };

  return (
    <div className={`select ${open ? 'open' : ''} ${disabled ? 'disabled' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        title={title}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">
          {selected ? (
            <>
              <span className="select-label">{selected.label}</span>
              {selected.hint && <span className="select-hint">{selected.hint}</span>}
            </>
          ) : (
            <span className="select-placeholder">{placeholder}</span>
          )}
        </span>
        <ChevronDown size={15} className="select-chevron" />
      </button>

      <div className={`select-menu ${placement}`} role="listbox" ref={menuRef} style={{ maxHeight: MENU_MAX_HEIGHT }}>
        {options.map((opt, index) => {
          const isSelected = opt.value === value;
          return (
            <div
              key={String(opt.value)}
              role="option"
              aria-selected={isSelected}
              aria-disabled={opt.disabled || undefined}
              className={`select-option ${isSelected ? 'selected' : ''} ${index === highlight ? 'highlight' : ''} ${opt.disabled ? 'disabled' : ''}`}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(opt)}
            >
              <span className="select-option-label">{opt.label}</span>
              {opt.hint && <span className="select-hint">{opt.hint}</span>}
              <Check size={13} className="select-check" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
