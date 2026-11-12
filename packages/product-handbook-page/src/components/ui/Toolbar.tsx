import type { ReactNode } from 'react';

/** The row the filters of a page sit in, with the "showing n of m" status at its right end; it wraps on a narrow screen and keeps every control the same height and left edge. */
export function FilterToolbar({ part, status, children }: { part: string; status: string; children: ReactNode }) {
  return (
    <div className="filter-toolbar" data-part={part}>
      {children}
      <p className="filter-status" role="status">{status}</p>
    </div>
  );
}

/** A labelled search box in the toolbar: a native input with the same height and look as the selects. */
export function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="filter-field" data-part="filter-field" data-filter="search">
      <span className="field-label">{label}</span>
      <input className="field-control" type="search" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
