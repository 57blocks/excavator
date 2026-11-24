import type { GraphIssue } from "../../core/schema";
import NodeInfo from "../../components/NodeInfo";
import { useDashboardStore } from "../../store";
import type { DashboardFreshnessReport } from "../../freshness";
import { OverviewPanel } from "./OverviewPanel";
import { StatusLine } from "./StatusLine";

/** The right panel's content: the selected node, else the overview, with the status line fixed at the bottom. */
export function SidePanel({ freshness, issues }: { freshness: DashboardFreshnessReport | null; issues: readonly GraphIssue[] }) {
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">{selectedNodeId ? <NodeInfo /> : <OverviewPanel />}</div>
      <StatusLine freshness={freshness} issues={issues} />
    </div>
  );
}
