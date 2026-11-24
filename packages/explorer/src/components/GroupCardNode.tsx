import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { useDashboardStore } from "../store";
import GroupName from "./GroupName";

export interface GroupCardData extends Record<string, unknown> {
  groupId: string;
  label: string;
  /** The English name when `label` is its translation. */
  original?: string | null;
  /** The caller file suffix of a client group whose label another group shares. */
  qualifier?: string | null;
  flowCount: number;
  /** Up to three example entries of the group's first flows, one line each. */
  examples: string[];
}

export type GroupCardFlowNode = Node<GroupCardData, "group-card">;

/** Every group card has this size, so the grid stays aligned; text inside is clamped, never grown. */
export const GROUP_CARD_WIDTH = 320;
export const GROUP_CARD_HEIGHT = 150;

function GroupCardNode({ data }: NodeProps<GroupCardFlowNode>) {
  const selected = useDashboardStore((s) => s.selectedGroupId === data.groupId);
  return (
    <div
      style={{ width: GROUP_CARD_WIDTH, height: GROUP_CARD_HEIGHT }}
      className={`rounded-xl border-2 px-5 py-3 cursor-pointer transition-all ${
        selected ? "border-accent bg-accent/10 shadow-lg shadow-accent/10" : "border-accent/40 bg-surface hover:border-accent/70"
      }`}
      data-excavator-group-card={data.groupId}
    >
      <div className="h-full overflow-hidden">
        <div className="font-heading text-sm text-accent font-semibold truncate">
          <GroupName label={data.label} qualifier={data.qualifier} />
        </div>
        {data.original && <div className="text-[10px] text-text-muted truncate">{data.original}</div>}
        <div className="text-[11px] text-text-secondary mt-1">{data.flowCount} flows</div>
        <ul className="mt-1 space-y-0.5">
          {data.examples.slice(0, 3).map((example, index) => (
            <li key={index} className="text-[10px] text-text-muted truncate">
              {example}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default memo(GroupCardNode);
