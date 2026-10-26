import type { ReactNode } from "react";
import { EMPTY } from "../../products/format";
import type { FieldText } from "../rowFields";

/**
 * The details of a table row (openspec: changes/explorer-products, design D4): a heading
 * with a close button over fields and sections, in the explorer's node-info style. It is
 * the right sidebar's content on a wide screen and a card above the table on a narrow one.
 */
export function RowDetail({ kind, title, onClose, children }: { kind: string; title: string; onClose: () => void; children?: ReactNode }) {
  return (
    <div data-excavator-row-detail={kind} className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{kind}</div>
          <h2 className="font-heading text-lg leading-snug text-text-primary [overflow-wrap:anywhere]">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close the details"
          aria-label="Close the details"
          data-excavator-row-close=""
          className="shrink-0 rounded p-1 text-text-muted transition-colors hover:text-text-primary"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {children}
    </div>
  );
}

/** A labelled list of a row's fields; a field with no value shows the empty mark. */
export function RowFields({ fields }: { fields: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
      {fields.map((field) => (
        <div key={field.label} className="contents">
          <dt className="text-text-muted">{field.label}</dt>
          <dd className="m-0 text-text-secondary [overflow-wrap:anywhere]">
            {field.value === null || field.value === undefined || field.value === "" ? <span className="text-text-muted">{EMPTY}</span> : field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The fields of rowFields.ts as text. */
export function TextFields({ fields }: { fields: readonly FieldText[] }) {
  return <RowFields fields={fields.map((f) => ({ label: f.label, value: f.text }))} />;
}

/** A titled section of the details. */
export function RowSection({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <h4 className="text-[10px] uppercase tracking-wider text-text-muted">{title}</h4>
      <div className="space-y-1.5 text-xs text-text-secondary leading-relaxed">{children}</div>
    </section>
  );
}

/** A sentence in a section that says what the product does not hold. */
export function Missing({ children }: { children: ReactNode }) {
  return <p className="text-text-muted">{children}</p>;
}
