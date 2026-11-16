import { useEffect, useState } from 'react';

import { useText } from '../lib/text';
import { activeIndex, spyLimit } from '../lib/toc';

export interface NavEntry { id: string; label: string; level: 2 | 3 }

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The list at the right of a feature page, drawn from the blocks and sections the page itself cut (`entries`): buttons, not
 * links, the entry in view marked. It reads the elements by id and never renumbers or changes a heading.
 */
export function FeatureNav({ entries }: { entries: readonly NavEntry[] }) {
  const t = useText();
  const [active, setActive] = useState(0);
  const key = entries.map((entry) => entry.id).join('|');

  useEffect(() => {
    if (entries.length === 0) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const bar = document.querySelector('.topbar')?.getBoundingClientRect().height ?? 60;
      const tops = entries.map((entry) => document.getElementById(entry.id)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY);
      setActive(activeIndex(tops, spyLimit(bar, window.innerHeight)));
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
    // The entries follow the page's text; their ids are what the spy reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (entries.length === 0) return null;
  const go = (at: number) => {
    const target = document.getElementById(entries[at].id);
    if (target === null) return;
    target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
    setActive(at);
  };
  return (
    <nav className="toc feature-nav" aria-label={t('page.toc.label')}>
      <p>{t('page.toc.label')}</p>
      {entries.map((entry, at) => (
        <button key={entry.id} type="button" data-level={entry.level} data-target={entry.id} aria-current={at === active ? 'true' : undefined} onClick={() => go(at)}>{entry.label}</button>
      ))}
    </nav>
  );
}
