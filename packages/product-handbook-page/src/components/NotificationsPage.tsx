import { useLinks } from '../lib/links';
import { useText } from '../lib/text';
import type { PageData } from '../lib/types';
import { Cell, TableScroll } from './Tables';

/** Every notification of every verified entry, in the order of the map, in the entries' own words. */
export function NotificationsPage({ data }: { data: PageData }) {
  const t = useText();
  const nav = useLinks();
  const { counts, notifications } = data.summary;
  const name = new Map(data.features.map((feature) => [feature.id, feature.name]));
  const heading = t('md.summary.notifications.heading');
  return (
    <article className="page" data-view="notifications">
      <header className="page-head">
        <p className="eyebrow">{data.project}</p>
        <h1 className="page-title">{heading}</h1>
      </header>
      <p className="summary-counts">{t('md.summary.notifications.counts', { verified: counts.featuresWithEntry, total: counts.featureTotal, count: counts.notificationRows })}</p>
      <p className="muted summary-note">{t('md.summary.notifications.note')}</p>
      {notifications.length === 0 ? <p className="muted">{t('md.summary.notifications.none')}</p> : (
        <TableScroll label={heading} wide>
          <thead>
            <tr>
              <th scope="col">{t('md.table.feature')}</th>
              <th scope="col">{t('md.table.trigger')}</th>
              <th scope="col">{t('md.table.recipient')}</th>
              <th scope="col">{t('md.table.channel')}</th>
              <th scope="col">{t('md.table.content')}</th>
            </tr>
          </thead>
          <tbody>
            {notifications.map((n, at) => (
              <tr key={at}>
                <Cell row><a href={nav.feature(n.feature)}>{t('md.summary.feature', { id: n.feature, name: name.get(n.feature) ?? '' })}</a></Cell>
                <Cell>{n.trigger}</Cell><Cell>{n.recipient}</Cell><Cell>{n.channel}</Cell><Cell>{n.content}</Cell>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </article>
  );
}
