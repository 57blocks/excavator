import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { DURATION, EASE } from '../../lib/motion';

export type PanelSlot = 'sidebar' | 'drawer';

/** The elements of the shell a panel is drawn into, once they are mounted. */
export const PanelHosts = createContext<Record<PanelSlot, HTMLElement | null>>({ sidebar: null, drawer: null });

const ENTER: Record<PanelSlot, { x?: number; y?: number }> = { sidebar: { x: 24 }, drawer: { y: 24 } };

const FRAME: Record<PanelSlot, string> = {
  // At 768 px and below the sidebar covers the page instead of taking room from it.
  sidebar: 'h-full w-[360px] max-w-full border-l',
  drawer: 'h-[40vh] w-full border-t',
};

/**
 * A panel of the shell: the right sidebar or the bottom drawer. It slides in
 * and fades, and out again; Esc and the close button call `onClose`. The
 * content is drawn into the shell's own element for the slot, so the page that
 * owns the content can keep its state.
 */
export function Panel({ slot, open, title, onClose, children }: { slot: PanelSlot; open: boolean; title: string; onClose: () => void; children?: ReactNode }) {
  const host = useContext(PanelHosts)[slot];
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!host) return null;
  const hidden = { opacity: 0, ...ENTER[slot] };
  const shown = { opacity: 1, x: 0, y: 0 };
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="panel"
          aria-label={title}
          initial={reduce ? false : hidden}
          animate={shown}
          exit={reduce ? undefined : hidden}
          transition={{ duration: DURATION.panel, ease: EASE }}
          className={`glass flex min-h-0 flex-col ${FRAME[slot]}`}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="min-w-0 truncate">{title}</h2>
            <button type="button" aria-label="Close panel" onClick={onClose} className="cursor-pointer rounded-control border-0 bg-transparent px-2 py-1 text-muted hover:bg-paper hover:text-ink">
              {String.fromCharCode(0xd7)}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        </motion.aside>
      ) : null}
    </AnimatePresence>,
    host,
  );
}
