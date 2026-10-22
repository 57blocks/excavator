import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, type KeyboardEvent } from 'react';

import { nodeColor } from '../../lib/node-colors';

export interface FocusData extends Record<string, unknown> {
  name: string;
  type: string;
  /** The node the view is focused on. */
  center: boolean;
  onPath?: boolean;
  onSelect: (nodeId: string) => void;
}

export type FocusFlowNode = Node<FocusData, 'focus'>;

export const FOCUS_CENTER_SIZE = { width: 264, height: 60 } as const;
export const FOCUS_NODE_SIZE = { width: 224, height: 48 } as const;

const onActivate = (action: () => void) => (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
};

/** The focused node or one of its neighbours. Edges meet the box from outside, so the handles are hidden. */
export const FocusNode = memo(function FocusNode({ id, data }: NodeProps<FocusFlowNode>) {
  const select = () => data.onSelect(id);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${data.type} ${data.name}`}
      aria-pressed={data.center}
      data-xv-entry={data.center ? 'focus-center' : 'focus-neighbour'}
      data-xv-node={id}
      title={`${data.type} ${data.name}`}
      onClick={select}
      onKeyDown={onActivate(select)}
      className={`xv-node relative box-border flex size-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-card border bg-surface px-3.5 shadow-card outline-none focus-visible:ring-2 focus-visible:ring-accent ${data.center ? 'xv-selected border-accent' : 'border-line-2'}`}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: nodeColor(data.type) }} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-ink ${data.center ? 'text-[15px] font-semibold' : 'text-[13.5px] font-medium'}`}>{data.name}</span>
        <span className="truncate text-[11px] text-muted">{data.type}</span>
      </span>
    </div>
  );
});

export const FOCUS_NODE_TYPES = { focus: FocusNode };
