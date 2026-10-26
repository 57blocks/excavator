import { shortRevision } from '../lib/filter';
import { featureHash, findingsHash } from '../lib/route';
import type { Route } from '../lib/route';
import type { Feature, PageData } from '../lib/types';
import { StatusBadge } from './StatusBadge';

interface Props {
  data: PageData;
  route: Route;
  findingCounts: Map<string, number>;
  open: boolean;
  onNavigate: () => void;
}

function NavLink({ href, current, children }: { href: string; current: boolean; children: React.ReactNode }) {
  return <a className="nav-link" href={href} aria-current={current ? 'page' : undefined}>{children}</a>;
}

const FeatureLink = ({ feature, route, count }: { feature: Feature; route: Route; count: number }) => (
  <NavLink href={featureHash(feature.id)} current={route.name === 'feature' && route.id === feature.id}>
    <span className="grow"><span className="nav-id">{feature.id}</span>{feature.name}</span>
    <StatusBadge status={feature.status} />
    <span className="nav-count" title={`${count} findings`}>{count}</span>
  </NavLink>
);

/** The fixed left column: the project, the three pages, then every feature in chapter order. */
export function Sidebar({ data, route, findingCounts, open, onNavigate }: Props) {
  return (
    <nav className="sidebar" id="sidebar" aria-label="Report" data-open={open} onClick={(event) => {
      if ((event.target as HTMLElement).closest('a')) onNavigate();
    }}>
      <div className="sidebar-inner">
        <div className="sidebar-head">
          <h2 className="sidebar-project">{data.project}</h2>
          <div className="sidebar-sub" title={data.sourceRevision}>{shortRevision(data.sourceRevision)}</div>
        </div>
        <div className="nav-group">
          <NavLink href="#/" current={route.name === 'overview'}><span className="grow">Overview</span></NavLink>
          <NavLink href={findingsHash()} current={route.name === 'findings'}>
            <span className="grow">Findings</span><span className="nav-count">{data.findings.length}</span>
          </NavLink>
          <NavLink href="#/coverage" current={route.name === 'coverage'}><span className="grow">Coverage</span></NavLink>
        </div>
        <div className="nav-group" aria-label="Features">
          <div className="nav-label">Features ({data.features.length})</div>
          {data.features.map((feature) => (
            <FeatureLink key={feature.id} feature={feature} route={route} count={findingCounts.get(feature.id) ?? 0} />
          ))}
        </div>
      </div>
    </nav>
  );
}
