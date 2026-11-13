import { Fragment } from 'react';

import { useText } from '../lib/text';

/** One step of the trail: its text and, for a step that is a place, its address. */
export interface Crumb { label: string; href?: string }

/** The trail above a page: Map, the group or the references, the page. The current page is the last step, not a link. */
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  const t = useText();
  return (
    <nav className="crumbs" aria-label={t('page.crumbs.label')}>
      {trail.map((crumb, at) => (
        <Fragment key={`${at}-${crumb.label}`}>
          {at > 0 && <span className="sep" aria-hidden="true" />}
          {crumb.href !== undefined ? <a href={crumb.href}>{crumb.label}</a> : <span aria-current={at === trail.length - 1 ? 'page' : undefined}>{crumb.label}</span>}
        </Fragment>
      ))}
    </nav>
  );
}
