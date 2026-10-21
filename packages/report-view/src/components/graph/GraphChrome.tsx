import { Panel } from '@xyflow/react';

import type { ReactNode } from 'react';

import { legendRows } from '../../lib/node-colors';
import type { Crumb } from '../../lib/graph-structure';

const GLASS = 'glass rounded-card';

/** The top-left corner of the canvas: the breadcrumbs, and under them the cards that belong to the view (a path, for one). */
export function TopLeft({ children }: { children: ReactNode }) {
  return <Panel position="top-left" className="!m-3 flex max-w-[min(560px,calc(100%-24px))] flex-col gap-2">{children}</Panel>;
}

/** Where the level is: one button per step from the project down, the last one the level itself. */
export function Breadcrumbs({ crumbs, notes, onGo }: { crumbs: readonly Crumb[]; notes: readonly string[]; onGo: (crumb: Crumb) => void }) {
  return (
    <div className={`${GLASS} px-3 py-2`}>
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
    </div>
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
