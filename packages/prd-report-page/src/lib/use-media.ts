import { useSyncExternalStore } from 'react';

/** Whether the media query matches now and follows it while the page is open; false where matchMedia is missing. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}

/** Whether the platform shows its shortcuts with the Command key. */
export const isApplePlatform = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
