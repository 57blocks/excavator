import { useEffect, useRef, useState } from 'react';

import { filterFindings } from '../lib/filter';
import { serializeRoute } from '../lib/route';
import type { ClassFilter, FindingsFilters, PriorityFilter } from '../lib/route';
import type { PageData } from '../lib/types';
import { FindingCard } from './FindingCard';

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

/** `#/findings?class=&priority=&feature=&q=`: every finding, filtered; the filters are the fragment. */
export function FindingsPage({ data, filters }: { data: PageData; filters: FindingsFilters }) {
  const [text, setText] = useState(filters.q);
  const pushed = useRef(filters.q);
  useEffect(() => {
    // A link or the back button changed q: show it in the box.
    if (filters.q !== pushed.current) {
      pushed.current = filters.q;
      setText(filters.q);
    }
  }, [filters.q]);

  const shown = filterFindings(data.findings, filters);
  const names = new Map(data.features.map((feature) => [feature.id, feature.name]));
  const unknownFeature = filters.feature !== '' && !names.has(filters.feature);

  return (
    <div className="page" data-view="findings">
      <h1>Findings</h1>
      <p className="lede">Anchor-checked: the script checked that each quoted passage occurs in its file. It did not check that a statement is true.</p>

      <div className="filters" role="search">
        <div>
          <span className="group-label" id="class-label">Class</span>
          <div className="seg" role="group" aria-labelledby="class-label">
            {CLASS_OPTIONS.map((option) => (
              <button key={option.value} type="button" aria-pressed={filters.class === option.value} data-class-filter={option.value}
                onClick={() => setFilters({ ...filters, class: option.value })}>{option.label}</button>
            ))}
          </div>
        </div>
        <div>
          <span className="group-label" id="priority-label">Level</span>
          <div className="seg" role="group" aria-labelledby="priority-label">
            {PRIORITY_OPTIONS.map((option) => (
              <button key={option.value} type="button" aria-pressed={filters.priority === option.value} data-priority-filter={option.value}
                onClick={() => setFilters({ ...filters, priority: option.value })}>{option.label}</button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="feature-filter">Feature</label>
          <select id="feature-filter" value={filters.feature} onChange={(event) => setFilters({ ...filters, feature: event.target.value })}>
            <option value="">All features</option>
            {unknownFeature && <option value={filters.feature}>{filters.feature} (not in this report)</option>}
            {data.features.map((feature) => <option key={feature.id} value={feature.id}>{feature.id} {feature.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="text-filter">Search statements and passages</label>
          <input id="text-filter" type="search" value={text} placeholder="Search" onChange={(event) => {
            setText(event.target.value);
            pushed.current = event.target.value;
            setFilters({ ...filters, q: event.target.value });
          }} />
        </div>
      </div>

      <div className="result-count" role="status" data-result-count={shown.length}>
        Showing {shown.length} of {data.findings.length} findings
      </div>
      {shown.length === 0 ? <div className="empty">No finding matches these filters.</div> : (
        <div data-findings-list="all">
          {shown.map((finding) => <FindingCard key={finding.id} finding={finding} featureName={names.get(finding.feature) ?? ''} />)}
        </div>
      )}
    </div>
  );
}
