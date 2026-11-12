import { useState, type MouseEvent, type ReactNode } from "react";
import { EMPTY, formatNumber } from "../../products/format";
import { footerText, initialSortState, nextSort, PAGE_SIZE, tableView, type SortKey, type SortState } from "../../products/table";

const WIDTHS = { sm: "max-w-[160px]", md: "max-w-[260px]", lg: "max-w-[380px]", xl: "max-w-[520px]" } as const;

export interface Column<T> {
  label: string;
  num?: boolean;
  /** Cut the cell with an ellipsis at this width; its title holds the whole text. */
  width?: keyof typeof WIDTHS;
  key: (row: T) => SortKey;
  title?: (row: T) => string | null | undefined;
  render: (row: T) => ReactNode;
}

/** A cell with no value shows the empty mark. */
const cell = (value: ReactNode): ReactNode => (value === null || value === undefined || value === "" ? <span className="text-text-muted">{EMPTY}</span> : value);

/** A click on a control inside a row (a link, a button) is that control's, not the row's. */
const fromControl = (event: MouseEvent) => event.target instanceof Element && event.target.closest("a, button, input, select, textarea, summary, label") !== null;

const ARROW_UP = String.fromCharCode(0x25b2);
const ARROW_DOWN = String.fromCharCode(0x25bc);

const HEAD = "sticky top-0 z-[1] whitespace-nowrap border-b border-border-subtle bg-elevated px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted";

/** A table that sorts by any column and pages 200 rows at a time; wide tables scroll inside their own box. */
export function DataTable<T>({ rows, columns, initialSort = null, pageSize = PAGE_SIZE, onRowClick, isSelected, rowKey, name }: {
  rows: readonly T[];
  columns: readonly Column<T>[];
  initialSort?: { label: string; dir: 1 | -1 } | null;
  pageSize?: number;
  /** A row can be clicked (or opened with Enter) when this is given. */
  onRowClick?: (row: T) => void;
  isSelected?: (row: T) => boolean;
  rowKey?: (row: T) => string;
  /** Names the table for the smoke checks. */
  name?: string;
}) {
  const [sort, setSort] = useState<SortState>(() => initialSortState(columns.map((c) => c.label), initialSort));
  // The page belongs to the rows it was chosen for: other rows (a new filter) start on the first page.
  const [paging, setPaging] = useState<{ rows: readonly T[]; page: number }>({ rows, page: 1 });
  const requested = paging.rows === rows ? paging.page : 1;
  const keyOf = sort.column < 0 ? null : columns[sort.column].key;
  const { shown, bounds } = tableView(rows, keyOf, sort, requested, pageSize);
  const goto = (page: number) => setPaging({ rows, page });
  const clickable = typeof onRowClick === "function";
  return (
    <div className="min-w-0" data-excavator-table={name}>
      <div className="max-h-[70vh] max-w-full overflow-auto rounded-lg border border-border-subtle">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {columns.map((column, index) => {
                const active = sort.column === index;
                return (
                  <th key={column.label} aria-sort={active ? (sort.dir > 0 ? "ascending" : "descending") : "none"} className={`${HEAD} ${column.num ? "text-right" : "text-left"}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setSort(nextSort(sort, index));
                        goto(1);
                      }}
                      className="cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 font-semibold uppercase tracking-wider transition-colors hover:text-accent"
                    >
                      {column.label + (active ? ` ${sort.dir > 0 ? ARROW_UP : ARROW_DOWN}` : "")}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, rowIndex) => {
              const key = rowKey ? rowKey(row) : undefined;
              const selected = isSelected?.(row) ?? false;
              return (
                <tr
                  key={rowIndex}
                  data-excavator-row={key}
                  data-excavator-row-selected={selected ? "" : undefined}
                  aria-selected={isSelected ? selected : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? (event) => !fromControl(event) && onRowClick?.(row) : undefined}
                  onKeyDown={clickable ? (event) => event.key === "Enter" && event.target === event.currentTarget && onRowClick?.(row) : undefined}
                  className={`${clickable ? "cursor-pointer transition-colors hover:bg-elevated/60" : ""} ${selected ? "bg-accent/10" : ""}`}
                >
                  {columns.map((column) => {
                    const full = column.title ? column.title(row) : null;
                    return (
                      <td
                        key={column.label}
                        title={typeof full === "string" && full !== "" ? full : undefined}
                        className={`whitespace-nowrap border-b border-border-subtle px-3 py-1.5 align-top text-text-secondary ${column.num ? "text-right font-mono tabular-nums" : "text-left"} ${
                          column.width ? `overflow-hidden text-ellipsis ${WIDTHS[column.width]}` : ""
                        }`}
                      >
                        {cell(column.render(row))}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
        <span data-excavator-footer="">{footerText(bounds)}</span>
        <span className="flex items-center gap-2">
          <PagerButton label="Previous" disabled={bounds.page <= 1} onClick={() => goto(bounds.page - 1)} />
          <span>{`Page ${formatNumber(bounds.page)} of ${formatNumber(bounds.pages)}`}</span>
          <PagerButton label="Next" disabled={bounds.page >= bounds.pages} onClick={() => goto(bounds.page + 1)} />
        </span>
      </div>
    </div>
  );
}

function PagerButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md bg-elevated px-3 py-1 text-xs text-text-secondary transition-colors hover:text-accent disabled:cursor-default disabled:opacity-40 disabled:hover:text-text-secondary"
    >
      {label}
    </button>
  );
}

/** A small table that does not sort or page: a header, and rows of cells. */
export function SimpleTable({ columns, rows }: { columns: readonly { label: string; num?: boolean; wrap?: boolean }[]; rows: readonly ReactNode[][] }) {
  return (
    <div className="max-w-full overflow-auto rounded-lg border border-border-subtle">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label} className={`${HEAD} ${c.num ? "text-right" : "text-left"}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {columns.map((c, i) => (
                <td
                  key={c.label}
                  className={`border-b border-border-subtle px-3 py-1.5 align-top text-text-secondary ${c.num ? "text-right font-mono tabular-nums" : "text-left"} ${c.wrap ? "min-w-[200px] [overflow-wrap:anywhere]" : "whitespace-nowrap"}`}
                >
                  {cell(row[i])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
