import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { scrollToElement } from '../lib/scroll';

interface Entry {
  id: string;
  label: string;
  level: number;
}

/** An entry is current once its top has reached the line just under the top bar: the bar's height plus a margin. */
const READING_LINE = 56 + 24;

/**
 * The "On this page" outline (design D6). After the page renders it reads the
 * elements marked `data-outline` from the DOM (the Markdown h2 and h3 with their
 * line ids, and the page's own sections), lists them in document order and
 * marks the one being read, found from the scroll position. A click
 * scrolls there with scrollIntoView; the URL fragment is the route and is
 * never touched.
 */
export function Outline({ rootRef, pageKey }: { rootRef: RefObject<HTMLElement | null>; pageKey: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const found = Array.from(root.querySelectorAll<HTMLElement>('[data-outline]')).filter((element) => element.id !== '').map((element) => ({
      id: element.id,
      label: (element.getAttribute('data-outline-label') ?? element.textContent ?? '').trim(),
      level: element.getAttribute('data-outline') === '3' ? 3 : 2,
    }));
    setEntries(found);
    setActive(found[0]?.id ?? '');
    if (found.length === 0) return;

    const elements = found.map((entry) => document.getElementById(entry.id)).filter((element): element is HTMLElement => element !== null);
    // The current entry is the last target whose top is at or above the reading line, else the first; it is recomputed on scroll and resize (one frame at a time).
    const compute = () => {
      let current = elements[0]?.id ?? '';
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= READING_LINE + 2) current = element.id;
        else break;
      }
      setActive(current);
    };
    let frame = 0;
    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => { frame = 0; compute(); });
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // The observer catches the layout moving without a scroll (a diagram above rendering).
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(schedule, { rootMargin: `-${READING_LINE}px 0px -60% 0px`, threshold: [0, 1] });
    elements.forEach((element) => observer?.observe(element));
    compute();
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [rootRef, pageKey]);

  // Long outlines scroll on their own: keep the current entry visible inside the list, never moving the page.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!list || !item) return;
    if (item.offsetTop < list.scrollTop || item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, item.offsetTop - list.clientHeight / 2);
  }, [active]);

  if (entries.length === 0) return null;
  return (
    <aside className="page-toc" aria-label="On this page" data-outline-count={entries.length}>
      <div className="outline-title">On this page</div>
      <div className="outline-list" ref={listRef}>
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="outline-item"
            data-level={entry.level}
            aria-current={active === entry.id ? 'location' : undefined}
            title={entry.label}
            onClick={() => {
              const target = document.getElementById(entry.id);
              if (target === null) return;
              setActive(entry.id);
              scrollToElement(target);
            }}
          >{entry.label}</button>
        ))}
      </div>
    </aside>
  );
}
