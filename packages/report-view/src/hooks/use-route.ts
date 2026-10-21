import { useMemo, useSyncExternalStore } from 'react';

import { parseRoute, type Route } from '../lib/route';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('hashchange', listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('hashchange', listener);
    window.removeEventListener('popstate', listener);
  };
}

const currentHash = () => window.location.hash;
const serverHash = () => '';

/** Go to `hash` as a new history entry; back and forward then return to the previous one. */
export function navigate(hash: string) {
  if (hash === window.location.hash) return;
  window.history.pushState(null, '', hash);
  for (const listener of listeners) listener();
}

/** The route the address bar holds, and its raw hash (the key a page is remounted by). */
export function useRoute(): { route: Route; hash: string } {
  const hash = useSyncExternalStore(subscribe, currentHash, serverHash);
  return { route: useMemo(() => parseRoute(hash), [hash]), hash };
}
