import type { FindingClass, Status } from '../lib/types';

/** A status as a coloured pill with its name and a symbol (set in CSS), so colour is never the only signal. */
export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-${status}`} data-status={status}>{status}</span>;
}

export function ClassBadge({ value }: { value: FindingClass }) {
  return <span className={`badge badge-${value}`} data-class={value}>{value}</span>;
}
