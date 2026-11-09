import { useState } from 'react';

import { useLinks, useView } from '../lib/links';
import { useText } from '../lib/text';
import type { Text } from '../lib/text';
import { FINDING_CATEGORIES, LEVELS, findingCategoryKey } from '../lib/types';
import type { FindingCategory, FindingGroup, FindingOwner, Level, PageData } from '../lib/types';
import { placeText } from './Locations';
import { PriorityBadge } from './PriorityBadge';
import { Cell, TableScroll } from './Tables';

/** The owner filter: every owner (`all`), the application owners (`system`), or one feature (`feature:<id>`). */
export type OwnerFilter = 'all' | 'system' | `feature:${string}`;

/** The level filter: every level (`all`), one level, or the groups without a priority (`none`). */
export type LevelFilter = 'all' | Level | 'none';

/** The groups of `category` (every category when null) that have an owner of the filter and a priority of the level filter. A new list; the given one is not changed. */
export function filterGroups(groups: FindingGroup[], category: FindingCategory | null, owner: OwnerFilter = 'all', level: LevelFilter = 'all'): FindingGroup[] {
  return groups.filter((group) => (category === null || group.category === category) && (owner === 'all'
    || (owner === 'system' ? group.owners.some((one) => one.kind === 'application') : group.owners.some((one) => one.kind === 'feature' && `feature:${one.id}` === owner)))
    && (level === 'all' || (level === 'none' ? group.priority === null : group.priority?.level === level)));
}

/** The groups by level in the fixed order and, last, those without a priority, zeros included. */
export const countByLevel = (groups: FindingGroup[]): { level: Level | 'none'; count: number }[] => [
  ...LEVELS.map((level) => ({ level, count: groups.filter((group) => group.priority?.level === level).length })),
  { level: 'none' as const, count: groups.filter((group) => group.priority === null).length },
];

/** The groups by category in the fixed order of the categories, zeros included. */
export const countByCategory = (groups: FindingGroup[]): { category: FindingCategory; count: number }[] =>
  FINDING_CATEGORIES.map((category) => ({ category, count: groups.filter((group) => group.category === category).length }));

/** One owner: a feature links to its page, an application is its name. */
function Owner({ owner }: { owner: FindingOwner }) {
  const t = useText();
  const nav = useLinks();
  if (owner.kind === 'application') return <>{t('md.findings.applicationOwner', { name: owner.name })}</>;
  return <a href={nav.feature(owner.id)}>{t('md.summary.feature', { id: owner.id, name: owner.name })}</a>;
}

const ownerText = (t: Text, owner: FindingOwner): string => (owner.kind === 'application' ? t('md.findings.applicationOwner', { name: owner.name }) : t('md.summary.feature', { id: owner.id, name: owner.name }));

/**
 * The findings page (both views): the verified findings of all features and
 * application roots as groups of findings at the same place, by category, each
 * with its owners and the statement of its first finding, the other statements
 * of the group collapsed under it; filterable by category and by owner (a
 * feature, or the application roots as "System") and by level; each group has its level and, when it has one, the reason; each category shows the common
 * cause and the measure the remedies hold for it (openspec change handbook-remedies); the technical view adds the
 * file and lines of each statement's quoted passages.
 */
