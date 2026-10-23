import type { ReactNode } from "react";
import { formatNumber } from "../../products/format";

/**
 * A statistic of a product view: the project overview's tile (accent mono number over an
 * uppercase label), with a line below saying what it counts. A value that is not a
 * finite number shows as the empty mark, never 0.
 */
export function StatTile({ label, value, note }: { label: string; value: unknown; note?: ReactNode }) {
  const finite = typeof value === "number" && Number.isFinite(value);
  return (
    <div data-excavator-stat={label} className="min-w-0 rounded-lg border border-border-subtle bg-elevated p-3">
      <div data-excavator-stat-value={finite ? String(Math.round(value as number)) : ""} className="text-2xl font-mono font-medium text-accent [overflow-wrap:anywhere]">
        {formatNumber(value)}
      </div>
      <div className="mt-1 truncate text-[11px] text-text-muted uppercase tracking-wider">{label}</div>
      {note ? <div className="mt-0.5 text-xs text-text-secondary">{note}</div> : null}
    </div>
  );
}

export function StatTiles({ children }: { children?: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/** A small count: label and value, for the folded "all counts". */
export function CountTile({ label, value }: { label: ReactNode; value: unknown }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-subtle bg-elevated px-3 py-2">
      <div className="text-lg font-mono text-text-primary [overflow-wrap:anywhere]">{formatNumber(value)}</div>
      <div className="text-[10px] text-text-muted uppercase tracking-wider">{label}</div>
    </div>
  );
}

export function CountTiles({ children }: { children?: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{children}</div>;
}
