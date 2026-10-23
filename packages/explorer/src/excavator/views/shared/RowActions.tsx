import { useMemo } from "react";
import { hasInlineSource } from "../../../offline/inlineData";
import { useDashboardStore } from "../../../store";
import { codeAction } from "../codeAction";
import { containersOf, locate, type GraphTarget } from "../graphTarget";

/**
 * The two moves of a row's details: "Show in graph" and "Open code" (openspec:
 * changes/explorer-products, design D4). Each says in words when it cannot: the node
 * is not in the graph, a directory has no single node, the source is not in the page.
 */
export function RowActions({ target, path, range }: { target: GraphTarget | null; path: string | null; range?: unknown }) {
  const graph = useDashboardStore((s) => s.graph);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const navigateToNodeInLayer = useDashboardStore((s) => s.navigateToNodeInLayer);
  const openCodeViewerAt = useDashboardStore((s) => s.openCodeViewerAt);
  const nodeIdToLayerId = useDashboardStore((s) => s.nodeIdToLayerId);
  const index = useMemo(
    () => ({ nodeIds: new Set((graph?.nodes ?? []).map((n) => n.id)), drawn: new Set(nodeIdToLayerId.keys()), parentOf: containersOf(graph?.edges ?? []) }),
    [graph, nodeIdToLayerId],
  );
  const located = target === null ? null : locate(target, index);
  const code = codeAction(path, range, (p) => hasInlineSource(p));

  const showInGraph = (nodeId: string) => {
    // The domain view has no file nodes: go back to the structural graph first (this also closes the product view).
    if (viewMode === "domain") setViewMode("structural");
    navigateToNodeInLayer(nodeId);
  };

  return (
    <div data-excavator-row-actions="" className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {located?.kind === "node" || located?.kind === "container" ? <ActionButton name="show-in-graph" onClick={() => showInGraph(located.nodeId)}>Show in graph</ActionButton> : null}
        {code.state === "available" ? <ActionButton name="open-code" onClick={() => openCodeViewerAt(code.path, code.range)}>Open code</ActionButton> : null}
      </div>
      {located?.kind === "message" ? <p data-excavator-note="graph" className="text-xs text-text-muted">{located.message}</p> : null}
      {located?.kind === "container" ? <p data-excavator-note="container" className="text-xs text-text-muted [overflow-wrap:anywhere]">{`The structural graph does not draw this node; Show in graph selects ${located.nodeId}, which contains it.`}</p> : null}
      {code.state === "unavailable" ? <p data-excavator-note="code" className="text-xs text-text-muted">{code.message}</p> : null}
    </div>
  );
}

function ActionButton({ name, onClick, children }: { name: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-excavator-action={name}
      className="whitespace-nowrap rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
    >
      {children}
    </button>
  );
}
