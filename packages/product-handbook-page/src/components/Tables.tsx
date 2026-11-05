import type { ReactNode } from 'react';

/**
 * A table that scrolls inside its own box, so a wide table never widens the
 * page; a `wide` table (three or more columns) keeps a minimum width, so its
 * columns stay readable and the box scrolls. The box is focusable (and named) so the keyboard can scroll it.
 */
export function TableScroll({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="data-table" data-wide={wide ? 'true' : undefined}>{children}</table>
    </div>
  );
}

/** A cell that may be empty: an empty one shows a dash drawn by the stylesheet, not text. */
export function Cell({ children, row = false }: { children?: ReactNode; row?: boolean }) {
  const empty = children === undefined || children === null || children === false;
  const props = { 'data-empty': empty ? 'true' : undefined } as const;
  return row ? <th scope="row" {...props}>{children}</th> : <td {...props}>{children}</td>;
}
