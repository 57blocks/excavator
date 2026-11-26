import { useMemo, useState } from "react";
import type { GraphIssue } from "../../core/schema";
import { useDashboardStore } from "../../store";
import type { DashboardFreshnessReport } from "../../freshness";
import { buildStatusLine } from "../statusLine";
import { usePageStatus } from "./usePageStatus";

/**
 * The one line at the bottom of the right panel: which products the page holds and in what state.
 * "Details" opens the longer lines above it. Muted; a small amber dot marks a line that needs a look.
 */
export function StatusLine({ freshness, issues }: { freshness: DashboardFreshnessReport | null; issues: readonly GraphIssue[] }) {
  const { manifest, products } = usePageStatus();
  const gaps = useDashboardStore((s) => s.graph?.gaps);
  const coverage = useDashboardStore((s) => s.graph?.coverage);
  const nameTable = useDashboardStore((s) => s.nameTranslations);
  const groupsNote = useDashboardStore((s) => (s.featureGroups.state === "ready" ? s.featureGroups.projectReason : null));
  const [open, setOpen] = useState(false);
  const line = useMemo(
    () => buildStatusLine({ manifest, products, freshness, issues, gaps, coverage, nameTable, groupsNote }),
    [manifest, products, freshness, issues, gaps, coverage, nameTable, groupsNote],
  );
  return (
    <div className="shrink-0 border-t border-border-subtle bg-surface" data-excavator-status-line>
      {open && line.details.length > 0 && (
        <ul className="m-0 max-h-[40vh] list-none divide-y divide-border-subtle overflow-auto p-0 px-5 text-[11px] text-text-muted">
          {line.details.map((detail, index) => (
            <li key={index} className="py-1.5 [overflow-wrap:anywhere]">
              {detail}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-start gap-2 px-5 py-2 text-[11px] text-text-muted">
        {line.attention && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />}
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]" data-excavator-status-summary>
          {line.summary}
        </span>
        {line.details.length > 0 && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="shrink-0 text-accent hover:text-accent-bright">
            Details
          </button>
        )}
      </div>
    </div>
  );
}
