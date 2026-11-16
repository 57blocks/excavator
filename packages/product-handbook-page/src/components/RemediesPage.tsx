import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { useLinks } from '../lib/links';
import { useText } from '../lib/text';
import { numberHeadings } from '../lib/toc';
import type { PageData } from '../lib/types';
import { Breadcrumbs } from './Breadcrumbs';
import { ChapterPage } from './ChapterPage';
import { Toc } from './Toc';

/** Give the `h2` and `h3` of the chapter their `h-<n>` ids, as the table of contents does elsewhere, so a link can jump to one even before the list is drawn. */
function useNumberedHeadings(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = root.current;
    if (element === null) return undefined;
    numberHeadings(element);
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => { numberHeadings(element); });
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root]);
}

/**
 * The improvement suggestions page: the remedies chapter under a title of the page's own (the chapter's level-1 heading is
 * left out), with the scanning table of contents at the right like any reading page. No previous and next: it is a place
 * of its own, not a step of the reading order.
 */
export function RemediesPage({ data }: { data: PageData }) {
  const t = useText();
  const nav = useLinks();
  const main = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState(true);
  const onPresent = useCallback((present: boolean) => setToc(present), []);
  useNumberedHeadings(main);
  const chapter = data.problems.remedies === null ? undefined : data.chapters.find((candidate) => candidate.id === data.problems.remedies);
  return (
    <div className="read" data-view="remedies" data-toc={chapter !== undefined && toc ? 'yes' : 'none'}>
      <div className="read-main" ref={main}>
        <Breadcrumbs trail={[{ label: t('page.nav.overview'), href: nav.home }, { label: t('page.nav.remedies') }]} />
        <h1 className="page-title">{t('page.nav.remedies')}</h1>
        {chapter === undefined
          ? <p className="muted" data-part="no-remedies">{t('page.problems.noRemediesChapter')}</p>
          : <div data-part="remedies"><ChapterPage chapter={chapter} omitTitle /></div>}
      </div>
      {chapter !== undefined && <Toc root={main} onPresent={onPresent} />}
    </div>
  );
}
