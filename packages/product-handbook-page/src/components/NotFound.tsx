import { useLinks } from '../lib/links';
import { useText } from '../lib/text';

/** An address that names no page of this handbook. */
export function NotFound() {
  const t = useText();
  const nav = useLinks();
  return (
    <article className="page" data-view="not-found">
      <h1 className="page-title">{t('page.notFound.heading')}</h1>
      <p className="lede">{t('page.notFound.body')}</p>
      <p><a className="button-link" href={nav.home}>{t('page.notFound.back')}</a></p>
    </article>
  );
}
