import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";

export interface BandHeadingData extends Record<string, unknown> {
  label: string;
}

export type BandHeadingFlowNode = Node<BandHeadingData, "band-heading">;

/** Plain text heading of a domain band; not selectable, not draggable, no handles. */
function BandHeadingNode({ data }: NodeProps<BandHeadingFlowNode>) {
  return (
    <div className="font-heading text-xs uppercase tracking-wider text-text-muted border-b border-border-subtle pb-1 w-full h-full flex items-end select-none">
      {data.label}
    </div>
  );
}

export default memo(BandHeadingNode);
