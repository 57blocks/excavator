import type { ReactNode } from 'react';

import { useLinks } from '../lib/links';
import { useText } from '../lib/text';

/** The trail above an entity page: the overview, then the page's own parts; the last one is the page. */
export function Crumbs({ trail }: { trail: ReactNode[] }) {
  const t = useText();
  const nav = useLinks();
  return (
    <nav className="crumbs" aria-label={t('page.breadcrumb.label')}>
      <ol>
        <li><a href={nav.overview}>{t('page.nav.overview')}</a></li>
        {trail.map((part, at) => <li key={at} aria-current={at === trail.length - 1 ? 'page' : undefined}>{part}</li>)}
      </ol>
    </nav>
  );
}
