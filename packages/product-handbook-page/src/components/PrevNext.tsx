import { useLinks } from '../lib/links';
import { hrefOf } from '../lib/pages';
import type { Step } from '../lib/navigation';
import { useText } from '../lib/text';

/** The links to the previous and the next page at the end of a reading page; a step into another domain says which one. */
export function PrevNext({ previous, next }: { previous?: Step; next?: Step }) {
  const t = useText();
  const nav = useLinks();
  if (previous === undefined && next === undefined) return null;
  const label = (step: Step, plain: string): string => (step.domain === null ? t(plain) : t('page.chapter.otherDomain', { name: step.domain }));
  return (
    <nav className="chap-nav" data-part="chapter-nav" aria-label={t('page.chapter.label')}>
      {previous !== undefined && <a rel="prev" data-side="previous" href={hrefOf(previous.item, nav)}><small>{label(previous, 'page.chapter.previous')}</small>{previous.item.title}</a>}
      {next !== undefined && <a rel="next" data-side="next" href={hrefOf(next.item, nav)}><small>{label(next, 'page.chapter.next')}</small>{next.item.title}</a>}
    </nav>
  );
}
