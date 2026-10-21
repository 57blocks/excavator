import { BaseEdge, EdgeLabelRenderer, Handle, Position, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import { memo, type KeyboardEvent } from 'react';

import { formatNumber } from '../../lib/format';
import type { DomainEdgeData, DomainEntry } from '../../lib/domain-flow';
import { useFloatingLine } from './FloatingEdge';

export interface DomainCardData extends Record<string, unknown> {
  entry: DomainEntry;
  selected: boolean;
  /** Go into a domain or a flow. */
  onOpen: (entry: DomainEntry) => void;
  /** Show the entry in the sidebar. */
  onSelect: (id: string) => void;
}

export type DomainFlowNode = Node<DomainCardData, 'card'>;

const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`;

const KIND_TEXT = { domain: 'Domain', flow: 'Flow', step: 'Step' } as const;

const onActivate = (action: () => void) => (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
};

function counts(entry: DomainEntry): string {
  if (entry.kind === 'domain') return `${plural(entry.flows ?? 0, 'flow')} · ${plural(entry.steps ?? 0, 'step')}`;
  if (entry.kind === 'flow') return plural(entry.steps ?? 0, 'step');
  return '';
}

/**
 * A domain, a flow or a step. A click on a domain or a flow goes into it; a click on a step selects it; the
 * info button selects any of them for the sidebar. A step carries its place in the flow's order.
 */
export const DomainCard = memo(function DomainCard({ data }: NodeProps<DomainFlowNode>) {
  const { entry } = data;
  const drills = entry.openTo !== null;
  const activate = () => (drills ? data.onOpen(entry) : data.onSelect(entry.id));
  const step = entry.kind === 'step';
  const label = step ? `Step ${entry.position}: ${entry.label}` : `${entry.label}: ${counts(entry)}`;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={drills ? undefined : data.selected}
      data-xv-domain-entry={entry.kind}
      data-xv-node={entry.id}
      data-xv-label={entry.label}
      data-xv-position={entry.position ?? undefined}
      onClick={activate}
      onKeyDown={onActivate(activate)}
      className={`xv-node relative box-border flex size-full cursor-pointer flex-col overflow-hidden rounded-card border border-line-2 bg-surface shadow-card outline-none focus-visible:ring-2 focus-visible:ring-accent ${step ? 'px-3 py-1.5' : 'px-5 py-4'} ${data.selected ? 'xv-selected' : ''}`}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5" style={{ background: 'var(--color-node-domain)', opacity: entry.kind === 'domain' ? 1 : entry.kind === 'flow' ? 0.6 : 0.35 }} />
      <Handle type="target" position={Position.Top} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <button
        type="button"
        aria-label={`Details of ${entry.label}`}
        aria-pressed={data.selected}
        title="Details"
        data-xv-action="details"
        onClick={(event) => {
          event.stopPropagation();
          data.onSelect(entry.id);
        }}
        className="nodrag absolute right-2 top-2 flex size-6 cursor-pointer items-center justify-center rounded-full border border-line-2 bg-surface p-0 text-[13px] font-semibold italic text-muted hover:border-accent hover:text-accent"
      >
        i
      </button>
      <div className={`flex min-w-0 shrink-0 items-center gap-2 pr-7 ${step ? 'leading-5' : ''}`}>
        {step ? <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-paper-2 font-mono text-[11px] font-semibold text-ink-soft">{entry.position}</span> : null}
        <span className={`min-w-0 truncate font-semibold text-ink ${step ? 'text-[13px]' : 'text-[18px] leading-6'}`} title={entry.label}>{entry.label}</span>
      </div>
      {step ? null : <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted">{KIND_TEXT[entry.kind]}</span>}
      {entry.summary ? (
        <p data-xv-card-text="summary" title={entry.summary} className={`min-h-0 overflow-hidden text-muted line-clamp-2 ${step ? 'mt-0.5 text-xs leading-[15px]' : 'mt-1 text-[13px] leading-[18px]'}`}>{entry.summary}</p>
      ) : null}
      <div data-xv-card-text="meta" className={`mt-auto flex min-w-0 shrink-0 items-baseline justify-between gap-2 font-mono text-muted ${step ? 'pt-0.5 text-[11px] leading-[15px]' : 'text-[13px] leading-5'}`}>
        <span className="truncate" title={entry.meta ?? undefined}>{entry.meta ?? ''}</span>
        <span className="shrink-0">{counts(entry)}</span>
      </div>
    </div>
  );
});

export const DOMAIN_NODE_TYPES = { card: DomainCard };

/**
 * A link between two cards: a cross-domain edge (dashed) or the arrow from one step to the next, a straight line from the
 * border of one card to the border of the other. A cross-domain edge writes the description of each edge of its pair beside it
 * while it is labelled, in a box that wraps.
 */
export function DomainLinkEdge({ id, source, target, markerEnd, markerStart, style, data }: EdgeProps) {
  const link = (data ?? { kind: 'sequence', lines: [], showLabel: false }) as DomainEdgeData;
  const line = useFloatingLine(source, target);
  if (!line) return null;
  return (
    <>
      <BaseEdge id={id} path={line.path} markerEnd={markerEnd} markerStart={markerStart} style={style} interactionWidth={link.kind === 'sequence' ? 0 : 16} />
      {link.showLabel ? (
        <EdgeLabelRenderer>
          <div
            data-xv-link-label={id}
            className="nodrag nopan pointer-events-none absolute w-max max-w-[340px] rounded-control border border-line-2 bg-surface px-2.5 py-1.5 text-xs leading-4 text-ink shadow-card"
            style={{ transform: `translate(-50%, -50%) translate(${line.labelX}px, ${line.labelY}px)` }}
          >
            {link.lines.map((text) => <p key={text} className="m-0">{text}</p>)}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const DOMAIN_EDGE_TYPES = { link: DomainLinkEdge };
