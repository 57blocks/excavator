import { useLinks, useView } from '../lib/links';
import { useText } from '../lib/text';
import type { Text } from '../lib/text';
import { TOPICS, findingCategoryKey } from '../lib/types';
import type { PageData, TopicBasis } from '../lib/types';
import { placeText } from './Locations';
import { levelName } from './RecommendationsPage';
import { Cell, TableScroll } from './Tables';

type Places = Map<string, { file: string; startLine: number | null; endLine: number | null }[]>;

/** What one row rests on, in words: a verified item with its feature, a group of findings with its level and category; the technical view adds where the passages are. */
function basisText(t: Text, entry: TopicBasis, places: Places): string {
  const where = (places.get(entry.id) ?? []).map((place) => placeText(t, place)).join('; ');
  if (entry.kind === 'item') {
    const values = { feature: entry.feature, text: entry.text };
    return where === '' ? t('md.topics.basisItem', values) : t('md.topics.basisItemTechnical', { ...values, places: where });
  }
  const values = { level: levelName(t, entry.level), category: t(findingCategoryKey(entry.category)), statement: entry.text };
  return where === '' ? t('md.remedies.groupLine', values) : t('md.remedies.groupLineTechnical', { ...values, places: where });
}

/**
 * The cross-cutting topics page (both views): one table for each topic, the columns of the topic and the basis of each row (the technical
 * view adds the file and lines). Only rows that two judges confirmed are here; the coverage page lists what they left out. A topic without
 * a row says which verified entries or groups of findings it read and that they state none of it, never that the system has none.
 */
export function TopicsPage({ data }: { data: PageData }) {
  const t = useText();
  const view = useView();
  const nav = useLinks();
  const coverage = data.coverage.topics;
  const places: Places = new Map(view === 'technical' ? [...(data.technical?.topicLocations ?? []), ...(data.technical?.findingLocations ?? [])].map((entry) => [entry.id, entry.citations]) : []);
  const verified = coverage.lanes.filter((lane) => lane.status === 'verified');
  const written = { domain: verified.some((lane) => lane.id !== 'repeated'), repeated: verified.some((lane) => lane.id === 'repeated') };
  const rows = TOPICS.reduce((sum, topic) => sum + data.topics[topic.id].length, 0);
  return (
    <article className="page" data-view="topics">
      <header className="page-head">
        <p className="eyebrow">{data.project}</p>
        <h1 className="page-title">{t('md.topics.heading')}</h1>
      </header>
      {coverage.lanes.length === 0 ? <p className="muted" data-part="topics-none">{t('md.none')}</p> : (
        <>
          <p className="muted summary-note">{t('md.topics.note')}</p>
          {verified.length === 0 ? <p className="muted" data-part="topics-not-finished">{t('md.topics.notFinished')}</p> : (
            <>
              <p className="summary-counts">{t('md.topics.counts', { lanes: verified.length, entries: coverage.entriesRead, groups: coverage.groupsRead, rows })}</p>
              {TOPICS.map((topic) => {
                const own = data.topics[topic.id];
                const isDomain = topic.id !== 'repeated';
                return (
                  <section className="section" key={topic.id} aria-labelledby={`topic-${topic.id}`} data-topic={topic.id}>
                    <h2 className="section-title" id={`topic-${topic.id}`}>{t(`md.topics.${topic.id}.heading`)}</h2>
                    {!(isDomain ? written.domain : written.repeated) && <p className="muted" data-part="topic-lane-not-finished">{t('md.topics.laneNotFinished')}</p>}
                    {(isDomain ? written.domain : written.repeated) && own.length === 0 && (
                      <p className="muted" data-part="topic-empty">{isDomain ? t('md.topics.emptyEntries', { count: coverage.entriesRead }) : t('md.topics.emptyGroups', { count: coverage.groupsRead })}</p>
                    )}
                    {own.length > 0 && (
                      <TableScroll label={t(`md.topics.${topic.id}.heading`)} wide>
                        <thead>
                          <tr>
                            {topic.columns.map((column) => <th scope="col" key={column}>{t(`md.topics.col.${topic.id}.${column}`)}</th>)}
                            <th scope="col">{t('md.topics.col.basis')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {own.map((row, at) => (
                            <tr key={at}>
                              {topic.columns.map((column, index) => <Cell key={column} row={index === 0}>{row.fields[column] === '' ? undefined : row.fields[column]}</Cell>)}
                              <td data-part="topic-basis">
                                <ul className="plain-list">
                                  {row.basis.map((entry, index) => <li key={index}>{basisText(t, entry, places)}</li>)}
                                </ul>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </TableScroll>
                    )}
                  </section>
                );
              })}
            </>
          )}
          <p className="muted"><a href={nav.coverage}>{t('page.nav.coverage')}</a></p>
        </>
      )}
    </article>
  );
}
