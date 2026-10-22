import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, type KeyboardEvent, type ReactNode } from 'react';

import { formatNumber } from '../../lib/format';
import type { LevelEntry } from '../../lib/graph-structure';
import { nodeColor } from '../../lib/node-colors';
import type { Confidence, NodeMarks } from '../../lib/overlays';
import { OverlayChips, UNUSED_ROW_COLOUR, UNUSED_ROW_TEXT } from './OverlayChips';

export interface GroupData extends Record<string, unknown> {
  entry: LevelEntry;
  selected: boolean;
  /** A highlighted path runs through this entry. */
  onPath: boolean;
  onOpen: (entry: LevelEntry) => void;
  /** Select the entry, to see its details in the sidebar. */
  onDetails: (entry: LevelEntry) => void;
  /** How the overlays that are on draw it; null with none on. */
  marks: NodeMarks | null;
}

export interface FileData extends Record<string, unknown> {
  entry: LevelEntry;
  selected: boolean;
  onPath: boolean;
  /** Whether the file shows the nodes it owns; null when it owns none. */
  expanded: boolean | null;
  onSelect: (nodeId: string) => void;
  onToggle: (fileId: string) => void;
  marks: NodeMarks | null;
}

export interface ChildData extends Record<string, unknown> {
  name: string;
  type: string;
  selected: boolean;
  onPath: boolean;
  /** Set on the last row of a file that has more nodes than it shows: not a node, a count. */
  more: number | null;
  /** The unused-code overlay's mark for this function, when it is on and lists the function. */
  unused: { confidence: Confidence; title: string | null } | null;
  onSelect: (nodeId: string) => void;
}

export type GroupFlowNode = Node<GroupData, 'container'>;
export type FileFlowNode = Node<FileData, 'file'>;
export type ChildFlowNode = Node<ChildData, 'child'>;

const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`;
const counts = (entry: LevelEntry) => `${plural(entry.files, 'file')} · ${plural(entry.nodes, 'node')}`;

/** Activate on Enter or Space, as a button does. */
const onActivate = (action: () => void) => (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
};

function Handles({ source = Position.Bottom, target = Position.Top }: { source?: Position; target?: Position }) {
  return (
    <>
      <Handle type="target" position={target} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <Handle type="source" position={source} isConnectable={false} className="!pointer-events-none !opacity-0" />
    </>
  );
}

const CARD = 'xv-node relative box-border flex size-full cursor-pointer flex-col overflow-hidden rounded-card border bg-surface shadow-card';

const KIND_TEXT = { cluster: 'Layer', container: 'Directory', fold: 'Folded' } as const;

const marks = (selected: boolean, onPath: boolean) => `${selected ? 'xv-selected' : ''} ${onPath ? 'xv-on-path' : ''}`;

/** A cluster (a layer), a directory container or a fold: it opens as a level of its own; the info button selects it for the sidebar. */
export const GroupNode = memo(function GroupNode({ data }: NodeProps<GroupFlowNode>) {
  const { entry } = data;
  const open = () => data.onOpen(entry);
  const tone = entry.kind === 'fold' ? 'border-dashed border-line-2' : 'border-line-2';
  const cluster = entry.kind === 'cluster';
  return (
    <div className="relative size-full" title={data.marks?.title ?? undefined}>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${entry.label}: ${counts(entry)}`}
        data-xv-entry={entry.kind}
        data-xv-label={entry.label}
        data-xv-hot={data.marks?.hot ?? undefined}
        onClick={open}
        onKeyDown={onActivate(open)}
        className={`${CARD} ${tone} ${marks(data.selected, data.onPath)} ${cluster ? 'px-5 py-4' : 'px-4 py-3'} outline-none focus-visible:ring-2 focus-visible:ring-accent`}
      >
        {cluster ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-accent" /> : null}
        <Handles />
        <button
          type="button"
          aria-label={`Details of ${entry.label}`}
          aria-pressed={data.selected}
          title="Details"
          onClick={(event) => {
            event.stopPropagation();
            data.onDetails(entry);
          }}
          className="nodrag absolute right-2 top-2 flex size-6 cursor-pointer items-center justify-center rounded-full border border-line-2 bg-surface p-0 text-[13px] font-semibold italic text-muted hover:border-accent hover:text-accent"
        >
          i
        </button>
        <div className={`flex min-w-0 flex-col pr-7 ${cluster ? 'gap-0.5' : ''}`}>
          <span className={`min-w-0 truncate font-heading text-ink ${cluster ? 'text-[18px] leading-6' : ''}`} title={entry.label}>{entry.label}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{KIND_TEXT[entry.kind as keyof typeof KIND_TEXT]}</span>
        </div>
        {entry.note ? <p className={`mt-1 text-muted ${cluster ? 'line-clamp-2 text-[13px] leading-[18px]' : 'line-clamp-1 text-xs'}`}>{entry.note}</p> : null}
        <p className={`mt-auto font-mono text-muted ${cluster ? 'text-[13px]' : 'text-xs'}`}>{counts(entry)}</p>
      </div>
      <OverlayChips chips={data.marks?.chips ?? []} />
    </div>
  );
});

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className={`size-3 transition-transform duration-200 ease-site ${open ? 'rotate-90' : ''}`}>
      <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A file: a click selects it; the chevron opens it to the nodes it owns. */
