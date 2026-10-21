import { Panel } from '@xyflow/react';

import type { GraphIndex } from '../../data/indexes';
import { nodeSummaryView } from '../../lib/node-summary';
import { legendRows } from '../../lib/node-colors';
import type { Crumb } from '../../lib/graph-structure';
import { NodeSummary } from '../NodeSummary';
import { Badge } from '../ui/Badge';

const GLASS = 'glass rounded-card';

/** Where the level is: one button per step from the project down, the last one the level itself. */
export function Breadcrumbs({ crumbs, notes, onGo }: { crumbs: readonly Crumb[]; notes: readonly string[]; onGo: (crumb: Crumb) => void }) {
  return (
    <Panel position="top-left" className={`${GLASS} !m-3 max-w-[min(560px,calc(100%-24px))] px-3 py-2`}>
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[13px]">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={`${crumb.path}|${crumb.fold ?? ''}`} className="flex items-center gap-1">
              {i > 0 ? <span aria-hidden="true" className="text-muted">/</span> : null}
              {last ? (
                <span aria-current="page" className="font-semibold text-ink">{crumb.label}</span>
              ) : (
                <button type="button" onClick={() => onGo(crumb)} className="cursor-pointer rounded-control border-0 bg-transparent px-1 py-0.5 text-accent hover:bg-highlight">
                  {crumb.label}
                </button>
              )}
            </span>
          );
        })}
      </nav>
      {notes.map((note) => <p key={note} className="mt-1 text-xs text-muted">{note}</p>)}
    </Panel>
  );
}

/** The colour of each kind of node in this graph, with the node types it covers. */
export function Legend({ types }: { types: Iterable<string> }) {
  const rows = legendRows(types);
  return (
    <Panel position="bottom-center" className={`${GLASS} !mb-3 max-w-[calc(100%-320px)] px-3 py-2`}>
      <ul aria-label="Node kinds" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-1.5" title={row.types.join(', ')}>
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: row.colour }} />
            <span className="text-ink-soft">{row.label}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** The node that is selected, in brief; the sidebar replaces this with the full details. */
export function SelectedCard({ index, nodeId, onClose }: { index: GraphIndex; nodeId: string; onClose: () => void }) {
  const node = index.nodesById.get(nodeId);
  const view = node ? nodeSummaryView(index, nodeId) : null;
  return (
    <Panel position="top-right" className={`${GLASS} !m-3 w-[300px] max-w-[calc(100%-24px)] p-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink" title={nodeId}>{node ? node.name : nodeId}</div>
          {node ? <div className="mt-0.5 flex flex-wrap items-center gap-2"><Badge tone="neutral">{node.type}</Badge></div> : null}
        </div>
        <button type="button" aria-label="Clear the selection" onClick={onClose} className="cursor-pointer rounded-control border-0 bg-transparent px-2 py-0.5 text-muted hover:bg-paper hover:text-ink">
          {String.fromCharCode(0xd7)}
        </button>
      </div>
      {node === undefined ? <p className="mt-2 text-muted">The graph has no node with this id.</p> : null}
      {node?.filePath ? (
        <p className="mt-2 break-all font-mono text-xs text-muted">
          {node.filePath}
          {Array.isArray(node.lineRange) ? `:${node.lineRange[0]}-${node.lineRange[1]}` : ''}
        </p>
      ) : null}
      {view ? <div className="mt-2 text-[13px]"><NodeSummary view={view} /></div> : null}
    </Panel>
  );
}
