import type { ReactNode } from 'react';

import { statusLabel } from '../../lib/products';

const TONES = {
  success: 'bg-success text-white',
  danger: 'bg-danger text-white',
  warning: 'bg-warning text-ink',
  neutral: 'bg-paper-2 text-muted',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold leading-[18px] ${TONES[tone]}`}>{children}</span>;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  included: 'success',
  'different-revision': 'warning',
  unreadable: 'danger',
  'not-run': 'neutral',
};

/** The state of a product or page, in words, with the colour of its state. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{statusLabel(status)}</Badge>;
}

/** The small dot of a state, for the navigation. */
export function StatusDot({ status }: { status: string }) {
  const tone = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', neutral: 'bg-muted' }[STATUS_TONE[status] ?? 'neutral'];
  return <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${tone}`} />;
}
