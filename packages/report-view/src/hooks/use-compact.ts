import { useSyncExternalStore } from 'react';

/** Below this width the top bar keeps its overlay switches behind one menu (the full bar needs 1280 px). */
export const COMPACT_QUERY = '(max-width: 1279px)';

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(COMPACT_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

const current = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(COMPACT_QUERY).matches;

/** Whether the window is narrower than the full top bar needs; false where there is no window to measure. */
export function useCompact(): boolean {
  return useSyncExternalStore(subscribe, current, () => false);
}
