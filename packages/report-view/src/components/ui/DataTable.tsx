import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { pageOfRow } from '../../lib/detail-rows';
import { formatNumber } from '../../lib/format';
import { staggerDelay } from '../../lib/motion';
import { footerText, initialSortState, nextSort, PAGE_SIZE, tableView, type SortKey, type SortState } from '../../lib/table';
import { cellContent } from './Cell';

/** How long a row that a link led to stays highlighted. */
export const FLASH_MS = 1600;

/** A click on a control inside a row (a link, a button) is that control's, not the row's. */
const fromControl = (event: MouseEvent) => event.target instanceof Element && event.target.closest('a, button, input, select, textarea, summary, label') !== null;

const WIDTHS = {
  sm: 'max-w-[160px]',
  md: 'max-w-[260px]',
  lg: 'max-w-[380px]',
  xl: 'max-w-[560px]',
} as const;

export interface Column<T> {
  label: string;
  num?: boolean;
  /** Cut the cell with an ellipsis at this width; its title holds the whole text. */
  width?: keyof typeof WIDTHS;
  key: (row: T) => SortKey;
  title?: (row: T) => string | null | undefined;
  render: (row: T) => ReactNode;
}

interface Props<T> {
  rows: readonly T[];
  columns: readonly Column<T>[];
  /** Start sorted by the column with this label (rows without a key come last either way). */
  initialSort?: { label: string; dir: 1 | -1 } | null;
  pageSize?: number;
  /** A row can be clicked (or opened with Enter) when this is given. */
  onRowClick?: (row: T) => void;
  isSelected?: (row: T) => boolean;
  /** The key that names a row in a link (`row=`); each row carries it as `data-xv-row`. */
  rowKey?: (row: T) => string;
  /**
   * The key of a row to bring into view: the table turns to the page that holds it under the current sort,
   * scrolls to it and highlights it briefly. The caller passes it only when the row is among `rows`.
   */
  focusKey?: string | null;
}

const ARROW_UP = String.fromCharCode(0x25b2);
const ARROW_DOWN = String.fromCharCode(0x25bc);

