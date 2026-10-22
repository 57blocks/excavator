import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { DURATION, EASE } from '../../lib/motion';

/**
 * A modal dialog: it scales in from 0.98 and fades, and a click on the backdrop
 * closes it. Esc is handled by the viewer's shortcuts, not here. Focus moves
 * into the dialog when it opens and returns to where it was when it closes.
 */
export function Dialog({ open, title, onClose, width = 'max-w-[560px]', children }: { open: boolean; title: string; onClose: () => void; width?: string; children?: ReactNode }) {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => before?.focus?.();
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="backdrop"
          data-xv-dialog={title}
          className="fixed inset-0 z-[100] grid place-items-center bg-ink/20 p-4"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: DURATION.dialog, ease: EASE }}
          onMouseDown={(event) => event.target === event.currentTarget && onClose()}
        >
          <motion.div
            ref={box}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className={`glass max-h-[86dvh] w-full overflow-auto rounded-card bg-surface p-5 outline-none ${width}`}
            initial={reduce ? false : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, scale: 0.98 }}
            transition={{ duration: DURATION.dialog, ease: EASE }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2>{title}</h2>
              <button type="button" aria-label={`Close ${title}`} onClick={onClose} className="cursor-pointer rounded-control border-0 bg-transparent px-2 py-1 text-muted hover:bg-paper hover:text-ink">
                {String.fromCharCode(0xd7)}
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
