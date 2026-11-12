import { useEffect, useMemo, useRef, useState } from 'react';

import { filterNav, groupFeatures } from '../lib/nav';
import { LEVELS, LEVEL_LABELS } from '../lib/matrix';
import type { LevelCounts } from '../lib/matrix';
import { featureHash } from '../lib/route';
import type { Route } from '../lib/route';
import type { Feature } from '../lib/types';
import { StatusMark } from './StatusBadge';

interface Props {
  features: Feature[];
  route: Route;
  levels: Map<string, LevelCounts>;
  open: boolean;
  onNavigate: () => void;
}

const EMPTY: LevelCounts = { P0: 0, P1: 0, P2: 0, unranked: 0 };

/** The tooltip of a count: the total and each level that has findings. */
function countTitle(levels: LevelCounts): string {
  const total = LEVELS.reduce((sum, level) => sum + levels[level], 0);
  if (total === 0) return 'No findings';
  const parts = LEVELS.filter((level) => levels[level] > 0).map((level) => `${LEVEL_LABELS[level]} ${levels[level]}`);
  return `${total} ${total === 1 ? 'finding' : 'findings'}: ${parts.join(', ')}`;
}

function FeatureRow({ feature, current, levels }: { feature: Feature; current: boolean; levels: LevelCounts }) {
  const total = LEVELS.reduce((sum, level) => sum + levels[level], 0);
  return (
    <a className="rail-row" href={featureHash(feature.id)} aria-current={current ? 'page' : undefined} title={`${feature.id} ${feature.name} (${feature.status})`} data-rail-feature={feature.id}>
      <span className="rail-id">{feature.id}</span>
      <span className="rail-name">{feature.name}</span>
      <StatusMark status={feature.status} />
      <span className="rail-count" title={countTitle(levels)} data-zero={total === 0}>
        {levels.P0 > 0 && <span className="p0-dot" aria-hidden="true" />}
        {total}
        <span className="sr-only">{total === 1 ? ' finding' : ' findings'}{levels.P0 > 0 ? `, ${levels.P0} at level P0` : ''}</span>
      </span>
    </a>
  );
}

/**
 * The feature rail (design D1): a filter box, then the features grouped by kind,
 * each group in chapter order with its count. Below 1024px it is a drawer the
 * top bar's Menu button opens.
 */
export function Sidebar({ features, route, levels, open, onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => filterNav(features, query), [features, query]);
  const groups = useMemo(() => groupFeatures(shown), [shown]);
  const innerRef = useRef<HTMLDivElement>(null);
  const currentId = route.name === 'feature' ? route.id : '';

  // Keep the open feature in view in a long list: only the rail scrolls, never the page.
  useEffect(() => {
    const inner = innerRef.current;
    const row = inner?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!inner || !row) return;
    const top = row.offsetTop - inner.offsetTop;
    if (top < inner.scrollTop + 48 || top + row.offsetHeight > inner.scrollTop + inner.clientHeight - 16) inner.scrollTop = Math.max(0, top - inner.clientHeight / 3);
  }, [currentId, open]);

  return (
    <nav className="rail" id="rail" aria-label="Features" data-open={open} onClick={(event) => {
      if ((event.target as HTMLElement).closest('a')) onNavigate();
    }}>
      <div className="rail-filter">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter features" aria-label="Filter features by id or name" data-rail-filter />
      </div>
      <div className="rail-scroll" ref={innerRef}>
        {groups.length === 0 && <div className="rail-empty">No feature matches.</div>}
        {groups.map((group) => (
          <section className="rail-group" key={group.kind} aria-label={group.label} data-rail-group={group.kind}>
            <h2 className="rail-group-title"><span>{group.label}</span><span className="rail-group-count">{group.features.length}</span></h2>
            {group.features.map((feature) => (
              <FeatureRow key={feature.id} feature={feature} current={currentId === feature.id} levels={levels.get(feature.id) ?? EMPTY} />
            ))}
          </section>
        ))}
      </div>
    </nav>
  );
}
