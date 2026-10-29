import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { THEME_LABELS, THEME_ORDER, THEME_PREVIEW, useTheme } from '../lib/theme';

const PaletteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a7 7 0 0 0 0 14 4 4 0 0 1 0 8 10 10 0 0 0 0-20z" />
    <circle cx="8" cy="10" r="1.5" fill="currentColor" />
    <circle cx="12" cy="7" r="1.5" fill="currentColor" />
    <circle cx="16" cy="10" r="1.5" fill="currentColor" />
  </svg>
);

/**
 * The theme menu, the same pattern as the explorer's picker: a top-bar button
 * with a palette icon and the word Theme (the word hides below 640px) that
 * opens a popover listing Light Violet and Dark Violet, each with three colour
 * dots and a check on the current one. It closes on an outside click, on Esc
 * (the focus returns to the button) and after a choice; the arrow keys move
 * inside the list.
 */
export function ThemeMenu() {
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); items[items.length - 1]?.focus(); }
    else if (event.key === 'Tab') close(false);
  };

  return (
    <div className="theme-menu" ref={rootRef}>
      <button ref={buttonRef} type="button" className="icon-btn theme-btn" aria-haspopup="menu" aria-expanded={open} aria-controls="theme-menu-list" title="Change theme" data-theme-menu onClick={() => setOpen(!open)}>
        <PaletteIcon /><span className="theme-label">Theme</span>
      </button>
      {open && (
        <div className="theme-popover" id="theme-menu-list" role="menu" aria-label="Theme" onKeyDown={onMenuKey}>
          {THEME_ORDER.map((value) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === value}
              className="theme-option"
              data-theme-option={value}
              onClick={() => { setTheme(value); close(true); }}
            >
              <span className="theme-dots" aria-hidden="true">
                {THEME_PREVIEW[value].map((color) => <span key={color} className="theme-dot" style={{ backgroundColor: color }} />)}
              </span>
              <span className="theme-name">{THEME_LABELS[value]}</span>
              {theme === value && (
                <svg className="theme-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true" focusable="false"><polyline points="20 6 9 17 4 12" /></svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
