import { findProduct } from '../../data/manifest';
import { overlayAvailability } from '../../lib/overlays';
import { OVERLAY_NAMES, OVERLAYS, toggleOverlay } from '../../lib/overlay-names';
import { useGraphUi } from '../../state/graph-ui';
import { useViewer } from '../../state/viewer';

/**
 * The three product overlays of the graph, each switched on its own (spec
 * "Product overlays"). One whose product is not in the page is disabled and says
 * why; the choice is in the address, so a reload keeps it.
 */
export function OverlayToggles() {
  const ui = useGraphUi();
  const { manifest } = useViewer();
  return (
    <div role="group" aria-label="Overlays" className="flex items-center gap-1.5">
      <span className="text-xs text-muted max-lg:hidden">Overlays</span>
      {OVERLAY_NAMES.map((name) => {
        const product = findProduct(manifest, OVERLAYS[name].product);
        const { enabled, text } = overlayAvailability(product);
        const on = enabled && ui.overlays.includes(name);
        const label = OVERLAYS[name].label;
        return (
          <button
            key={name}
            type="button"
            aria-pressed={on}
            disabled={!enabled}
            data-xv-overlay={name}
            title={enabled ? `${label} overlay: ${on ? 'on' : 'off'}` : `${product?.label ?? label}: ${text}`}
            onClick={() => ui.setOverlays((current) => toggleOverlay(current, name, !on))}
            className={`flex h-9 cursor-pointer items-center gap-1.5 rounded-control border px-2.5 text-[13px] transition-colors duration-200 ease-site disabled:cursor-default disabled:opacity-60 ${
              on ? 'border-accent bg-accent text-white hover:bg-violet' : 'border-line-2 bg-surface text-ink enabled:hover:border-accent enabled:hover:text-accent'
            }`}
          >
            {label}
            {text ? <span className="text-[11px] text-muted">{text}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
