import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { CARD_VARIANTS } from '../../lib/motion';

const TONES = {
  plain: '',
  warn: 'border-l-4 border-l-warning',
  error: 'border-l-4 border-l-danger',
} as const;

/** A white rounded card with an optional heading; `warn` and `error` add the coloured left edge. */
export function Card({ title, tone = 'plain', flush = false, className = '', children }: {
  title?: string;
  tone?: keyof typeof TONES;
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <motion.section
      variants={CARD_VARIANTS}
      className={`min-w-0 rounded-card bg-surface shadow-card ${flush ? 'overflow-hidden' : 'p-5'} ${TONES[tone]} ${className} [&_p]:mb-2 [&_p:last-child]:mb-0`}
    >
      {title ? <h2 className={flush ? 'px-5 pt-4' : 'mb-3'}>{title}</h2> : null}
      {children}
    </motion.section>
  );
}
