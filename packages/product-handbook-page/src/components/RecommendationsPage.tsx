import { useText } from '../lib/text';
import type { Text } from '../lib/text';
import { findingCategoryKey } from '../lib/types';
import type { Level, PageData, RemedyFact } from '../lib/types';
import { Chips } from './Locations';
import { useView } from '../lib/links';

/** A level as the reader sees it: P0 to P2, or the word for none. */
export const levelName = (t: Text, level: Level | null): string => (level === null ? t('md.priority.unranked') : t('md.priority.level', { rank: level.slice(1) }));

/** One cited fact in words, from the values the script computed and the run's fixed text. */
export function factText(t: Text, fact: RemedyFact): string {
  switch (fact.kind) {
    case 'app': {
      const values = { name: fact.name, language: fact.language ?? t('md.remedies.noLanguage'), files: fact.files, lines: fact.lines };
      return fact.commits === null || fact.authors === null
        ? t('md.remedies.factAppNoHistory', values)
        : t('md.remedies.factApp', { ...values, commits: fact.commits, authors: fact.authors });
    }
    case 'tables': {
      if (fact.count === null) return t('md.remedies.factTablesUnknown');
      if (fact.count === 0) return t('md.remedies.factTables', { count: 0 });
      const tables = fact.tables.map((table) => t('md.remedies.factTable', { table: table.name, applications: table.applications.join(', ') })).join('; ');
      return t('md.remedies.factTablesNamed', { count: fact.count, tables });
    }
    case 'counts': {
      const levels = (['P0', 'P1', 'P2'] as const).map((level) => t('md.priority.count', { level: levelName(t, level), count: fact.levels[level] }));
      levels.push(t('md.priority.count', { level: t('md.priority.unranked'), count: fact.levels.unranked }));
      return t('md.remedies.factCounts', {
        groups: fact.groups,
        levels: levels.join('; '),
        categories: fact.categories.map((entry) => t('md.findings.categoryCount', { category: t(findingCategoryKey(entry.category)), count: entry.count })).join('; '),
      });
    }
  }
}

/**
 * The recommendations page (both views): the recommendations in the order they are to be done, each with its title and text, then the
 * findings it rests on (level and representative statement; the technical view adds the file and lines) and the facts it rests on,
 * written in words. Only recommendations that two judges confirmed are here; the coverage page lists what they left out.
 */
export function RecommendationsPage({ data }: { data: PageData }) {
  const t = useText();
  const view = useView();
  const { recommendations } = data.remedies;
  const places = new Map((view === 'technical' ? data.technical?.findingLocations ?? [] : []).map((entry) => [entry.id, entry.citations]));
  const groupsCited = new Set(recommendations.flatMap((one) => one.groups.map((group) => group.id))).size;
  return (
    <article className="page" data-view="recommendations">
      <header className="page-head">
        <p className="eyebrow">{data.project}</p>
        <h1 className="page-title">{t('md.remedies.heading')}</h1>
      </header>
      {data.findings.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <>
          <p className="muted summary-note">{t('md.remedies.note')}</p>
          {recommendations.length === 0 ? <p className="muted" data-part="recommendations-none">{t('md.remedies.none')}</p> : (
            <>
              <p className="summary-counts">{t('md.remedies.counts', { count: recommendations.length, groups: groupsCited, total: data.findings.length })}</p>
              <ol className="recommendations" data-part="recommendations">
                {recommendations.map((recommendation, at) => (
                  <li key={at} className="section" data-recommendation={at + 1}>
                    <h2 className="section-title">{t('md.remedies.itemHeading', { number: at + 1, title: recommendation.title })}</h2>
                    <p>{recommendation.text}</p>
                    {recommendation.groups.length > 0 && (
                      <div data-part="recommendation-groups">
                        <p className="muted">{t('page.remedies.groups')}</p>
                        <ul className="plain-list">
                          {recommendation.groups.map((group) => {
                            const values = { level: levelName(t, group.level), category: t(findingCategoryKey(group.category)), statement: group.text };
                            return <li key={group.id}>{t('md.remedies.groupLine', values)}<Chips citations={places.get(group.id) ?? []} /></li>;
                          })}
                        </ul>
                      </div>
                    )}
                    {recommendation.facts.length > 0 && (
                      <div data-part="recommendation-facts">
                        <p className="muted">{t('page.remedies.facts')}</p>
                        <ul className="plain-list">
                          {recommendation.facts.map((fact, index) => <li key={index}>{factText(t, fact)}</li>)}
                        </ul>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </article>
  );
}
