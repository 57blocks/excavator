import type { ReactNode } from "react";

export type BadgeTone = "good" | "warn" | "bad" | "neutral";

const TONES: Record<BadgeTone, string> = {
  good: "text-node-function border-node-function/30 bg-node-function/10",
  warn: "text-diff-affected border-diff-affected/30 bg-diff-affected/10",
  bad: "text-diff-changed border-diff-changed/30 bg-diff-changed/10",
  neutral: "text-text-secondary border-border-subtle bg-elevated",
};

/** A small label with a tone, in the node-type badge style. */
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TONES[tone]}`}>{children}</span>;
}

/** A row of toggle chips: a label, then one chip per value; a chosen value is filled. */
export function ChipGroup({ label, values, selected, onToggle }: { label: string; values: readonly string[]; selected: readonly string[]; onToggle: (value: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="min-w-[72px] text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      <span className="flex flex-wrap gap-1.5">
        {values.map((value) => {
          const on = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              data-excavator-chip={`${label}:${value}`}
              onClick={() => onToggle(value)}
              className={`rounded-full border px-3 py-0.5 text-xs transition-colors ${
                on ? "border-accent/40 bg-accent/20 text-accent" : "border-border-subtle bg-elevated text-text-secondary hover:text-accent"
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
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="w-full min-w-0 rounded-lg border border-border-subtle bg-elevated px-3 py-1.5 text-sm text-text-primary placeholder-text-muted focus:border-accent/50 focus:outline-none"
    />
  );
}

/** A button that looks like a link. */
export function LinkButton({ onClick, title, children }: { onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className="cursor-pointer border-0 bg-transparent p-0 text-left text-accent transition-colors hover:text-accent-bright hover:underline">
      {children}
    </button>
  );
}

/** A definition list of labelled facts. */
export function Facts({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text-muted">{label}</dt>
          <dd className="m-0 text-text-secondary [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BulletList({ items, mono = false }: { items: readonly string[]; mono?: boolean }) {
  return (
    <ul className="m-0 space-y-1 p-0 list-none text-xs text-text-secondary">
      {items.map((item, i) => (
        <li key={i} className={`flex gap-1.5 [overflow-wrap:anywhere] ${mono ? "font-mono text-[11px]" : ""}`}>
          <span className="shrink-0 text-accent">-</span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** The preformatted text of a quote or a piece of code: verbatim, wrapped, as text. */
export function Quote({ children }: { children: ReactNode }) {
  return <pre className="m-0 whitespace-pre-wrap rounded-lg border border-border-subtle border-l-2 border-l-accent/60 bg-elevated px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">{children}</pre>;
}

/** The segmented switch of the header (Domain | Structural), for choosing one of a few tables. */
export function Segmented<T extends string>({ label, values, labels, value, onChange }: { label: string; values: readonly T[]; labels: Record<T, string>; value: T; onChange: (value: T) => void }) {
  return (
    <div className="inline-flex items-center rounded-lg bg-elevated p-0.5" role="group" aria-label={label}>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          data-excavator-tab={v}
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${value === v ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-secondary"}`}
        >
          {labels[v]}
        </button>
      ))}
    </div>
  );
}