/** A table that sorts by any column and pages 200 rows at a time. Sorting and paging act on every row handed in. */
export function DataTable<T>({ rows, columns, initialSort = null, pageSize = PAGE_SIZE, onRowClick, isSelected, rowKey, focusKey = null }: Props<T>) {
  const [sort, setSort] = useState<SortState>(() => initialSortState(columns.map((c) => c.label), initialSort));
  // The page belongs to the rows it was chosen for: other rows (a new filter) start on the first page.
  const [paging, setPaging] = useState<{ rows: readonly T[]; page: number }>({ rows, page: 1 });
  const requested = paging.rows === rows ? paging.page : 1;
  const keyOf = sort.column < 0 ? null : columns[sort.column].key;
  const { shown, bounds } = tableView(rows, keyOf, sort, requested, pageSize);
  const goto = (page: number) => setPaging({ rows, page });

  // The rows enter one after another on the table's first paint only, the first twelve 30 ms apart and the rest with
  // the twelfth (lib/motion's stagger); the CSS skips it with reduced motion.
  const firstPaint = useRef(true);
  useEffect(() => {
    firstPaint.current = false;
  }, []);
  const stagger = firstPaint.current;

  const box = useRef<HTMLDivElement | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // The row the reader clicked is already in view: opening it does not scroll or flash the table.
  const clicked = useRef<string | null>(null);
  const choose = (row: T) => {
    clicked.current = rowKey ? rowKey(row) : null;
    onRowClick?.(row);
  };
  useEffect(() => {
    if (focusKey === null || !rowKey) return undefined;
    if (clicked.current === focusKey) {
      clicked.current = null;
      return undefined;
    }
    const found = pageOfRow(rows, keyOf, sort, (row) => rowKey(row) === focusKey, pageSize);
    if (found === null) return undefined;
    setPaging({ rows, page: found.page });
    setFlash(focusKey);
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
    // Only a new key moves the table: sorting or paging afterwards is the reader's.
  }, [focusKey]);
  useEffect(() => {
    if (flash === null) return;
    const target = [...(box.current?.querySelectorAll('[data-xv-row]') ?? [])].find((el) => el.getAttribute('data-xv-row') === flash);
    target?.scrollIntoView({ block: 'center' });
  }, [flash, bounds.page]);

  return (
    <div className="min-w-0" ref={box}>
      <div className="max-h-[70vh] max-w-full overflow-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {columns.map((column, index) => {
                const active = sort.column === index;
                return (
                  <th
                    key={column.label}
                    aria-sort={active ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
                    className={`sticky top-0 whitespace-nowrap border-b border-line bg-paper-2 px-3 py-[5px] font-semibold text-ink ${column.num ? 'text-right' : 'text-left'}`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSort(nextSort(sort, index));
                        goto(1);
                      }}
                      className="cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 font-semibold hover:text-accent"
                    >
                      {column.label + (active ? ` ${sort.dir > 0 ? ARROW_UP : ARROW_DOWN}` : '')}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, rowIndex) => {
              const clickable = typeof onRowClick === 'function';
              const key = rowKey ? rowKey(row) : undefined;
              const selected = isSelected?.(row) ?? false;
              return (
                <tr
                  key={rowIndex}
                  data-xv-row={key}
                  data-xv-row-selected={selected ? '' : undefined}
                  data-xv-row-flash={key !== undefined && key === flash ? '' : undefined}
                  aria-selected={isSelected ? selected : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? (event) => !fromControl(event) && choose(row) : undefined}
                  onKeyDown={clickable ? (event) => event.key === 'Enter' && event.target === event.currentTarget && choose(row) : undefined}
                  style={stagger ? { animationDelay: `${staggerDelay(rowIndex)}s` } : undefined}
                  className={`${stagger ? 'xv-row-in' : ''} ${clickable ? 'xv-row-click cursor-pointer hover:[&>td]:bg-paper' : ''} ${selected ? '[&>td]:bg-highlight' : ''} ${key !== undefined && key === flash ? 'xv-row-flash' : ''}`}
                >
                  {columns.map((column) => {
                    const full = column.title ? column.title(row) : null;
                    return (
                      <td
                        key={column.label}
                        title={typeof full === 'string' && full !== '' ? full : undefined}
                        className={`whitespace-nowrap border-b border-line px-3 py-[5px] align-top leading-5 ${column.num ? 'text-right tabular-nums' : 'text-left'} ${
                          column.width ? `overflow-hidden text-ellipsis ${WIDTHS[column.width]}` : ''
                        }`}
                      >
                        {cellContent(column.render(row))}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted" data-xv-footer="">
          {footerText(bounds)}
        </span>
        <span className="flex items-center gap-2.5">
          <PagerButton label="Previous" disabled={bounds.page <= 1} onClick={() => goto(bounds.page - 1)} />
          <span className="text-muted">{`Page ${formatNumber(bounds.page)} of ${formatNumber(bounds.pages)}`}</span>
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
      className="cursor-pointer rounded-full border border-line-2 bg-surface px-3.5 py-[3px] text-ink-soft disabled:cursor-default disabled:text-muted disabled:opacity-60"
    >
      {label}
    </button>
  );
}

/** A small table that does not sort or page: a header, and rows of cells. */
export function SimpleTable({ columns, rows }: { columns: readonly { label: string; num?: boolean; wrap?: boolean }[]; rows: readonly ReactNode[][] }) {
  return (
    <div className="max-w-full overflow-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label} className={`sticky top-0 whitespace-nowrap border-b border-line bg-paper-2 px-3 py-2 font-semibold text-ink ${c.num ? 'text-right' : 'text-left'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {columns.map((c, i) => (
                <td key={c.label} className={`border-b border-line px-3 py-2 align-top ${c.num ? 'text-right tabular-nums' : 'text-left'} ${c.wrap ? 'min-w-[200px] [overflow-wrap:anywhere]' : ''}`}>
                  {cellContent(row[i])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
