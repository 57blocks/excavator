import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

import { CARD_VARIANTS, PAGE_VARIANTS } from '../../lib/motion';

/** A page: its heading, then its cards, which enter in turn; with reduced motion requested they are simply there. */
export function Page({ title, subtitle, children }: { title: string; subtitle?: string | null; children?: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div variants={PAGE_VARIANTS} initial={reduce ? false : 'hidden'} animate="show" className="flex max-w-[1200px] flex-col gap-5">
      <motion.div variants={CARD_VARIANTS}>
        <h1>{title}</h1>
        {subtitle ? <p className="mt-1 text-muted">{subtitle}</p> : null}
      </motion.div>
      {children}
    </motion.div>
  );
}
