import { Panel } from '@xyflow/react';

import type { ReactNode } from 'react';

import { formatNumber } from '../../lib/format';
import { legendRows } from '../../lib/node-colors';
import type { Crumb } from '../../lib/graph-structure';
import type { Legend as OverlayLegendData } from '../../lib/overlays';

const GLASS = 'glass rounded-card';

/** The top-left corner of the canvas: the breadcrumbs, and under them the cards that belong to the view (a path, for one). */
export function TopLeft({ children }: { children: ReactNode }) {
  return <Panel position="top-left" data-xv-chrome="top" className="!m-3 flex max-w-[min(560px,calc(100%-24px))] flex-col gap-2">{children}</Panel>;
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

const HOT_FILL = ['var(--color-hot-1)', 'var(--color-hot-2)', 'var(--color-hot-3)', 'var(--color-hot-4)'];
const TONE_FILL: Record<string, string> = {
  high: 'var(--color-unused-high)',
  medium: 'var(--color-unused-medium)',
  low: 'var(--color-unused-low)',
  unrated: 'var(--color-muted)',
  evidence: 'var(--color-evidence)',
  'no-evidence': 'var(--color-surface)',
};

/** What one overlay that is on says: its colours with what each covers, and how the marks were made. */
export interface OverlayBlock {
  overlay: string;
  title: string;
  rows: OverlayLegendData['rows'];
  note: string;
}

function Swatch({ swatch }: { swatch: OverlayLegendData['rows'][number]['swatch'] }) {
  const fill = 'hot' in swatch ? HOT_FILL[swatch.hot - 1] : TONE_FILL[swatch.tone];
  return <span aria-hidden="true" className="size-3 shrink-0 rounded-[4px] border border-line-2" style={{ background: fill }} />;
}

function OverlayLegend({ block }: { block: OverlayBlock }) {
  return (
    <section aria-label={`${block.title} overlay`} data-xv-legend={block.overlay} className="border-b border-line pb-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h3 className="text-xs">{block.title}</h3>
        {block.rows.map((row) => (
          <span key={row.label} className="flex items-center gap-1.5 text-xs text-ink-soft" data-xv-legend-row="">
            <Swatch swatch={row.swatch} />
            {row.label}
            {row.count === null ? null : <span className="font-mono text-muted">{`(${formatNumber(row.count)})`}</span>}
          </span>
        ))}
      </div>
      <p className="mt-0.5 text-[11px] leading-4 text-muted">{block.note}</p>
    </section>
  );
}

/** The bottom of the canvas: the legend of each overlay that is on, and under them the colour of each kind of node in this graph with the node types it covers. */
export function Legend({ types, overlays = [] }: { types: Iterable<string>; overlays?: readonly OverlayBlock[] }) {
  const rows = legendRows(types);
  return (
    <Panel position="bottom-center" data-xv-chrome="bottom" className={`${GLASS} !mb-3 flex max-w-[calc(100%-320px)] flex-col gap-1.5 px-3 py-2`}>
      {overlays.map((block) => <OverlayLegend key={block.overlay} block={block} />)}
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
