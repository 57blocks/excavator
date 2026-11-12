import { cloneElement } from 'react';
import type { ReactNode } from 'react';

import { PAGE_SIZE, Pager, bodyOf, nodesOf, usePage } from './ui/Pager';

/**
 * A table that scrolls inside its own box, so a wide table never widens the
 * page; a `wide` table (three or more columns) keeps a minimum width, so its
 * columns stay readable and the box scrolls. The box is focusable (and named) so the keyboard can scroll it. A table
 * with more than 200 body rows is shown 200 rows at a time, the head kept, with the page controls under the box.
 */
export function TableScroll({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  const nodes = nodesOf(children);
  const body = bodyOf(nodes);
  const rows = body === undefined ? [] : nodesOf(body.props.children);
  const paging = usePage(rows.length);
  const paged = body !== undefined && rows.length > PAGE_SIZE;
  const shown = paged ? nodes.map((node) => (node === body ? cloneElement(body, undefined, rows.slice(paging.start, paging.end)) : node)) : children;
  return (
    <>
      <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
        <table className="data-table" data-wide={wide ? 'true' : undefined}>{shown}</table>
      </div>
      {paged && <Pager total={rows.length} {...paging} />}
    </>
  );
}

/** A cell that may be empty; `col` says what the column holds: `text` (a sentence or more, kept at a readable width) or `short` (a word or number, never broken): an empty one shows a dash drawn by the stylesheet, not text. */
export function Cell({ children, row = false, col }: { children?: ReactNode; row?: boolean; col?: 'text' | 'short' }) {
  const empty = children === undefined || children === null || children === false;
  const props = { 'data-empty': empty ? 'true' : undefined, 'data-col': col } as const;
  return row ? <th scope="row" {...props}>{children}</th> : <td {...props}>{children}</td>;
}
