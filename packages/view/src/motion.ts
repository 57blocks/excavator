// React access to the page's single motion switch (see instrument.ts).
import { useSyncExternalStore } from 'react';
import { onReducedMotionChange, reducedMotion } from './instrument';

export function useReducedMotion(): boolean {
  return useSyncExternalStore(onReducedMotionChange, reducedMotion, () => false);
}
