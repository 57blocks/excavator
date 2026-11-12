import { useLinks } from '../lib/links';
import { systemName, useText } from '../lib/text';
import type { PageData } from '../lib/types';
import { Item, ItemField, ItemList } from './ui/ItemList';
import { PageTitle } from '../lib/outline';

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
        <p className="eyebrow">{systemName(data.project, t)}</p>
        <PageTitle fallback={heading} />
      </header>
      <p className="summary-counts">{t('md.summary.notifications.counts', { verified: counts.featuresWithEntry, total: counts.featureTotal, count: counts.notificationRows })}</p>
      <p className="muted summary-note">{t('md.summary.notifications.note')}</p>
      {notifications.length === 0 ? <p className="muted">{t('md.summary.notifications.none')}</p> : (
        <ItemList part="notifications" label={heading}>
          {notifications.map((n, at) => (
            <Item
              key={at}
              attrs={(
                <>
                  <a href={nav.feature(n.feature)}>{t('md.summary.feature', { id: n.feature, name: name.get(n.feature) ?? '' })}</a>
                  <span className="channel-chip">{n.channel}</span>
                </>
              )}
            >
              <ItemField label={t('md.table.trigger')}>{n.trigger}</ItemField>
              <ItemField label={t('md.table.recipient')}>{n.recipient}</ItemField>
              <ItemField label={t('md.table.content')}>{n.content}</ItemField>
            </Item>
          ))}
        </ItemList>
      )}
    </article>
  );
}
