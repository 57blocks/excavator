import type { FindingClass, Priority, Status } from '../lib/types';

/** A status as a coloured pill with its name and a symbol (set in CSS), so colour is never the only signal. */
export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-${status}`} data-status={status}>{status}</span>;
}

/** The symbol of each status, the same ones the pill shows. */
export const STATUS_MARKS: Record<Status, string> = { verified: '✓', checked: '◎', written: '◐', planned: '○', failed: '✕' };

/**
 * A status as its symbol alone, for tight rows: the status is its tooltip and its accessible name. With `text` the
 * symbol is hidden from assistive technology and the status word is visually-hidden text instead (table cells).
 */
export function StatusMark({ status, text = false }: { status: Status; text?: boolean }) {
  if (text) {
    return <span className={`status-mark mark-${status}`} title={status} data-status={status}><span aria-hidden="true">{STATUS_MARKS[status]}</span><span className="sr-only">{status}</span></span>;
  }
  return <span className={`status-mark mark-${status}`} role="img" aria-label={status} title={status} data-status={status}>{STATUS_MARKS[status]}</span>;
}

export function ClassBadge({ value }: { value: FindingClass }) {
  return <span className={`badge badge-${value}`} data-class={value}>{value}</span>;
}

/** A finding's level in text (P0, P1, P2 or Unranked), so colour is never the only signal. */
export function PriorityBadge({ value }: { value: Priority | null }) {
  const key = value === null ? 'unranked' : value;
  return <span className={`badge badge-priority-${key}`} data-priority={key}>{value ?? 'Unranked'}</span>;
}
