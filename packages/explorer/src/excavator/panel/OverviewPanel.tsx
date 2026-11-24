import { shownViewMode, useDashboardStore } from "../../store";
import { DomainOverview } from "./DomainOverview";
import { StructuralOverview } from "./StructuralOverview";

/** What the right panel shows when no node is selected: the domain overview in the domain view, else the structural one. */
export function OverviewPanel() {
  const mode = useDashboardStore(shownViewMode);
  const hasDomainGraph = useDashboardStore((s) => s.domainGraph !== null);
  return mode === "domain" && hasDomainGraph ? <DomainOverview /> : <StructuralOverview />;
}
