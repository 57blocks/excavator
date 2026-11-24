import type { GraphIssue } from "../../core/schema";
import NodeInfo from "../../components/NodeInfo";
import { useDashboardStore } from "../../store";
import type { DashboardFreshnessReport } from "../../freshness";
import { PanelBack } from "./PanelBack";
import { PanelBoundary } from "./PanelBoundary";
import { OverviewPanel } from "./OverviewPanel";
import { StatusLine } from "./StatusLine";

/** The right panel's content: the selected node, else the overview, with the status line fixed at the bottom. */
export function SidePanel({ freshness, issues }: { freshness: DashboardFreshnessReport | null; issues: readonly GraphIssue[] }) {
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const activeDomainId = useDashboardStore((s) => s.activeDomainId);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  // A selection that is not a node of the graph (a layer card, a folder box) shows the overview, not an empty node panel.
  const isNode = selectedNodeId !== null && (viewMode === "domain" ? (domainGraph?.nodes.some((n) => n.id === selectedNodeId) ?? false) : nodesById.has(selectedNodeId));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto"><PanelBack /><PanelBoundary resetKey={`${viewMode}|${activeDomainId ?? ""}|${selectedNodeId ?? ""}`}>{isNode ? <NodeInfo /> : <OverviewPanel />}</PanelBoundary></div>
      <StatusLine freshness={freshness} issues={issues} />
    </div>
  );
}
