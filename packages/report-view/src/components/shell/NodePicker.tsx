import { useId, useMemo, useState } from 'react';

import { nodeColor } from '../../lib/node-colors';
import { searchNodes } from '../../lib/search';
import type { GraphScene } from '../../state/graph-scene';

/** Pick one node of the graph by searching for it: a search box with a short result list, and the chosen node once it is chosen. */
export function NodePicker({ label, scene, value, onChange }: { label: string; scene: GraphScene; value: string | null; onChange: (nodeId: string | null) => void }) {
  const [query, setQuery] = useState('');
  const listId = useId();
  const hits = useMemo(() => searchNodes(scene.search, query, 6), [scene, query]);
  const chosen = value === null ? null : (scene.model.index.nodesById.get(value) ?? null);
  return (
    <div className="flex flex-col gap-1.5" data-xv-picker={label}>
      <span className="text-xs text-muted">{label}</span>
      {value !== null ? (
        <div className="flex items-center gap-2 rounded-control border border-line-2 bg-surface px-3 py-1.5">
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: nodeColor(chosen?.type ?? '') }} />
          <span className="min-w-0 flex-1 truncate text-ink" title={value}>{chosen ? chosen.name : value}</span>
          <span className="shrink-0 text-xs text-muted">{chosen?.type ?? 'not a node of the graph'}</span>
          <button type="button" aria-label={`Clear ${label}`} onClick={() => onChange(null)} className="cursor-pointer border-0 bg-transparent px-1 text-muted hover:text-ink">{String.fromCharCode(0xd7)}</button>
        </div>
      ) : (
        <>
          <input
            type="search"
            value={query}
            aria-label={label}
            aria-controls={listId}
            placeholder="Search by name or path"
            onChange={(event) => setQuery(event.target.value)}
            className="rounded-control border border-line-2 bg-surface px-3 py-1.5 text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent"
          />
          <ul id={listId} className="m-0 flex list-none flex-col gap-0.5 p-0">
            {hits.map((hit) => {
              const node = scene.model.index.nodesById.get(hit.id);
              if (!node) return null;
              return (
                <li key={hit.id}>
                  <button
                    type="button"
                    data-xv-pick={hit.id}
                    onClick={() => {
                      onChange(hit.id);
                      setQuery('');
                    }}
                    className="flex w-full min-w-0 cursor-pointer items-baseline gap-2 rounded-control border-0 bg-transparent px-2 py-1 text-left hover:bg-highlight"
                  >
                    <span className="shrink-0 font-medium text-ink">{node.name}</span>
                    <span className="shrink-0 text-[11px] text-muted">{node.type}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{node.filePath ?? ''}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
