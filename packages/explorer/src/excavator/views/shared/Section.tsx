import type { ReactNode } from "react";

/**
 * A card of a product view: the explorer's surface and border, with a small uppercase
 * section label (the style of the project overview's headings) and an optional count.
 */
export function Section({ title, count, tone = "plain", children }: { title?: string; count?: ReactNode; tone?: "plain" | "warn"; children?: ReactNode }) {
  return (
    <section
      data-excavator-section={title}
      className={`min-w-0 rounded-lg border bg-surface p-4 ${tone === "warn" ? "border-diff-affected/40" : "border-border-subtle"}`}
    >
      {title ? (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider">{title}</h3>
          {count === undefined ? null : <span className="text-[11px] font-mono text-text-muted">{count}</span>}
        </div>
      ) : null}
      <div className="space-y-3 text-sm text-text-secondary leading-relaxed [overflow-wrap:anywhere]">{children}</div>
    </section>
  );
}

/** A quiet line of text under a heading or a table. */
export function Note({ children }: { children?: ReactNode }) {
  return <p className="text-xs text-text-muted leading-relaxed">{children}</p>;
}

/** A banner at the top of a view: the explorer's elevated block with a coloured edge. */
export function Notice({ tone = "info", title, children, ...rest }: { tone?: "info" | "warn" | "error"; title?: string; children?: ReactNode; "data-excavator-notice"?: string }) {
  const edge = tone === "warn" ? "border-l-diff-affected" : tone === "error" ? "border-l-diff-changed" : "border-l-accent";
  return (
    <div {...rest} role={tone === "info" ? undefined : "status"} className={`rounded-lg border border-border-subtle border-l-4 ${edge} bg-elevated/60 px-4 py-3 text-sm text-text-secondary leading-relaxed [overflow-wrap:anywhere]`}>
      {title ? <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-primary">{title}</div> : null}
      {children}
    </div>
  );
}
