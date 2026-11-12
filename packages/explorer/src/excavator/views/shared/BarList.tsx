import { barLengths } from "../../products/charts";
import type { BarRow } from "../../products/bar-row";
import { formatNumber } from "../../products/format";

/**
 * Horizontal bars with their values, drawn as divs in the project overview's style: each
 * bar is as long as its value over the largest, so the largest fills the track and 0
 * draws nothing. `onSelect` makes each row a button.
 */
export function BarList({ rows, label, onSelect }: { rows: readonly BarRow[]; label: string; onSelect?: (row: BarRow) => void }) {
  const lengths = barLengths(rows.map((row) => row.value), 100);
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((row, i) => {
        const content = (
          <>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-text-secondary" title={row.label}>{row.label}</span>
              <span className="shrink-0 font-mono text-text-muted">{formatNumber(row.value)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
              <div
                data-excavator-bar={row.key}
                className="h-full rounded-full"
                style={{ width: `${lengths[i]}%`, backgroundColor: row.colour ?? "color-mix(in srgb, var(--color-accent) 55%, transparent)" }}
              />
            </div>
          </>
        );
        return (
          <li key={row.key} data-excavator-bar-row={row.key}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(row)} className="block w-full cursor-pointer rounded px-1 py-0.5 text-left transition-colors hover:bg-elevated">
                {content}
              </button>
            ) : (
              <div className="px-1 py-0.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
