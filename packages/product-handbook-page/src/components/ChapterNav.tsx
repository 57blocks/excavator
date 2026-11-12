import { useLinks } from '../lib/links';
import { hrefOf, pageOf } from '../lib/pages';
import type { Route } from '../lib/route';
import { useText } from '../lib/text';
import type { PageData } from '../lib/types';
import { usePages } from '../lib/use-pages';

/** The links to the previous and the next page of the outline at the end of a page. */
export function ChapterNav({ data, route }: { data: PageData; route: Route }) {
  const t = useText();
  const nav = useLinks();
  const pages = usePages(data);
  const current = pageOf(pages, route);
  const at = current === undefined ? -1 : pages.indexOf(current);
  if (at < 0) return null;
  const previous = at > 0 ? pages[at - 1] : undefined;
  const next = at < pages.length - 1 ? pages[at + 1] : undefined;
  return (
    <section className="chapter-nav" data-part="chapter-nav" aria-label={t('page.chapter.label')}>
      {previous !== undefined ? (
        <a className="chapter-link" data-side="previous" href={hrefOf(previous, nav)}><span className="chapter-side">{t('page.chapter.previous')}</span><span className="chapter-name">{previous.title}</span></a>
      ) : <span />}
      {next !== undefined && (
        <a className="chapter-link" data-side="next" href={hrefOf(next, nav)}><span className="chapter-side">{t('page.chapter.next')}</span><span className="chapter-name">{next.title}</span></a>
      )}
    </section>
  );
}
