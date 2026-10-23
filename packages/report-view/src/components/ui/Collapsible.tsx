import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { CARD_VARIANTS } from '../../lib/motion';

/** A card that starts folded to its title (and an optional count beside it) and opens in place. */
export function Collapsible({ title, count, open = false, children }: { title: string; count?: ReactNode; open?: boolean; children?: ReactNode }) {
  return (
    <motion.section variants={CARD_VARIANTS} data-xv-collapsible={title} className="min-w-0 rounded-card bg-surface shadow-card [&_p]:mb-2 [&_p:last-child]:mb-0">
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <h2>{title}</h2>
          <span className="flex items-center gap-3 text-xs text-muted">
            {count === undefined ? null : <span>{count}</span>}
            <span aria-hidden="true" className="inline-block transition-transform duration-200 ease-site group-open:rotate-90">{String.fromCharCode(0x203a)}</span>
          </span>
        </summary>
        <div className="px-5 pb-5">{children}</div>
      </details>
    </motion.section>
  );
}
