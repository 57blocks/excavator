import { chapterKey, chapterList } from '../lib/chapters';
import { useLinks, useView } from '../lib/links';
import type { Route } from '../lib/route';
import { useText } from '../lib/text';
import type { PageData } from '../lib/types';
import { bodyOf } from '../lib/views';

/** The links to the previous and the next chapter of the rail at the end of a chapter (openspec change handbook-domain-page, D6); none on a page the rail does not list, such as a feature. */
export function ChapterNav({ data, route }: { data: PageData; route: Route }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const list = chapterList(data, view, nav, t);
  const at = list.findIndex((chapter) => chapter.key === chapterKey(bodyOf(route)));
  if (at < 0) return null;
  const previous = at > 0 ? list[at - 1] : undefined;
  const next = at < list.length - 1 ? list[at + 1] : undefined;
  return (
    <section className="chapter-nav" data-part="chapter-nav" aria-label={t('page.chapter.label')}>
      {previous !== undefined ? (
        <a className="chapter-link" data-side="previous" href={previous.href}><span className="chapter-side">{t('page.chapter.previous')}</span><span className="chapter-name">{previous.label}</span></a>
      ) : <span />}
      {next !== undefined && (
        <a className="chapter-link" data-side="next" href={next.href}><span className="chapter-side">{t('page.chapter.next')}</span><span className="chapter-name">{next.label}</span></a>
      )}
    </section>
  );
}
