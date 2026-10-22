import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { shortRevision } from '../../lib/format';
import { CARD_VARIANTS } from '../../lib/motion';
import { StatusBadge } from './Badge';

/**
 * The head of a page (openspec: changes/viewer-learn, design D6): the serif
 * title, a one-line description, and, for a page that shows a product, the
 * product's state and the revision of the snapshot it was read with. It enters
 * with the page's cards.
 */
export function PageHeader({ title, description, status, revision, children }: {
  title: string;
  description?: string | null;
  /** The product's state, as the manifest gives it; no badge without one. */
  status?: string | null;
  /** The source snapshot's revision; shown cut short, in full in its title. */
  revision?: string | null;
  /** Anything the page puts on the right of the title (a control, say). */
  children?: ReactNode;
}) {
  return (
    <motion.header variants={CARD_VARIANTS} data-xv-page-header="" className="flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <h1 className="[overflow-wrap:anywhere]">{title}</h1>
        {description ? <p className="mt-1 text-muted">{description}</p> : null}
      </div>
      {status || revision || children ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted">
          {status ? <StatusBadge status={status} /> : null}
          {revision ? (
            <span data-xv-snapshot={revision} title={revision}>
              Snapshot <code>{shortRevision(revision)}</code>
            </span>
          ) : null}
          {children}
        </div>
      ) : null}
    </motion.header>
  );
}
