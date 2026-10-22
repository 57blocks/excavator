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

/** The drawer, expanded: the whole main area (the page is below the 56 px top bar). */
const FULL_DRAWER = 'h-[calc(100dvh-3.5rem)] w-full border-t';

/**
 * A panel of the shell: the right sidebar or the bottom drawer. It slides in
 * and fades, and out again; the close button calls `onClose`, and so does Esc
 * unless the page handles Esc itself (`closeOnEscape` false). A drawer can be
 * `expanded` to fill the main area, and a panel can carry `actions` beside the
 * close button. The content is drawn into the shell's own element for the slot,
 * so the page that owns the content can keep its state.
 */
export function Panel({ slot, open, title, onClose, closeOnEscape = true, expanded = false, actions, flush = false, exitAtOnce = false, children }: {
  slot: PanelSlot;
  open: boolean;
  title: string;
  onClose: () => void;
  closeOnEscape?: boolean;
  expanded?: boolean;
  actions?: ReactNode;
  /** The content fills the panel to its edges, with no padding. */
  flush?: boolean;
  /** Close without the exit animation: another panel takes this one's place in the slot, so the two are never drawn together. */
  exitAtOnce?: boolean;
  children?: ReactNode;
}) {
  const host = useContext(PanelHosts)[slot];
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open || !closeOnEscape) return undefined;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeOnEscape, onClose]);

  if (!host || (!open && exitAtOnce)) return null;
  const hidden = { opacity: 0, ...ENTER[slot] };
  const shown = { opacity: 1, x: 0, y: 0 };
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="panel"
          aria-label={title}
          data-xv-panel={slot}
          initial={reduce ? false : hidden}
          animate={shown}
          exit={reduce ? undefined : hidden}
          transition={{ duration: DURATION.panel, ease: EASE }}
          className={`glass flex min-h-0 flex-col ${slot === 'drawer' && expanded ? FULL_DRAWER : FRAME[slot]}`}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="min-w-0 truncate" title={title}>{title}</h2>
            <div className="flex shrink-0 items-center gap-1">
              {actions}
              <button type="button" aria-label="Close panel" onClick={onClose} className="cursor-pointer rounded-control border-0 bg-transparent px-2 py-1 text-muted hover:bg-paper hover:text-ink">
                {String.fromCharCode(0xd7)}
              </button>
            </div>
          </div>
          <div className={`min-h-0 flex-1 overflow-auto ${flush ? '' : 'p-4'}`}>{children}</div>
        </motion.aside>
      ) : null}
    </AnimatePresence>,
    host,
  );
}
