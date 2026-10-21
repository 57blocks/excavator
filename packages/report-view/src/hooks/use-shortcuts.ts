import { useEffect } from 'react';

import { isTypingTarget } from '../lib/shortcuts';
import { useGraphUi } from '../state/graph-ui';

/**
 * The viewer's keys (openspec: changes/viewer-app, spec "Shortcuts and
 * history"): `/` focuses the search, `?` lists the shortcuts, and Esc closes
 * the innermost thing. While the graph page is shown it registers what Esc
 * closes; on another page Esc closes the open dialog or menu.
 */
export function useShortcuts() {
  const ui = useGraphUi();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') {
        if (ui.escape.current?.()) return;
        if (ui.overlay !== null) {
          ui.setOverlay(null);
          (document.activeElement as HTMLElement | null)?.blur?.();
        }
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (event.key === '/') {
        const input = ui.searchInput.current;
        if (input) {
          event.preventDefault();
          input.focus();
          input.select();
        }
      } else if (event.key === '?') {
        event.preventDefault();
        ui.setOverlay(ui.overlay === 'shortcuts' ? null : 'shortcuts');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ui]);
}
