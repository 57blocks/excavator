import { useMemo, useSyncExternalStore } from 'react';

import { parseHash } from './route';
import type { Route } from './route';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The route of the current fragment; follows the back button and shared links. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '');
  return useMemo(() => parseHash(hash), [hash]);
}
