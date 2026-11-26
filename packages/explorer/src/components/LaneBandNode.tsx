import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";

export type LaneBandFlowNode = Node<Record<string, unknown>, "lane-band">;

/** The separator under one swimlane row: a one pixel line in the border colour across the full width, with no fill. */
function LaneBandNode(_props: NodeProps<LaneBandFlowNode>) {
  return <div className="w-full h-full border-b border-border-subtle pointer-events-none" data-excavator-lane-band />;
}

export default memo(LaneBandNode);
