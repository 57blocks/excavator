import type { ReactNode } from 'react';

import { Panel } from '../shell/Panel';

/**
 * The detail panel of a table row (openspec: changes/viewer-learn, design D6):
 * it slides in on the right with the shell's panel glass and motion (the
 * sidebar slot of `Panel`, which skips the motion when reduced motion is
 * requested), and closes with its button or Esc. `rowKey` names the row it
 * shows, for the pages' links and the smoke checks.
 */
export function RowPanel({ open, rowKey, title, onClose, actions, children }: {
  open: boolean;
  rowKey: string | null;
  title: string;
  onClose: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Panel slot="sidebar" open={open} title={title} onClose={onClose} actions={actions}>
      <div data-xv-row-panel={rowKey ?? ''} className="flex flex-col gap-4">
        {children}
      </div>
    </Panel>
  );
}

/** A labelled list of a row's fields; a field whose value is null or empty is left out. */
export function RowFields({ fields }: { fields: readonly { label: string; value: ReactNode }[] }) {
  const shown = fields.filter((field) => field.value !== null && field.value !== undefined && field.value !== '');
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
      {shown.map((field) => (
        <div key={field.label} className="contents">
          <dt className="text-muted">{field.label}</dt>
          <dd className="m-0 text-ink [overflow-wrap:anywhere]">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A titled section of the row panel. */
export function RowSection({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1.5">{title}</h3>
      {children}
    </section>
  );
}
