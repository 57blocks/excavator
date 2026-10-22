import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import { navigate, useRoute } from '../../hooks/use-route';
import { selectHash } from '../../lib/graph-actions';
import { parseGraphState, TOP_LEVEL } from '../../lib/graph-state';
import { nodeColor } from '../../lib/node-colors';
import { searchNodes } from '../../lib/search';
import { useGraphScene } from '../../state/graph-scene';
import { useGraphUi } from '../../state/graph-ui';

/**
 * The search box of the top bar (spec "Search, filters, focus and paths"): fuzzy
 * matches on name and path, each with its type and path. Choosing one goes to the
 * graph, drills to where the node lives and selects it. `/` focuses the box.
 * The graph is read on the first focus, not at load.
 */
export function SearchBox() {
  const ui = useGraphUi();
  const { route } = useRoute();
  const [query, setQuery] = useState('');
  const [wanted, setWanted] = useState(false);
  const [active, setActive] = useState(0);
  const scene = useGraphScene(wanted);
  const ready = scene.state === 'ready' ? scene.value : null;
  const hits = useMemo(() => (ready ? searchNodes(ready.search, query) : []), [ready, query]);
  const open = ui.overlay === 'search' && query.trim() !== '';
  useEffect(() => setActive(0), [query]);

  const choose = (nodeId: string) => {
    if (!ready) return;
    const keep = route.page === 'graph' ? parseGraphState(route.params) : TOP_LEVEL;
    navigate(selectHash({ ...TOP_LEVEL, from: keep.from, to: keep.to, directed: keep.directed, overlays: keep.overlays, filters: keep.filters }, ready.model.index, ready.structure, nodeId));
    setQuery('');
    ui.setOverlay(null);
    ui.searchInput.current?.blur();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (hits.length > 0) setActive((at) => (at + (event.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
    } else if (event.key === 'Enter' && hits[active]) {
      event.preventDefault();
      choose(hits[active].id);
    }
  };

  return (
    <div className="relative min-w-[160px] flex-1 max-sm:hidden" style={{ maxWidth: 480 }}>
      <input
        ref={ui.searchInput}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="xv-search-results"
        aria-label="Search nodes and files"
        placeholder="Search nodes and files  ( / )"
        value={query}
        data-xv-search=""
        onFocus={() => {
          setWanted(true);
          ui.setOverlay('search');
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setWanted(true);
          ui.setOverlay('search');
        }}
        onBlur={() => ui.overlay === 'search' && window.setTimeout(() => ui.setOverlay(null), 120)}
        onKeyDown={onKeyDown}
        className="h-9 w-full rounded-control border border-line-2 bg-paper px-3 text-ink focus:border-accent focus:bg-surface focus:outline-2 focus:outline-offset-1 focus:outline-accent"
      />
      {open ? (
        <div id="xv-search-results" role="listbox" aria-label="Search results" className="glass absolute left-0 top-[calc(100%+6px)] z-50 max-h-[60vh] w-[min(560px,90vw)] overflow-auto rounded-card py-1.5">
          {scene.state === 'loading' ? <p className="m-0 px-3 py-2 text-muted">Reading the graph.</p> : null}
          {scene.state === 'error' ? <p className="m-0 px-3 py-2 text-muted">{scene.error.message}</p> : null}
          {ready && hits.length === 0 ? <p className="m-0 px-3 py-2 text-muted">No node matches.</p> : null}
          {ready ? hits.map((hit, i) => {
            const node = ready.model.index.nodesById.get(hit.id);
            if (!node) return null;
            return (
              <button
                key={hit.id}
                type="button"
                role="option"
                aria-selected={i === active}
                data-xv-hit={hit.id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(hit.id);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full min-w-0 cursor-pointer flex-col gap-0.5 border-0 px-3 py-1.5 text-left ${i === active ? 'bg-highlight' : 'bg-transparent'}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: nodeColor(node.type) }} />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{node.name}</span>
                  <span className="shrink-0 text-[11px] text-muted">{node.type}</span>
                </span>
                {node.filePath ? <span className="truncate pl-4 font-mono text-[11px] text-muted">{node.filePath}</span> : null}
              </button>
            );
          }) : null}
        </div>
      ) : null}
    </div>
  );
}
