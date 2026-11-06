import { useState } from 'react';

import { useLinks, useView } from '../lib/links';
import { useText } from '../lib/text';
import { FINDING_CATEGORIES, findingCategoryKey } from '../lib/types';
import type { Finding, FindingCategory, PageData } from '../lib/types';
import { placeText } from './Locations';
import { Cell, TableScroll } from './Tables';

/** Every finding when `category` is null, else those of that category. A new list; the given one is not changed. */
export function filterFindings(list: Finding[], category: FindingCategory | null): Finding[] {
  return category === null ? [...list] : list.filter((finding) => finding.category === category);
}

/** The findings by category in the fixed order of the categories, zeros included. */
export const countByCategory = (list: Finding[]): { category: FindingCategory; count: number }[] =>
  FINDING_CATEGORIES.map((category) => ({ category, count: list.filter((finding) => finding.category === category).length }));

/**
 * The findings page (both views): the verified findings of all features by
 * category, each with its feature and statement, filterable by category; the
 * technical view adds the file and lines of each finding's quoted passages.
 */
export function FindingsPage({ data }: { data: PageData }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const [selected, setSelected] = useState<number>(-1);
  const category = selected < 0 ? null : FINDING_CATEGORIES[selected] ?? null;
  const shown = filterFindings(data.findings, category);
  const counts = countByCategory(data.findings);
  const featureOf = new Map(data.features.map((feature) => [feature.id, feature]));
  const places = new Map((view === 'technical' ? data.technical?.findingLocations ?? [] : []).map((entry) => [entry.id, entry.citations]));
  const verified = data.features.filter((feature) => feature.findingsStatus === 'verified').length;
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
          verified,
          featureTotal: data.features.length,
          categories: counts.map((entry) => t('md.findings.categoryCount', { category: t(findingCategoryKey(entry.category)), count: entry.count })).join('; '),
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
            <p className="muted" role="status">{t('page.findings.shown', { shown: shown.length, total: data.findings.length })}</p>
          </div>
          {shown.length === 0 && <p className="muted" data-part="findings-no-match">{t('page.findings.noMatch')}</p>}
          {FINDING_CATEGORIES.filter((name) => shown.some((finding) => finding.category === name)).map((name) => {
            const heading = t(findingCategoryKey(name));
            return (
              <section className="section" key={name} data-category={name} aria-labelledby={`findings-${name}`}>
                <h2 className="section-title" id={`findings-${name}`}>{heading}</h2>
                <TableScroll label={heading} wide>
                  <thead>
                    <tr>
                      <th scope="col">{t('md.table.feature')}</th>
                      <th scope="col">{t('md.findings.claimLabel')}</th>
                      {view === 'technical' && <th scope="col">{t('md.locations.heading')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.filter((finding) => finding.category === name).map((finding) => {
                      const feature = featureOf.get(finding.feature);
                      return (
                        <tr key={finding.id}>
                          <Cell row><a href={nav.feature(finding.feature)}>{t('md.summary.feature', { id: finding.feature, name: feature?.name ?? '' })}</a></Cell>
                          <Cell>{finding.text}</Cell>
                          {view === 'technical' && <Cell>{(places.get(finding.id) ?? []).map((place) => placeText(t, place)).join('; ') || undefined}</Cell>}
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
