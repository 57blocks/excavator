import { useMemo } from 'react';

import { formatNumber } from '../../lib/format';
import { tallyText } from '../../lib/graph-edges';
import type { LevelPlan } from '../../lib/graph-flow';
import type { Level, LevelEntry } from '../../lib/graph-structure';
import { Facts } from '../ui/Controls';

const KIND_LABEL = { cluster: 'Layer', container: 'Directory', fold: 'Fold', file: 'File' } as const;

interface Row {
  key: string;
  direction: 'to' | 'from';
  other: string;
  text: string;
}

/** The aggregated edges at this level that start or end at the entry: for each other end, what runs each way. */
function edgeRows(entry: LevelEntry, level: Level, plan: LevelPlan): Row[] {
  const labels = new Map(level.entries.map((e) => [e.id, e.label]));
  const outer = (id: string) => plan.fileOf.get(id) ?? id;
  const labelOf = (id: string) => labels.get(outer(id)) ?? id;
  const rows: Row[] = [];
  for (const edge of plan.edges) {
    const fromHere = outer(edge.source) === entry.id;
    const toHere = outer(edge.target) === entry.id;
    if (!fromHere && !toHere) continue;
    const other = labelOf(fromHere ? edge.target : edge.source);
    rows.push({ key: `${edge.id}:forward`, direction: fromHere ? 'to' : 'from', other, text: tallyText(edge.forward) });
    if (edge.backward) rows.push({ key: `${edge.id}:backward`, direction: fromHere ? 'from' : 'to', other, text: tallyText(edge.backward) });
  }
  return rows.sort((a, b) => (a.other < b.other ? -1 : a.other > b.other ? 1 : a.direction < b.direction ? -1 : 1));
}

/** The details of a selected cluster, directory or fold: its counts, and the edges that the level sums up for it. */
export function EntryDetails({ entry, level, plan, onOpen }: { entry: LevelEntry; level: Level; plan: LevelPlan; onOpen: () => void }) {
  const rows = useMemo(() => edgeRows(entry, level, plan), [entry, level, plan]);
  return (
    <div className="flex flex-col gap-5 text-[13.5px]" data-xv-details={entry.id}>
      <Facts
        items={[
          ['Name', entry.label],
          ['Kind', KIND_LABEL[entry.kind]],
          ['Files', formatNumber(entry.files)],
          ['Nodes', formatNumber(entry.nodes)],
          ...(entry.note ? [['Note', entry.note] as const] : []),
        ]}
      />
      <div><button type="button" onClick={onOpen} className="cursor-pointer rounded-control border border-line-2 bg-surface px-3 py-1.5 text-[13px] text-ink hover:border-accent hover:text-accent">Open this level</button></div>
      <section aria-label="Edges at this level" className="flex flex-col gap-2">
        <h3>{`Edges at this level (${formatNumber(rows.length)})`}</h3>
        <p className="m-0 text-xs text-muted">Each line sums the edges of the shown types between this entry and another entry of the level.</p>
        {rows.length === 0 ? <p className="m-0 text-muted">None are drawn between this entry and another one.</p> : null}
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map((row) => (
            <li key={row.key} data-xv-entry-edge={row.direction} className="flex min-w-0 items-baseline gap-2">
              <span className="w-10 shrink-0 text-[11px] uppercase tracking-wider text-muted">{row.direction === 'to' ? 'to' : 'from'}</span>
              <span className="min-w-0 flex-1 truncate text-ink" title={row.other}>{row.other}</span>
              <span className="shrink-0 font-mono text-xs text-ink-soft">{row.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
