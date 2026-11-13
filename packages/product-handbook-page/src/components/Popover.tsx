import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * A button that opens a panel under it. The panel closes on a click outside it, on Escape (the focus goes back to the
 * button) and on a click on one of its links; the button says whether it is open with `aria-expanded`.
 */
export function Popover({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: Event) => {
      if (host.current !== null && !host.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="pop" ref={host}>
      <button type="button" ref={button} aria-expanded={open} aria-controls={id} data-pop={id} onClick={() => setOpen(!open)}>{label}</button>
      <div className="pop-panel" id={id} hidden={!open} onClick={(event) => { if ((event.target as HTMLElement).closest('a')) setOpen(false); }}>{children}</div>
    </div>
  );
}
