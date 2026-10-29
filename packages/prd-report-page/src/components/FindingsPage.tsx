import { useEffect, useMemo, useRef, useState } from 'react';

import { useMediaQuery } from '../lib/use-media';

import { facetCounts, filterFindings } from '../lib/filter';
import { groupByLevel } from '../lib/matrix';
import { serializeRoute } from '../lib/route';
import type { ClassFilter, FindingsFilters, PriorityFilter } from '../lib/route';
import type { PageData } from '../lib/types';
import { FindingCard } from './FindingCard';
import { ChevronIcon } from './Icons';

const CLASS_OPTIONS: { value: ClassFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'product', label: 'Product' },
  { value: 'technical', label: 'Technical' },
];

const PRIORITY_OPTIONS: { value: PriorityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'P0', label: 'P0' },
  { value: 'P1', label: 'P1' },
  { value: 'P2', label: 'P2' },
  { value: 'unranked', label: 'Unranked' },
];

/** Replace the fragment without adding a history entry per keystroke. */
function setFilters(filters: FindingsFilters) {
  window.location.replace(serializeRoute({ name: 'findings', filters }));
}

/**
 * `#/findings?class=&priority=&feature=&q=`: every finding, filtered; the filters
 * are the fragment (design D4). The filter bar stays under the top bar while the
 * list scrolls, each segment says how many findings it would show under the
 * other filters, and the list gets a heading wherever the level changes.
 */
export function FindingsPage({ data, filters }: { data: PageData; filters: FindingsFilters }) {
  const [text, setText] = useState(filters.q);
  const roomy = useMediaQuery('(min-width: 640px)');
  const [folded, setFolded] = useState(true);
  const expanded = roomy || !folded;
  const pushed = useRef(filters.q);
  useEffect(() => {
    // A link or the back button changed q: show it in the box.
    if (filters.q !== pushed.current) {
      pushed.current = filters.q;
      setText(filters.q);
    }
  }, [filters.q]);

  const shown = useMemo(() => filterFindings(data.findings, filters), [data.findings, filters]);
  const facets = useMemo(() => facetCounts(data.findings, filters), [data.findings, filters]);
  const groups = useMemo(() => groupByLevel(shown), [shown]);
  const names = useMemo(() => new Map(data.features.map((feature) => [feature.id, feature.name])), [data.features]);
  const summary = useMemo(() => {
    const parts: string[] = [];
    if (filters.class !== 'all') parts.push(filters.class === 'product' ? 'Product' : 'Technical');
    if (filters.priority !== 'all') parts.push(filters.priority === 'unranked' ? 'Unranked' : filters.priority);
    if (filters.feature !== '') parts.push(filters.feature);
    if (filters.q.trim() !== '') parts.push(`\u201c${filters.q.trim()}\u201d`);
    return parts.length === 0 ? 'No filters' : parts.join(' \u00b7 ');
  }, [filters]);
  const unknownFeature = filters.feature !== '' && !names.has(filters.feature);

  return (
    <div className="page" data-view="findings">
      <h1>Findings</h1>
      <p className="lede">Anchor-checked: the script checked that each quoted passage occurs in its file. It did not check that a statement is true.</p>

      <div className="filter-bar" role="search" aria-label="Filter findings" data-expanded={expanded}>
        <button type="button" className="filter-toggle" aria-expanded={expanded} aria-controls="filter-fields" onClick={() => setFolded(!folded)}>
          <span className="filter-toggle-chev" aria-hidden="true"><ChevronIcon /></span>
          <span className="filter-toggle-name">Filters</span>
          <span className="filter-toggle-summary">{summary}</span>
        </button>
        <div className="filter-fields" id="filter-fields" hidden={!expanded}>
        <div className="filter-group">
          <span className="group-label" id="class-label">Class</span>
          <div className="seg" role="group" aria-labelledby="class-label">
            {CLASS_OPTIONS.map((option) => (
              <button key={option.value} type="button" aria-pressed={filters.class === option.value} data-class-filter={option.value}
                onClick={() => setFilters({ ...filters, class: option.value })}>{option.label}<span className="seg-count">{facets.class[option.value]}</span></button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="group-label" id="priority-label">Level</span>
          <div className="seg" role="group" aria-labelledby="priority-label">
            {PRIORITY_OPTIONS.map((option) => (
              <button key={option.value} type="button" aria-pressed={filters.priority === option.value} data-priority-filter={option.value}
                onClick={() => setFilters({ ...filters, priority: option.value })}>{option.label}<span className="seg-count">{facets.priority[option.value]}</span></button>
            ))}
          </div>
        </div>
        <div className="filter-group filter-feature">
          <select id="feature-filter" aria-label="Feature" value={filters.feature} onChange={(event) => setFilters({ ...filters, feature: event.target.value })}>
            <option value="">All features</option>
            {unknownFeature && <option value={filters.feature}>{filters.feature} (not in this report)</option>}
            {data.features.map((feature) => <option key={feature.id} value={feature.id}>{feature.id} {feature.name}</option>)}
          </select>
        </div>
        <div className="filter-group filter-search">
          <input id="text-filter" type="search" aria-label="Search statements and passages" value={text} placeholder="Search statements and passages" onChange={(event) => {
            setText(event.target.value);
            pushed.current = event.target.value;
            setFilters({ ...filters, q: event.target.value });
          }} />
        </div>
        </div>
        <div className="result-count" role="status" data-result-count={shown.length}>
          <span className="count-word">Showing </span><b>{shown.length}</b> of {data.findings.length}
        </div>
      </div>

      {shown.length === 0 ? <div className="empty">No finding matches these filters.</div> : (
        <div data-findings-list="all">
          {groups.map((group, at) => (
            <section key={`${group.level}-${at}`} className="level-group" aria-label={`${group.label} findings`} data-level-group={group.level}>
              <h2 className="level-heading"><span className={`level-dot level-dot-${group.level}`} aria-hidden="true" />{group.label} &middot; <span className="level-count">{group.findings.length}</span></h2>
              {group.findings.map((finding) => <FindingCard key={finding.id} finding={finding} featureName={names.get(finding.feature) ?? ''} />)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
