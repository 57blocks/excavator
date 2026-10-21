import { useEffect } from 'react';

import { clearCount, clearReady, setCount, setReady } from '../ready';

/**
 * Publish a page's totals as `data-xv-count-<name>` on <html>. They are written
 * when the values are known and taken off again when the page goes or the
 * values change, so a page never leaves a total of an earlier one behind.
 */
export function useCounts(counts: Record<string, number> | null) {
  const key = counts === null ? '' : JSON.stringify(counts);
  useEffect(() => {
    if (counts === null) return undefined;
    const names = Object.keys(counts);
    for (const name of names) setCount(name, counts[name]);
    return () => names.forEach(clearCount);
    // The key stands for the values.
  }, [key]);
}

/**
 * Signal readiness on the frame after the page's first content is mounted,
 * never waiting for an animation. `error` signals that the page could not be
 * drawn. Not ready (still loading) leaves the signal off.
 */
export function useReady(state: 'loading' | 'ready' | 'error', depKey = '') {
  useEffect(() => {
    if (state === 'loading') return undefined;
    const frame = requestAnimationFrame(() => setReady(state === 'ready' ? '1' : 'error'));
    return () => {
      cancelAnimationFrame(frame);
      clearReady();
    };
  }, [state, depKey]);
}