export const FileNode = memo(function FileNode({ data }: NodeProps<FileFlowNode>) {
  const { entry } = data;
  const select = () => data.onSelect(entry.id);
  const open: ReactNode = data.expanded === null ? null : (
    <button
      type="button"
      aria-label={`${data.expanded ? 'Hide' : 'Show'} the nodes of ${entry.label}`}
      aria-expanded={data.expanded}
      onClick={(event) => {
        event.stopPropagation();
        data.onToggle(entry.id);
      }}
      className="nodrag absolute right-2 top-2 flex size-6 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-muted hover:bg-paper hover:text-ink"
    >
      <Chevron open={data.expanded} />
    </button>
  );
  return (
    <div className="relative size-full" title={data.marks?.title ?? undefined}>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${entry.note ?? entry.label}: ${plural(entry.nodes, 'node')}`}
        aria-pressed={data.selected}
        data-xv-entry="file"
        data-xv-label={entry.label}
        data-xv-node={entry.id}
        data-xv-hot={data.marks?.hot ?? undefined}
        onClick={select}
        onKeyDown={onActivate(select)}
        className={`${CARD} border-line-2 outline-none focus-visible:ring-2 focus-visible:ring-accent ${marks(data.selected, data.onPath)}`}
      >
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 rounded-l-card" style={{ background: nodeColor('file') }} />
        <Handles />
        <div className="py-2 pl-4 pr-10">
          <div className="truncate font-heading text-ink" title={entry.note ?? entry.label}>{entry.label}</div>
          <div className="font-mono text-xs text-muted">{plural(entry.nodes, 'node')}</div>
        </div>
        {open}
      </div>
      <OverlayChips chips={data.marks?.chips ?? []} />
    </div>
  );
});

/** A node a file owns, a row inside the file's box. */
export const ChildNode = memo(function ChildNode({ id, data }: NodeProps<ChildFlowNode>) {
  if (data.more !== null) {
    return <div data-xv-entry="more" className="flex size-full items-center px-2 text-xs text-muted">{`${formatNumber(data.more)} more, not drawn`}</div>;
  }
  const select = () => data.onSelect(id);
  const unused = data.unused;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={data.selected}
      data-xv-entry="child"
      data-xv-node={id}
      data-xv-unused={unused?.confidence}
      title={[`${data.type} ${data.name}`, unused?.title].filter(Boolean).join('\n')}
      style={unused ? { borderLeft: `3px solid ${UNUSED_ROW_COLOUR[unused.confidence]}` } : undefined}
      onClick={select}
      onKeyDown={onActivate(select)}
      className={`xv-node flex size-full cursor-pointer items-center gap-2 rounded-control border border-line bg-paper px-2 outline-none focus-visible:ring-2 focus-visible:ring-accent ${marks(data.selected, data.onPath)}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: nodeColor(data.type) }} />
      <span className="min-w-0 flex-1 truncate text-xs text-ink">{data.name}</span>
      {unused ? (
        <span className="shrink-0 rounded-[4px] px-1 text-[10px] text-white" style={{ background: UNUSED_ROW_COLOUR[unused.confidence] }}>{UNUSED_ROW_TEXT[unused.confidence]}</span>
      ) : (
        <span className="shrink-0 text-[10px] text-muted">{data.type}</span>
      )}
    </div>
  );
});

// Not named `group`: React Flow styles that type name itself.
export const NODE_TYPES = { container: GroupNode, file: FileNode, child: ChildNode };
