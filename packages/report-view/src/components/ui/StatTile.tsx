import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { formatNumber } from '../../lib/format';
import { CARD_VARIANTS } from '../../lib/motion';
import { RollingNumber } from './Tile';

/**
 * A statistic of a detail page (openspec: changes/viewer-learn, design D6): a
 * small label above, the number (rolling up to its value, as the count tiles
 * do; at once with reduced motion), and one line below that says what it counts.
 * A value that is not a finite number is shown as the empty mark.
 */
export function StatTile({ label, value, note }: { label: string; value: unknown; note?: ReactNode }) {
  const finite = typeof value === 'number' && Number.isFinite(value);
  return (
    <motion.div variants={CARD_VARIANTS} data-xv-stat={label} className="min-w-0 rounded-card bg-surface px-4 py-3.5 shadow-card">
      <div className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 font-heading text-[30px] leading-9 text-ink [overflow-wrap:anywhere]" data-xv-stat-value={finite ? String(Math.round(value)) : ''}>
        {finite ? <RollingNumber value={Math.round(value)} /> : formatNumber(value)}
      </div>
      {note ? <div className="mt-0.5 truncate text-xs text-muted">{note}</div> : null}
    </motion.div>
  );
}

/** A row of statistic tiles that wraps on narrow widths. */
export function StatTiles({ children }: { children?: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">{children}</div>;
}
