import { useRoute } from '../../hooks/use-route';
import { filterableEdgeTypes, hiddenCount, NO_FILTERS, shownEdgeTypes, toggleEdgeType, toggleLayer, toggleNodeType } from '../../lib/graph-filters';
import { parseGraphState } from '../../lib/graph-state';
import { useGraphScene } from '../../state/graph-scene';
import { useGraphUi } from '../../state/graph-ui';

function Chip({ on, label, onToggle, title }: { on: boolean; label: string; onToggle: () => void; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onToggle}
      className={`cursor-pointer rounded-full border px-3 py-0.5 text-xs transition-colors duration-200 ease-site ${on ? 'border-accent bg-accent text-white hover:bg-violet' : 'border-line-2 bg-surface text-muted line-through hover:border-accent hover:text-accent'}`}
    >
      {label}
    </button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3>{title}</h3>
      {hint ? <p className="m-0 text-xs text-muted">{hint}</p> : null}
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  );
}

/** The filter button of the top bar, with the number of choices that are off, and the menu of node types, edge types and layers. */
export function FilterMenu() {
  const ui = useGraphUi();
  const { route } = useRoute();
  const onGraph = route.page === 'graph';
  const scene = useGraphScene(onGraph);
  if (!onGraph || scene.state !== 'ready' || !scene.value) return null;
  const { choices } = scene.value;
  const { filters } = ui;
  const focus = parseGraphState(route.params).focus;
  const hidden = hiddenCount(filters, choices, focus);
  const shownEdges = shownEdgeTypes(filters, choices.edgeTypes, focus);
  const open = ui.overlay === 'filters';
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        data-xv-filter-hidden={hidden}
        onClick={() => ui.setOverlay(open ? null : 'filters')}
        className="flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap rounded-control border border-line-2 bg-surface px-3 text-ink hover:border-accent hover:text-accent"
      >
        Filters
        {hidden > 0 ? <span className="whitespace-nowrap rounded-full bg-accent px-2 text-xs font-semibold text-white">{`${hidden} hidden`}</span> : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Filters" className="glass absolute right-0 top-[calc(100%+6px)] z-50 flex max-h-[70vh] w-[min(420px,92vw)] flex-col gap-4 overflow-auto rounded-card bg-surface p-4">
          <Section title="Node types" hint="A hidden type is left out, with the edges that end at it.">
            {choices.nodeTypes.map((type) => <Chip key={type} on={!filters.nodeTypes.has(type)} label={type} onToggle={() => ui.setFilters((f) => toggleNodeType(f, type))} />)}
          </Section>
          <Section title="Edge types" hint={focus ? 'The focus view draws every type until one is turned off.' : 'A level draws imports, calls and exports until the choice is changed; contains is nesting, drawn in the focus view.'}>
            {filterableEdgeTypes(choices.edgeTypes, focus).map((type) => <Chip key={type} on={shownEdges.has(type)} label={type} onToggle={() => ui.setFilters((f) => toggleEdgeType(f, type, choices.edgeTypes, focus))} />)}
          </Section>
          {choices.layers.length > 0 ? (
            <Section title="Layers" hint="A hidden layer's files are left out.">
              {choices.layers.map((layer) => <Chip key={layer.key} on={!filters.layers.has(layer.key)} label={layer.label} title={layer.key} onToggle={() => ui.setFilters((f) => toggleLayer(f, layer.key))} />)}
            </Section>
          ) : null}
          <div>
            <button type="button" onClick={() => ui.setFilters(() => NO_FILTERS)} className="cursor-pointer rounded-control border border-line-2 bg-surface px-3 py-1 text-[13px] text-ink hover:border-accent hover:text-accent">Reset to the defaults</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
