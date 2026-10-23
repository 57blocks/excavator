import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { coverageRows } from "../excavator/ourData";

export default function ProjectOverview() {
  const graph = useDashboardStore((s) => s.graph);
  const layerSource = useDashboardStore((s) => s.layerSource);
  const startTour = useDashboardStore((s) => s.startTour);
  const { t } = useI18n();

  if (!graph) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <p className="text-text-muted text-sm">{t.common.loading}</p>
      </div>
    );
  }

  const { project, nodes, edges, layers } = graph;
  const hasTour = graph.tour.length > 0;
  const coverage = coverageRows(graph.coverage);
  const gaps = graph.gaps ?? [];

  const typeCounts: Record<string, number> = {};
  for (const node of nodes) {
    typeCounts[node.type] = (typeCounts[node.type] ?? 0) + 1;
  }

  const complexityCounts: Record<string, number> = { simple: 0, moderate: 0, complex: 0 };
  for (const node of nodes) {
    if (node.complexity) {
      complexityCounts[node.complexity] = (complexityCounts[node.complexity] ?? 0) + 1;
    }
  }

  const nodeConnections = new Map<string, number>();
  for (const edge of edges) {
    nodeConnections.set(edge.source, (nodeConnections.get(edge.source) ?? 0) + 1);
    nodeConnections.set(edge.target, (nodeConnections.get(edge.target) ?? 0) + 1);
  }
  const topNodes = Array.from(nodeConnections.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nodeId, count]) => {
      const node = nodes.find((n) => n.id === nodeId);
      return { id: nodeId, name: node?.name ?? nodeId, count };
    });

  const avgConnections = nodes.length > 0 ? (edges.length * 2 / nodes.length).toFixed(1) : "0";

  const categoryBreakdown = [
    { label: t.projectOverview.code, color: "var(--color-node-file)", count: (typeCounts["file"] ?? 0) + (typeCounts["function"] ?? 0) + (typeCounts["class"] ?? 0) + (typeCounts["module"] ?? 0) + (typeCounts["concept"] ?? 0) },
    { label: t.projectOverview.config, color: "var(--color-node-config)", count: typeCounts["config"] ?? 0 },
    { label: t.projectOverview.docs, color: "var(--color-node-document)", count: typeCounts["document"] ?? 0 },
    { label: t.projectOverview.infra, color: "var(--color-node-service)", count: (typeCounts["service"] ?? 0) + (typeCounts["resource"] ?? 0) + (typeCounts["pipeline"] ?? 0) },
    { label: t.projectOverview.data, color: "var(--color-node-table)", count: (typeCounts["table"] ?? 0) + (typeCounts["endpoint"] ?? 0) + (typeCounts["schema"] ?? 0) },
    { label: t.projectOverview.domain, color: "var(--color-node-concept)", count: (typeCounts["domain"] ?? 0) + (typeCounts["flow"] ?? 0) + (typeCounts["step"] ?? 0) },
  ];
  const hasNonCodeNodes = categoryBreakdown.some((c) => c.label !== t.projectOverview.code && c.count > 0);

  return (
    <div className="h-full w-full overflow-auto p-5 animate-fade-slide-in">
      {/* Project name */}
      <h2 className="font-heading text-2xl text-text-primary mb-1">{project.name}</h2>
      <p className="text-sm text-text-secondary leading-relaxed mb-6">{project.description}</p>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
          <div className="text-2xl font-mono font-medium text-accent">{nodes.length}</div>
          <div className="text-[11px] text-text-muted uppercase tracking-wider mt-1">{t.projectOverview.nodes}</div>
        </div>
        <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
          <div className="text-2xl font-mono font-medium text-accent">{edges.length}</div>
          <div className="text-[11px] text-text-muted uppercase tracking-wider mt-1">{t.projectOverview.edges}</div>
        </div>
        <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
          <div className="text-2xl font-mono font-medium text-accent">{layers.length}</div>
          <div className="text-[11px] text-text-muted uppercase tracking-wider mt-1">{layerSource === "graph" ? t.projectOverview.layers : t.projectOverview.groups}</div>
        </div>
        <div className="bg-elevated rounded-lg p-3 border border-border-subtle">
          <div className="text-2xl font-mono font-medium text-accent">{Object.keys(typeCounts).length}</div>
          <div className="text-[11px] text-text-muted uppercase tracking-wider mt-1">{t.projectOverview.types}</div>
        </div>
      </div>

      {/* File Types breakdown */}
      {hasNonCodeNodes && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">{t.projectOverview.fileTypes}</h3>
          <div className="space-y-1.5">
            {categoryBreakdown.filter((c) => c.count > 0).map((cat) => (
              <div key={cat.label} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="text-xs text-text-secondary flex-1">{cat.label}</span>
                <span className="text-xs font-mono text-text-muted">{cat.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Languages */}
      {project.languages.length > 0 && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">{t.projectOverview.languages}</h3>
          <div className="flex flex-wrap gap-1.5">
            {project.languages.map((lang) => (
              <span key={lang} className="text-[11px] glass text-text-secondary px-2.5 py-1 rounded-full">
                {lang}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Frameworks */}
      {project.frameworks.length > 0 && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">{t.projectOverview.frameworks}</h3>
          <div className="flex flex-wrap gap-1.5">
            {project.frameworks.map((fw) => (
              <span key={fw} className="text-[11px] glass text-text-secondary px-2.5 py-1 rounded-full">
                {fw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Node Type Breakdown */}
      <div className="mb-5">
        <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-3">{t.projectOverview.nodeTypeDistribution}</h3>
        <div className="space-y-2">
          {Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => {
              const percentage = ((count / nodes.length) * 100).toFixed(0);
              return (
                <div key={type}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-text-secondary capitalize">{type}</span>
                    <span className="text-text-muted font-mono">{count} ({percentage}%)</span>
                  </div>
                  <div className="w-full h-1.5 bg-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent/50 rounded-full transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Complexity Breakdown */}
      {Object.values(complexityCounts).some((c) => c > 0) && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-3">{t.projectOverview.complexityDistribution}</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-elevated rounded-lg p-2 border border-border-subtle text-center">
              <div className="text-lg font-mono font-medium text-green-400">{complexityCounts.simple}</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">{t.projectOverview.simple}</div>
            </div>
            <div className="bg-elevated rounded-lg p-2 border border-border-subtle text-center">
              <div className="text-lg font-mono font-medium text-yellow-400">{complexityCounts.moderate}</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">{t.projectOverview.moderate}</div>
            </div>
            <div className="bg-elevated rounded-lg p-2 border border-border-subtle text-center">
              <div className="text-lg font-mono font-medium text-red-400">{complexityCounts.complex}</div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">{t.projectOverview.complex}</div>
            </div>
          </div>
        </div>
      )}

      {/* Top Connected Nodes */}
      {topNodes.length > 0 && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-3">{t.projectOverview.mostConnectedNodes}</h3>
          <div className="space-y-2">
            {topNodes.map((node, idx) => (
              <div
                key={node.id}
                className="flex items-center gap-2 text-xs bg-elevated rounded-lg p-2 border border-border-subtle"
              >
                <div className="w-5 h-5 shrink-0 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent">
                  {idx + 1}
                </div>
                <span className="flex-1 text-text-primary truncate">{node.name}</span>
                <span className="text-text-muted font-mono shrink-0">{node.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Average Connections */}
      <div className="mb-5 bg-elevated rounded-lg p-3 border border-border-subtle">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-secondary">{t.projectOverview.avgConnectionsPerNode}</span>
          <span className="text-lg font-mono font-medium text-accent">{avgConnections}</span>
        </div>
      </div>

      {/* Excavator: what the extraction read, per language */}
      {coverage.length > 0 && (
        <div className="mb-5" data-excavator="coverage">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-3">
            {t.projectOverview.coverage} ({graph.coverage?.files} {t.projectOverview.coverageFiles})
          </h3>
          <div className="space-y-1.5">
            {coverage.map((row) => (
              <div key={row.language} className="text-xs bg-elevated rounded-lg px-3 py-2 border border-border-subtle">
                <div className="flex items-center justify-between">
                  <span className="text-text-primary">{row.language}</span>
                  <span className="text-text-muted font-mono">
                    {row.files} {t.projectOverview.coverageFiles} · {row.parsed} {t.projectOverview.parsed}
                    {row.zeroSymbol > 0 && <> · {row.zeroSymbol} {t.projectOverview.zeroSymbol}</>}
                  </span>
                </div>
                {row.skipped.length > 0 && (
                  <div className="text-[10px] text-text-muted mt-0.5">
                    {t.projectOverview.skipped}: {row.skipped.map(([reason, count]) => `${reason} ${count}`).join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Excavator: the facts the extraction could not settle */}
      {gaps.length > 0 && (
        <div className="mb-5" data-excavator="gaps">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-3">
            {t.projectOverview.gaps} ({gaps.length})
          </h3>
          <div className="space-y-1.5">
            {gaps.map((gap, i) => (
              <div key={i} className="text-xs bg-elevated rounded-lg px-3 py-2 border border-border-subtle">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-primary font-mono truncate">{gap.kind}{gap.scope ? ` · ${gap.scope}` : ""}</span>
                  {gap.count !== undefined && <span className="text-text-muted font-mono shrink-0">{gap.count}</span>}
                </div>
                {gap.reason && <div className="text-[11px] text-text-secondary mt-0.5">{gap.reason}</div>}
                {gap.samples && gap.samples.length > 0 && (
                  <ul className="text-[10px] text-text-muted font-mono mt-1 space-y-0.5">
                    {gap.samples.map((sample) => <li key={sample} className="truncate" title={sample}>{sample}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Analyzed at */}
      <div className="text-[11px] text-text-muted mb-6">
        {t.common.analyzed}: {new Date(project.analyzedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
      </div>

      {/* Start Tour button */}
      {hasTour && (
        <button
          onClick={startTour}
          className="w-full bg-accent/10 border border-accent/30 text-accent text-sm font-medium py-2.5 px-4 rounded-lg hover:bg-accent/20 transition-all duration-200"
        >
          {t.common.startGuidedTour}
        </button>
      )}
    </div>
  );
}
