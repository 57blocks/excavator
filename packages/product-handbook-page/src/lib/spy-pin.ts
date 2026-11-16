import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** The events that are the reader's own scrolling: they give the marking back to the scroll spy. */
const READER_SCROLL = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/**
 * The pin of a page's list of headings: after a click on an entry the marked entry stays the clicked one while the page scrolls
 * there, instead of running through every heading on the way (and settling on another one when the target cannot reach the top
 * of the window). The reader's own scrolling releases it; so does a new list (`key`). A click on an entry releases it on
 * `pointerdown` and pins it again on `click`.
 */
export function useSpyPin(key: string): { pinned: RefObject<boolean>; pin: () => void } {
  const pinned = useRef(false);
  useEffect(() => {
    pinned.current = false;
    const release = (): void => { pinned.current = false; };
    for (const name of READER_SCROLL) window.addEventListener(name, release, { passive: true, capture: true });
    return () => {
      for (const name of READER_SCROLL) window.removeEventListener(name, release, { capture: true });
    };
  }, [key]);
  return { pinned, pin: () => { pinned.current = true; } };
}
