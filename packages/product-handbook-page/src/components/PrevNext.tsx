import { useLinks } from '../lib/links';
import { hrefOf } from '../lib/pages';
import type { PageItem } from '../lib/pages';
import { useText } from '../lib/text';

/** The links to the previous and the next page of the side list at the end of a reading page. */
export function PrevNext({ previous, next }: { previous?: PageItem; next?: PageItem }) {
  const t = useText();
  const nav = useLinks();
  if (previous === undefined && next === undefined) return null;
  return (
    <nav className="chap-nav" data-part="chapter-nav" aria-label={t('page.chapter.label')}>
      {previous !== undefined && <a rel="prev" data-side="previous" href={hrefOf(previous, nav)}><small>{t('page.chapter.previous')}</small>{previous.title}</a>}
      {next !== undefined && <a rel="next" data-side="next" href={hrefOf(next, nav)}><small>{t('page.chapter.next')}</small>{next.title}</a>}
    </nav>
  );
}
