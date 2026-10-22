import { findProduct } from '../../data/manifest';
import { navigate } from '../../hooks/use-route';
import type { Mode } from '../../lib/view-mode';
import { switchHash, VIEW_LABELS, type GraphView } from '../../lib/view-switch';
import { readable } from '../../lib/project-overview';
import { useGraphUi } from '../../state/graph-ui';
import { useViewer } from '../../state/viewer';

const VIEWS: readonly GraphView[] = ['domain', 'graph'];

/**
 * The cards at the top of a graph page's canvas (design D2): the Domain | Structural switch, shown only when the domain
 * graph is readable, and the button that opens the idle sidebar again after it was closed. The switch goes through the
 * hash to where the other view was left, in the same mode.
 */
export function ViewSwitch({ current, mode, idleClosed, idleLabel }: { current: GraphView; mode: Mode; idleClosed: boolean; idleLabel: string }) {
  const ui = useGraphUi();
  const { manifest } = useViewer();
  const domain = readable(findProduct(manifest, 'domain-graph'));
  if (!domain && !idleClosed) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {domain ? (
        <div role="group" aria-label="Domain or structural view" className="glass inline-flex rounded-full p-0.5">
          {VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              data-xv-switch={view}
              aria-pressed={view === current}
              onClick={() => view !== current && navigate(switchHash(view, ui.places.current, mode))}
              className={`cursor-pointer rounded-full border-0 px-3.5 py-1 text-[13px] transition-colors duration-200 ease-site ${view === current ? 'bg-accent text-white' : 'bg-transparent text-ink-soft hover:text-accent'}`}
            >
              {VIEW_LABELS[view]}
            </button>
          ))}
        </div>
      ) : null}
      {idleClosed ? (
        <button type="button" data-xv-action="show-idle" onClick={() => ui.setIdleOpen(true)} className="glass cursor-pointer rounded-full border-0 px-3.5 py-1 text-[13px] text-ink-soft hover:text-accent">
          {idleLabel}
        </button>
      ) : null}
    </div>
  );
}
