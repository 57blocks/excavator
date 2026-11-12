import { Children } from 'react';
import type { ReactNode } from 'react';

/**
 * A collection with a free-text column is a list of blocks, not a table: each item has its short attributes on a first
 * line (badges, owner, name), its body at the full content width, secondary text under the body and, last, anything
 * collapsed (source locations). A part an item does not have is not drawn.
 */
export function ItemList({ part, label, children }: { part?: string; label?: string; children: ReactNode }) {
  return <ul className="item-list" role="list" data-part={part} aria-label={label}>{children}</ul>;
}

export function Item({ attrs, note, extra, data, children }: { attrs?: ReactNode; note?: ReactNode; extra?: ReactNode; data?: Record<`data-${string}`, string | undefined>; children?: ReactNode }) {
  return (
    <li className="item" {...data}>
      {attrs !== undefined && attrs !== null && <div className="item-attrs">{attrs}</div>}
      {Children.toArray(children).length > 0 && <div className="item-body">{children}</div>}
      {note !== undefined && note !== null && <div className="item-note muted">{note}</div>}
      {extra !== undefined && extra !== null && <div className="item-extra">{extra}</div>}
    </li>
  );
}

/** One labelled field of an item's body (a trigger, a recipient, a rule side). */
export function ItemField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="item-field"><span className="inline-label">{label}</span> {children}</div>;
}

/** The collapsed part of an item: closed until the reader opens it. */
export function ItemCollapse({ summary, part, children }: { summary: string; part?: string; children: ReactNode }) {
  return (
    <details className="item-collapse" data-part={part}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

/** Terms and their definitions: a term is short, its definition is as long as it needs. */
export function DefinitionList({ part, label, children }: { part?: string; label?: string; children: ReactNode }) {
  return <dl className="def-list" data-part={part} aria-label={label}>{children}</dl>;
}

export function Definition({ term, data, children }: { term: ReactNode; data?: Record<`data-${string}`, string | undefined>; children: ReactNode }) {
  return <div className="def" {...data}><dt>{term}</dt><dd>{children}</dd></div>;
}
