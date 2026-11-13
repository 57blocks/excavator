import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { useText } from '../lib/text';
import { activeIndex, numberHeadings, spyLimit, wantsToc } from '../lib/toc';
import type { TocItem } from '../lib/toc';

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sameItems = (a: TocItem[], b: TocItem[]): boolean => a.length === b.length && a.every((item, at) => item.id === b[at].id && item.text === b[at].text && item.level === b[at].level);

/**
 * The table of contents of the article in `root`: its `h2` and `h3` as buttons (not links: the address is never touched), the
 * heading in view marked. The headings are numbered here (`h-<n>`); the list follows the article as its text loads. It is not
 * there for an article with fewer than two `h2`; `onPresent` tells the page whether it is.
 */
export function Toc({ root, onPresent }: { root: RefObject<HTMLElement | null>; onPresent: (present: boolean) => void }) {
  const t = useText();
  const [items, setItems] = useState<TocItem[]>([]);
  const [active, setActive] = useState(0);
  const headings = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const element = root.current;
    if (element === null) return undefined;
    const collect = () => {
      const found = numberHeadings(element);
      headings.current = found.map((entry) => entry.element);
      setItems((before) => {
        const next = found.map((entry) => entry.item);
        return sameItems(before, next) ? before : next;
      });
    };
    collect();
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(collect);
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root]);

  const present = wantsToc(items);
  useEffect(() => { onPresent(present); }, [present, onPresent]);

  useEffect(() => {
    if (!present) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const bar = document.querySelector('.topbar')?.getBoundingClientRect().height ?? 60;
      setActive(activeIndex(headings.current.map((heading) => heading.getBoundingClientRect().top), spyLimit(bar, window.innerHeight)));
    };
    const onScroll = () => { if (frame === 0) frame = window.requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [present, items]);

  if (!present) return null;
  const go = (at: number) => {
    const heading = headings.current[at];
    if (heading === undefined) return;
    heading.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    heading.focus({ preventScroll: true });
    setActive(at);
  };
  return (
    <nav className="toc" aria-label={t('page.toc.label')}>
      <p>{t('page.toc.label')}</p>
      {items.map((item, at) => (
        <button key={item.id} type="button" data-level={item.level} data-target={item.id} aria-current={at === active ? 'true' : undefined} onClick={() => go(at)}>{item.text}</button>
      ))}
    </nav>
  );
}
