import { useDashboardStore } from "../../store";
import type { UnusedRow } from "../products/unused";
import { LIST_CLASS, MutedLine, ROW_BUTTON_CLASS } from "./Section";

/** Rows drawn at most; the line under the list says when the product holds more. */
const ROWS_DRAWN = 300;

/** The unused-code candidates, most confident first: name, file and line, confidence. */
export function UnusedList({ rows, onBack }: { rows: readonly UnusedRow[]; onBack: () => void }) {
  const nodesById = useDashboardStore((s) => s.nodesById);
  const navigateToNodeInLayer = useDashboardStore((s) => s.navigateToNodeInLayer);
  const shown = rows.slice(0, ROWS_DRAWN);
  return (
    <div>
      <div className="px-5 pt-3">
        <button type="button" onClick={onBack} className="text-[11px] font-semibold text-gold hover:text-gold-bright">
          {"\u2190 Back"}
        </button>
      </div>
      <section className="px-5 pt-3 pb-2" data-excavator-section="Unused code">
        <h3 className="mb-2 border-b border-border-subtle pb-1 text-[11px] font-semibold uppercase tracking-wider text-accent">Unused code</h3>
        {rows.length === 0 ? (
          <MutedLine>The unused-code product lists no candidates.</MutedLine>
        ) : (
          <ul className={LIST_CLASS} data-excavator-unused-list>
            {shown.map((row) => {
              const where = row.file === null ? "no file" : row.lineRange === null ? row.file : `${row.file}:${row.lineRange[0]}`;
              const body = (
                <>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-xs text-text-primary">{row.name ?? row.id}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-muted">{row.confidence ?? "no confidence"}</span>
                  </span>
                  <span className="block truncate font-mono text-[10px] text-text-muted" title={where}>
                    {where}
                  </span>
                </>
              );
              return (
                <li key={row.id}>
                  {nodesById.has(row.id) ? (
                    <button type="button" className={ROW_BUTTON_CLASS} onClick={() => navigateToNodeInLayer(row.id)}>
                      {body}
                    </button>
                  ) : (
                    <div className="py-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > shown.length && <MutedLine>The list stops here; the unused-code product holds the rest.</MutedLine>}
      </section>
    </div>
  );
}
