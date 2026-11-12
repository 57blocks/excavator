import type { ReactNode } from "react";

/** A card that starts folded to its label (and a count beside it) and opens in place. */
export function Collapsible({ title, count, open = false, children }: { title: string; count?: ReactNode; open?: boolean; children?: ReactNode }) {
  return (
    <section data-excavator-collapsible={title} className="min-w-0 rounded-lg border border-border-subtle bg-surface">
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider">{title}</h3>
          <span className="flex items-center gap-3 text-[11px] font-mono text-text-muted">
            {count === undefined ? null : <span>{count}</span>}
            <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">{String.fromCharCode(0x203a)}</span>
          </span>
        </summary>
        <div className="space-y-3 px-4 pb-4 text-sm text-text-secondary leading-relaxed [overflow-wrap:anywhere]">{children}</div>
      </details>
    </section>
  );
}
