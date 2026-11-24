import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useDashboardStore } from "../store";
import GroupName from "./GroupName";

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  /** Excavator: the English name when `label` is its translation; shown on hover. */
  original?: string | null;
  summary: string;
  flowId: string;
  /** Small word tags: the route scope and, in the Other group, the label the flow had before it was moved. */
  tags?: { label: string; qualifier?: string | null }[];
}

/** The swimlane's flow card has this size. */
export const FLOW_CARD_WIDTH = 260;
export const FLOW_CARD_HEIGHT = 110;

export type FlowFlowNode = Node<FlowNodeData, "flow-node">;

function FlowNode({ data }: NodeProps<FlowFlowNode>) {
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const isSelected = selectedNodeId === data.flowId;

  return (
    <div
      style={{ width: FLOW_CARD_WIDTH, height: FLOW_CARD_HEIGHT }}
      className={`rounded-lg border px-4 py-3 cursor-pointer transition-all ${
        isSelected
          ? "border-accent bg-accent/10"
          : "border-border-medium bg-surface hover:border-accent/50"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-accent/60 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-accent/60 !w-2 !h-2" />

      <div className="h-full overflow-hidden">
      <div
        className="text-xs font-semibold text-text-primary mb-1 truncate"
        title={data.original ? `English: ${data.original}` : undefined}
      >
        {data.label}
      </div>
      <div className="text-[10px] text-text-secondary line-clamp-2">
        {data.summary}
      </div>
      {data.tags && data.tags.length > 0 && (
        <div className="mt-1 flex gap-1 overflow-hidden">
          {data.tags.map((tag) => (
            <span key={`${tag.label}|${tag.qualifier ?? ""}`} className="text-[9px] px-1.5 rounded bg-elevated text-text-muted truncate">
              <GroupName label={tag.label} qualifier={tag.qualifier} />
            </span>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

export default memo(FlowNode);
