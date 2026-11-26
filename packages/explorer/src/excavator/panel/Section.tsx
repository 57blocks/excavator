import type { ReactNode } from "react";

/** A panel section: a heading with a divider line under it, then its content. No box around it. */
export function Section({ title, note, children }: { title: string; /** Text after the heading, in its own case (a group's name). */ note?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-5 pt-4 pb-2" data-excavator-section={title}>
      <h3 className="mb-2 border-b border-border-subtle pb-1 text-[11px] font-semibold uppercase tracking-wider text-accent">{title}
        {note ? <span className="ml-2 normal-case tracking-normal text-text-secondary" data-excavator-section-note>{note}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** One muted line, used where a product or a fact is missing. */
export function MutedLine({ children }: { children: ReactNode }) {
  return <p className="pb-2 text-xs text-text-muted">{children}</p>;
}

/** The list a section holds: rows separated by divider lines. */
export const LIST_CLASS = "m-0 list-none divide-y divide-border-subtle p-0";

/** The classes of a row that is a button. */
export const ROW_BUTTON_CLASS = "block w-full py-2 text-left transition-colors hover:text-accent";
