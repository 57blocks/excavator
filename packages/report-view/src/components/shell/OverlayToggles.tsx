import { useEffect, useRef } from 'react';

import { findProduct } from '../../data/manifest';
import { useCompact } from '../../hooks/use-compact';
import { overlayAvailability } from '../../lib/overlays';
import { OVERLAY_NAMES, OVERLAYS, toggleOverlay, type OverlayName } from '../../lib/overlay-names';
import { useGraphUi } from '../../state/graph-ui';
import { useViewer } from '../../state/viewer';

/** One overlay's switch; `wide` makes it fill a menu row. */
function Switch({ name, wide }: { name: OverlayName; wide: boolean }) {
  const ui = useGraphUi();
  const { manifest } = useViewer();
  const product = findProduct(manifest, OVERLAYS[name].product);
  const { enabled, text } = overlayAvailability(product);
  const on = enabled && ui.overlays.includes(name);
  const label = OVERLAYS[name].label;
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={!enabled}
      data-xv-overlay={name}
      title={enabled ? `${label} overlay: ${on ? 'on' : 'off'}` : `${product?.label ?? label}: ${text}`}
      onClick={() => ui.setOverlays((current) => toggleOverlay(current, name, !on))}
      className={`flex h-9 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-control border px-2.5 text-[13px] transition-colors duration-200 ease-site disabled:cursor-default disabled:opacity-60 ${wide ? 'w-full justify-between' : ''} ${
        on ? 'border-accent bg-accent text-white hover:bg-violet' : 'border-line-2 bg-surface text-ink enabled:hover:border-accent enabled:hover:text-accent'
      }`}
    >
      {label}
      {text ? <span className="text-[11px] text-muted">{text}</span> : null}
    </button>
  );
}

/** The overlays behind one button, for a window narrower than the full bar: the button says how many are on, and the menu holds the same switches. */
function OverlayMenu() {
  const ui = useGraphUi();
  const { manifest } = useViewer();
  const open = ui.overlay === 'overlays';
  const box = useRef<HTMLDivElement | null>(null);
  const count = OVERLAY_NAMES.filter((name) => overlayAvailability(findProduct(manifest, OVERLAYS[name].product)).enabled && ui.overlays.includes(name)).length;
  useEffect(() => {
    if (!open) return undefined;
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) ui.setOverlay(null);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open, ui]);
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        data-xv-overlay-menu=""
        onClick={() => ui.setOverlay(open ? null : 'overlays')}
        className="flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap rounded-control border border-line-2 bg-surface px-3 text-ink hover:border-accent hover:text-accent"
      >
        Overlays
        {count > 0 ? <span className="rounded-full bg-accent px-2 text-xs font-semibold text-white">{count}</span> : null}
      </button>
      {open ? (
        <div role="group" aria-label="Overlays" className="glass absolute right-0 top-[calc(100%+6px)] z-50 flex w-[220px] flex-col gap-1.5 rounded-card bg-surface p-3">
          {OVERLAY_NAMES.map((name) => <Switch key={name} name={name} wide />)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The three product overlays of the graph, each switched on its own (spec
 * "Product overlays"). One whose product is not in the page is disabled and says
 * why; the choice is in the address, so a reload keeps it. In a window narrower
 * than 1280 px the three switches sit behind one "Overlays" menu so the bar's
 * controls keep their size.
 */
export function OverlayToggles() {
  const compact = useCompact();
  if (compact) return <OverlayMenu />;
  return (
    <div role="group" aria-label="Overlays" className="flex shrink-0 items-center gap-1.5">
      <span className="text-xs text-muted">Overlays</span>
      {OVERLAY_NAMES.map((name) => <Switch key={name} name={name} wide={false} />)}
    </div>
  );
}
