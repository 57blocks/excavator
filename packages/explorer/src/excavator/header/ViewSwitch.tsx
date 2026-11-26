import { useDashboardStore } from "../../store";

const BUTTON = "px-3 py-1 text-xs font-medium rounded-md transition-colors";

/** The Domain | Structural switch; shown only when the page holds a domain graph (and the graph is not a knowledge graph). */
export function ViewSwitch() {
  const hasGraph = useDashboardStore((s) => s.graph !== null);
  const isKnowledgeGraph = useDashboardStore((s) => s.isKnowledgeGraph);
  const hasDomainGraph = useDashboardStore((s) => s.domainGraph !== null);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  if (!hasGraph || isKnowledgeGraph || !hasDomainGraph) return null;
  const choices = [
    ["domain", "Domain"],
    ["structural", "Structural"],
  ] as const;
  return (
    <div className="flex items-center rounded-lg bg-elevated p-0.5" role="group" aria-label="View" data-excavator-view-switch>
      {choices.map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          onClick={() => setViewMode(mode)}
          aria-pressed={viewMode === mode}
          className={`${BUTTON} ${viewMode === mode ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-secondary"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
