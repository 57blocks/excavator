import type { ReactNode } from 'react';

/** A row of toggle chips: a label, then one chip per value; a chosen value is filled. */
export function ChipGroup({ label, values, selected, onToggle }: {
  label: string;
  values: readonly string[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <span className="min-w-[84px] text-xs text-muted">{label}</span>
      <span className="flex flex-wrap gap-1.5">
        {values.map((value) => {
          const on = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(value)}
              className={`cursor-pointer rounded-full border px-3 py-0.5 text-xs transition-colors duration-200 ease-site ${
                on ? 'border-accent bg-accent text-white hover:bg-violet' : 'border-line-2 bg-surface text-ink-soft hover:border-accent hover:text-accent'
              }`}
            >
              {value}
            </button>
          );
        })}
      </span>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="mb-2 w-full rounded-control border border-line-2 bg-surface px-3 py-1.5 text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent"
    />
  );
}

/** A button that looks like a link. */
export function LinkButton({ onClick, title, children }: { onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className="cursor-pointer border-0 bg-transparent p-0 text-accent underline hover:text-violet">
      {children}
    </button>
  );
}

/** A definition list of labelled facts. */
export function Facts({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="m-0 [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pills({ values }: { values: readonly string[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span key={value} className="rounded-full border border-line-2 px-2.5 py-0.5 text-xs">
          {value}
        </span>
      ))}
    </span>
  );
}

export function BulletList({ items, mono = false }: { items: readonly string[]; mono?: boolean }) {
  return (
    <ul className="m-0 list-disc pl-5">
      {items.map((item, i) => (
        <li key={i} className={`mb-1.5 [overflow-wrap:anywhere] ${mono ? 'font-mono text-[12.5px]' : ''}`}>
          {item}
        </li>
      ))}
    </ul>
  );
}
