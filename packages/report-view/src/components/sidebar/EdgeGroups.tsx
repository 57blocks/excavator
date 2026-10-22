import { useState } from 'react';

import { formatNumber } from '../../lib/format';
import type { EdgeGroup } from '../../lib/node-edges';
import { nodeColor } from '../../lib/node-colors';

const SHOWN_AT_FIRST = 20;

function Group({ group, onSelect }: { group: EdgeGroup; onSelect: (nodeId: string) => void }) {
  const [shown, setShown] = useState(SHOWN_AT_FIRST);
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{`${group.type} (${formatNumber(group.ends.length)})`}</h4>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {group.ends.slice(0, shown).map((end, i) => (
          <li key={`${end.otherId}|${i}`}>
            {end.other ? (
              <button
                type="button"
                data-xv-edge-to={end.otherId}
                onClick={() => onSelect(end.otherId)}
                title={`${end.other.type} ${end.other.name}${end.other.filePath ? ` in ${end.other.filePath}` : ''}`}
                className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-2 py-1 text-left text-ink hover:bg-highlight"
              >
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: nodeColor(end.other.type) }} />
                <span className="min-w-0 flex-1 truncate">{end.other.name}</span>
                <span className="shrink-0 text-[11px] text-muted">{end.other.type}</span>
              </button>
            ) : (
              <span className="block px-2 py-1 font-mono text-xs text-muted [overflow-wrap:anywhere]" title={end.otherId}>{`${end.otherId} (not a node of the graph)`}</span>
            )}
          </li>
        ))}
      </ul>
      {group.ends.length > shown ? (
        <button type="button" onClick={() => setShown(shown + 100)} className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-xs text-accent underline hover:text-violet">
          {`Show ${formatNumber(Math.min(100, group.ends.length - shown))} more of ${formatNumber(group.ends.length - shown)} left`}
        </button>
      ) : null}
    </div>
  );
}

/** One direction of a node's edges, grouped by type; each end selects the node there. */
export function EdgeGroups({ title, total, groups, onSelect }: { title: string; total: number; groups: readonly EdgeGroup[]; onSelect: (nodeId: string) => void }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <h3>{`${title} (${formatNumber(total)})`}</h3>
      {groups.length === 0 ? <p className="m-0 text-muted">None.</p> : groups.map((group) => <Group key={group.type} group={group} onSelect={onSelect} />)}
    </section>
  );
}
