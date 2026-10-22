import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

import { PAGE_VARIANTS } from '../../lib/motion';
import { PageHeader } from './PageHeader';

/**
 * A page: its heading (with the product's state and the snapshot's revision, for a page that shows a product), then
 * its cards, which enter in turn; with reduced motion requested they are simply there.
 */
export function Page({ title, subtitle, status, revision, children }: { title: string; subtitle?: string | null; status?: string | null; revision?: string | null; children?: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div variants={PAGE_VARIANTS} initial={reduce ? false : 'hidden'} animate="show" className="flex max-w-[1200px] flex-col gap-5">
      <PageHeader title={title} description={subtitle} status={status} revision={revision} />
      {children}
    </motion.div>
  );
}
