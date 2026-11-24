import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useDashboardStore } from "../store";

export interface StepNodeData extends Record<string, unknown> {
  label: string;
  /** Excavator: the English name when `label` is its translation; shown on hover. */
  original?: string | null;
  summary: string;
  stepId: string;
  order: number;
}

/** The swimlane's step card has this size. */
export const STEP_CARD_WIDTH = 200;
export const STEP_CARD_HEIGHT = 96;

export type StepFlowNode = Node<StepNodeData, "step-node">;

function StepNode({ data }: NodeProps<StepFlowNode>) {
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const isSelected = selectedNodeId === data.stepId;

  return (
    <div
      style={{ width: STEP_CARD_WIDTH, height: STEP_CARD_HEIGHT }}
      className={`rounded-lg border px-3 py-2.5 cursor-pointer transition-all ${
        isSelected
          ? "border-accent bg-accent/10"
          : "border-border-subtle bg-elevated hover:border-accent/40"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-text-muted/40 !w-1.5 !h-1.5" />
      <Handle type="source" position={Position.Right} className="!bg-text-muted/40 !w-1.5 !h-1.5" />

      <div className="h-full overflow-hidden">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[9px] font-mono text-accent/60 shrink-0">
          {data.order}
        </span>
        <span
          className="text-[11px] font-medium text-text-primary truncate"
          title={data.original ? `English: ${data.original}` : undefined}
        >
          {data.label}
        </span>
      </div>
      <div className="text-[10px] text-text-secondary line-clamp-2">
        {data.summary}
      </div>
      </div>
    </div>
  );
}

export default memo(StepNode);
