import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, type KeyboardEvent, type ReactNode } from 'react';

import { formatNumber } from '../../lib/format';
import type { LevelEntry } from '../../lib/graph-structure';
import { nodeColor } from '../../lib/node-colors';

export interface GroupData extends Record<string, unknown> {
  entry: LevelEntry;
  onOpen: (entry: LevelEntry) => void;
}

export interface FileData extends Record<string, unknown> {
  entry: LevelEntry;
  selected: boolean;
  /** Whether the file shows the nodes it owns; null when it owns none. */
  expanded: boolean | null;
  onSelect: (nodeId: string) => void;
  onToggle: (fileId: string) => void;
}

export interface ChildData extends Record<string, unknown> {
  name: string;
  type: string;
  selected: boolean;
  /** Set on the last row of a file that has more nodes than it shows: not a node, a count. */
  more: number | null;
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

/** A cluster (a layer), a directory container or a fold: it opens as a level of its own. */
export const GroupNode = memo(function GroupNode({ data }: NodeProps<GroupFlowNode>) {
  const { entry } = data;
  const open = () => data.onOpen(entry);
  const tone = entry.kind === 'fold' ? 'border-dashed border-line-2' : 'border-line-2';
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${entry.label}: ${counts(entry)}`}
      data-xv-entry={entry.kind}
      data-xv-label={entry.label}
      onClick={open}
      onKeyDown={onActivate(open)}
      className={`${CARD} ${tone} px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-accent`}
    >
      {entry.kind === 'cluster' ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-accent" /> : null}
      <Handles />
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-semibold text-ink" title={entry.label}>{entry.label}</span>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted">{KIND_TEXT[entry.kind as keyof typeof KIND_TEXT]}</span>
      </div>
      {entry.note ? <p className={`mt-0.5 text-xs text-muted ${entry.kind === 'cluster' ? 'line-clamp-2' : 'line-clamp-1'}`}>{entry.note}</p> : null}
      <p className="mt-auto font-mono text-xs text-muted">{counts(entry)}</p>
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
    <div
      role="button"
      tabIndex={0}
      aria-label={`${entry.note ?? entry.label}: ${plural(entry.nodes, 'node')}`}
      aria-pressed={data.selected}
      data-xv-entry="file"
      data-xv-label={entry.label}
      data-xv-node={entry.id}
      onClick={select}
      onKeyDown={onActivate(select)}
      className={`${CARD} border-line-2 outline-none focus-visible:ring-2 focus-visible:ring-accent ${data.selected ? 'xv-selected' : ''}`}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 rounded-l-card" style={{ background: nodeColor('file') }} />
      <Handles />
      <div className="py-2 pl-4 pr-10">
        <div className="truncate font-semibold text-ink" title={entry.note ?? entry.label}>{entry.label}</div>
        <div className="font-mono text-xs text-muted">{plural(entry.nodes, 'node')}</div>
      </div>
      {open}
    </div>
  );
});

/** A node a file owns, a row inside the file's box. */
export const ChildNode = memo(function ChildNode({ id, data }: NodeProps<ChildFlowNode>) {
  if (data.more !== null) {
    return <div data-xv-entry="more" className="flex size-full items-center px-2 text-xs text-muted">{`${formatNumber(data.more)} more, not drawn`}</div>;
  }
  const select = () => data.onSelect(id);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={data.selected}
      data-xv-entry="child"
      data-xv-node={id}
      title={`${data.type} ${data.name}`}
      onClick={select}
      onKeyDown={onActivate(select)}
      className={`xv-node flex size-full cursor-pointer items-center gap-2 rounded-control border border-line bg-paper px-2 outline-none focus-visible:ring-2 focus-visible:ring-accent ${data.selected ? 'xv-selected' : ''}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: nodeColor(data.type) }} />
      <span className="min-w-0 flex-1 truncate text-xs text-ink">{data.name}</span>
      <span className="shrink-0 text-[10px] text-muted">{data.type}</span>
    </div>
  );
});

// Not named `group`: React Flow styles that type name itself.
export const NODE_TYPES = { container: GroupNode, file: FileNode, child: ChildNode };
