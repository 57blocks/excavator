import { OVERVIEW_HASH } from '../lib/route';
import { useText } from '../lib/text';

/** An address that names no page of this handbook. */
export function NotFound() {
  const t = useText();
  return (
    <article className="page" data-view="not-found">
      <h1 className="page-title">{t('page.notFound.heading')}</h1>
      <p className="lede">{t('page.notFound.body')}</p>
      <p><a className="button-link" href={OVERVIEW_HASH}>{t('page.notFound.back')}</a></p>
    </article>
  );
}