export function FindingsPage({ data }: { data: PageData }) {
  const t = useText();
  const view = useView();
  const [selected, setSelected] = useState<number>(-1);
  const [owner, setOwner] = useState<OwnerFilter>('all');
  const [level, setLevel] = useState<LevelFilter>('all');
  const category = selected < 0 ? null : FINDING_CATEGORIES[selected] ?? null;
  const shown = filterGroups(data.findings, category, owner, level);
  const counts = countByCategory(data.findings);
  const levels = countByLevel(data.findings);
  const levelName = (entry: Level | 'none'): string => (entry === 'none' ? t('md.priority.unranked') : t('md.priority.level', { rank: entry.slice(1) }));
  const places = new Map((view === 'technical' ? data.technical?.findingLocations ?? [] : []).map((entry) => [entry.id, entry.citations]));
  const placesOf = (id: string): string => (places.get(id) ?? []).map((place) => placeText(t, place)).join('; ');
  const verified = data.features.filter((feature) => feature.findingsStatus === 'verified').length;
  const systemTotal = data.coverage.systemFindingsTotal;
  const systemVerified = systemTotal - data.coverage.systemFindingsUnfinished.length - data.coverage.systemFindingsNotWritten;
  const statements = data.findings.reduce((sum, group) => sum + group.items.length, 0);
  const ownerFeatures = data.features.filter((feature) => data.findings.some((group) => group.owners.some((one) => one.kind === 'feature' && one.id === feature.id)));
  return (
    <article className="page" data-view="findings">
      <header className="page-head">
        <p className="eyebrow">{data.project}</p>
        <h1 className="page-title">{t('md.findings.heading')}</h1>
      </header>
      <p className="muted summary-note">{t('md.findings.note')}</p>
      <p className="summary-counts">
        {t('md.findings.counts', {
          total: data.findings.length,
          statements,
          merged: data.findings.filter((group) => group.items.length > 1).length,
          verified,
          featureTotal: data.features.length,
          systemVerified,
          systemTotal,
          categories: counts.map((entry) => t('md.findings.categoryCount', { category: t(findingCategoryKey(entry.category)), count: entry.count })).join('; '),
          priority: levels.map((entry) => t('md.priority.count', { level: levelName(entry.level), count: entry.count })).join('; '),
        })}
      </p>
      {data.findings.length === 0 ? <p className="muted">{t('md.findings.none')}</p> : (
        <>
          <div className="findings-filters" data-part="findings-filters">
            <label className="findings-filter">
              <span>{t('page.findings.filter.category')}</span>
              <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
                <option value={-1}>{t('page.findings.filter.all')}</option>
                {counts.map((entry, at) => <option value={at} key={entry.category}>{t('md.findings.categoryCount', { category: t(findingCategoryKey(entry.category)), count: entry.count })}</option>)}
              </select>
            </label>
            <label className="findings-filter" data-part="findings-level-filter">
              <span>{t('page.findings.filter.level')}</span>
              <select value={level} onChange={(event) => setLevel(event.target.value as LevelFilter)}>
                <option value="all">{t('page.findings.filter.allLevels')}</option>
                {levels.map((entry) => <option value={entry.level} key={entry.level}>{t('md.priority.count', { level: levelName(entry.level), count: entry.count })}</option>)}
              </select>
            </label>
            <label className="findings-filter" data-part="findings-owner-filter">
              <span>{t('page.findings.filter.owner')}</span>
              <select value={owner} onChange={(event) => setOwner(event.target.value as OwnerFilter)}>
                <option value="all">{t('page.findings.filter.allOwners')}</option>
                <option value="system">{t('page.findings.filter.system')}</option>
                {ownerFeatures.map((feature) => <option value={`feature:${feature.id}`} key={feature.id}>{t('md.summary.feature', { id: feature.id, name: feature.name })}</option>)}
              </select>
            </label>
            <p className="muted" role="status">{t('page.findings.shown', { shown: shown.length, total: data.findings.length })}</p>
          </div>
          {shown.length === 0 && <p className="muted" data-part="findings-no-match">{t('page.findings.noMatch')}</p>}
          {FINDING_CATEGORIES.filter((name) => shown.some((group) => group.category === name)).map((name) => {
            const heading = t(findingCategoryKey(name));
            const own = data.findings.filter((group) => group.category === name);
            const remedy = data.remedies.categories.find((entry) => entry.category === name);
            const title = t('md.priority.categoryHeading', { category: heading, count: own.length, p0: own.filter((group) => group.priority?.level === 'P0').length });
            return (
              <section className="section" key={name} data-category={name} aria-labelledby={`findings-${name}`}>
                <h2 className="section-title" id={`findings-${name}`}>{title}</h2>
                {remedy !== undefined && (
                  <div className="category-remedy" data-part="category-remedy">
                    <p><span className="inline-label">{t('page.remedies.cause')}</span> {remedy.cause}</p>
                    <p><span className="inline-label">{t('page.remedies.measure')}</span> {remedy.measure}</p>
                  </div>
                )}
                <TableScroll label={heading} wide>
                  <thead>
                    <tr>
                      <th scope="col">{t('page.findings.filter.level')}</th>
                      <th scope="col">{t('page.findings.filter.owner')}</th>
                      <th scope="col">{t('md.findings.claimLabel')}</th>
                      {view === 'technical' && <th scope="col">{t('md.locations.heading')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.filter((group) => group.category === name).map((group) => {
                      const [first, ...others] = group.items;
                      return (
                        <tr key={first.id} data-group={group.items.length > 1 ? 'merged' : 'single'} data-level={group.priority?.level ?? 'none'}>
                          <Cell><PriorityBadge priority={group.priority} /></Cell>
                          <Cell row>
                            <ul className="plain-list" data-part="findings-owners">
                              {group.owners.map((one) => <li key={`${one.kind}:${one.id}`}><Owner owner={one} /></li>)}
                            </ul>
                          </Cell>
                          <Cell>
                            {first.text}
                            {group.priority !== null && <p className="muted" data-part="findings-reason">{t('page.findings.reason', { reason: group.priority.reason })}</p>}
                            {others.length > 0 && (
                              <details data-part="findings-others">
                                <summary>{t('page.findings.others', { count: others.length })}</summary>
                                <ul className="plain-list">
                                  {others.map((other) => (
                                    <li key={other.id}>{view === 'technical' && placesOf(other.id) !== '' ? t('md.findings.otherItemTechnical', { owner: ownerText(t, other.owner), text: other.text, places: placesOf(other.id) }) : t('md.findings.otherItem', { owner: ownerText(t, other.owner), text: other.text })}</li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </Cell>
                          {view === 'technical' && <Cell>{placesOf(first.id) || undefined}</Cell>}
                        </tr>
                      );
                    })}
                  </tbody>
                </TableScroll>
              </section>
            );
          })}
        </>
      )}
    </article>
  );
}
