import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useDashboardStore } from "../store";

export interface DomainClusterData extends Record<string, unknown> {
  label: string;
  /** Excavator: the English name when `label` is its translation; shown on hover. */
  original?: string | null;
  summary: string;
  domainId: string;
}

/** Every overview card has this size, so the grid stays aligned; the text inside is clamped, never grown. */
export const DOMAIN_CARD_WIDTH = 320;
export const DOMAIN_CARD_HEIGHT = 140;

export type DomainClusterFlowNode = Node<DomainClusterData, "domain-cluster">;

function DomainClusterNode({ data }: NodeProps<DomainClusterFlowNode>) {
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const isSelected = selectedNodeId === data.domainId;

  return (
    <div
      style={{ width: DOMAIN_CARD_WIDTH, height: DOMAIN_CARD_HEIGHT }}
      className={`rounded-xl border-2 px-5 py-4 cursor-pointer transition-all ${
        isSelected
          ? "border-accent bg-accent/10 shadow-lg shadow-accent/10"
          : "border-accent/40 bg-surface hover:border-accent/70"
      }`}
      onClick={() => selectNode(data.domainId)}
      onDoubleClick={() => navigateToDomain(data.domainId)}
    >
      <Handle type="target" position={Position.Left} className="!bg-accent/60 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-accent/60 !w-2 !h-2" />

      <div className="h-full overflow-hidden">
      <div
        className="font-heading text-sm text-accent font-semibold mb-1 truncate"
        title={data.original ? `English: ${data.original}` : undefined}
      >
        {data.label}
      </div>
      <div className="text-[11px] text-text-secondary line-clamp-4">
        {data.summary}
      </div>
      </div>
    </div>
  );
}

export default memo(DomainClusterNode);
