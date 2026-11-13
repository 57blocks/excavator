import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

import { useText } from '../lib/text';

interface Entry { id: string; text: string; level: 2 | 3 }

/** The room kept above a heading for the bar and a little air (the bar is 56px high). */
const AIR = 24;

/** The index of the heading the reader is at: the last one whose top is at or above `limit`, the first when none is. Pure, so a test can drive it. */
export function activeIndex(tops: number[], limit: number): number {
  let active = 0;
  tops.forEach((top, at) => { if (top <= limit) active = at; });
  return active;
}

/** The h2 and h3 of the prose under `root`, each given an id (`toc-<n>`) when it has none. */
function collect(root: HTMLElement): { entries: Entry[]; elements: HTMLElement[] } {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('.prose h2, .prose h3'));
  const entries = elements.map((element, at) => {
    if (element.id === '') element.id = `toc-${at + 1}`;
    return { id: element.id, text: element.textContent ?? '', level: element.tagName === 'H3' ? 3 as const : 2 as const };
  });
  return { entries, elements };
}

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The on-this-page list of a chapter: one button per h2 and h3 of the prose in `root`. A button, not a link, because every
 * address of the page is a route in the hash. It is read from the DOM after render and again whenever the column changes,
 * since the text of a chapter arrives after the first render. Shown only for two h2 or more.
 */
export function Toc({ root }: { root: RefObject<HTMLElement | null> }) {
  const t = useText();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const column = root.current;
    if (column === null) return undefined;
    let frame = 0;
    const spy = () => {
      frame = 0;
      const { elements } = collect(column);
      const bar = document.querySelector('.topbar')?.getBoundingClientRect().height || 56;
      setActive(activeIndex(elements.map((element) => element.getBoundingClientRect().top), bar + AIR));
    };
    const schedule = () => { if (frame === 0) frame = window.requestAnimationFrame(spy); };
    const rebuild = () => {
      const next = collect(column).entries;
      setEntries((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
      schedule();
    };
    rebuild();
    const observer = new MutationObserver(rebuild);
    observer.observe(column, { childList: true, subtree: true });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [root]);

  if (entries.filter((entry) => entry.level === 2).length < 2) return null;

  const go = (id: string) => {
    const heading = document.getElementById(id);
    if (heading === null) return;
    heading.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  };

  return (
    <nav className="toc" aria-label={t('page.toc.label')} data-part="toc">
      <h2 className="toc-title">{t('page.toc.label')}</h2>
      <ul>
        {entries.map((entry, at) => (
          <li key={entry.id}>
            <button type="button" className="toc-link" data-level={entry.level} aria-current={at === active ? 'true' : undefined} onClick={() => go(entry.id)}>{entry.text}</button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
