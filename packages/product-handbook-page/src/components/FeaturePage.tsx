import { useLinks } from '../lib/links';
import { useText } from '../lib/text';
import type { Area, Feature, FindingGroup, UnitLocations } from '../lib/types';
import { Crumbs } from './Crumbs';
import { FeatureDetail } from './FeatureDetail';
import { ReachBadge } from './ReachBadge';

/** One feature (`featureNames`: the name of each feature by id, for the features an operation hands over to): its domain (and, when the page groups by business domain, the area of the navigation it sits in), how readers get to it, and the checked entry, or why there is none, then its verified findings; in the technical view, the file and lines of each cited item. */
export function FeaturePage({ feature, findings, domain, area, locations, featureNames = new Map() }: { feature: Feature; findings: FindingGroup[]; domain: Area | undefined; area: Area | undefined; locations?: UnitLocations; featureNames?: Map<string, string> }) {
  const t = useText();
  const nav = useLinks();
  return (
    <article className="page" data-view="feature" data-feature={feature.id}>
      <Crumbs trail={[...(domain === undefined ? [] : [<a href={nav.domain(domain.id)}>{domain.name}</a>]), feature.name]} />
      <header className="page-head">
        <h1 className="page-title">{feature.name}</h1>
        <div className="feature-facts">
          <ReachBadge reach={feature.reach} />
          {feature.label !== undefined && <span className="shown-as">{t('md.feature.label', { label: feature.label })}</span>}
          {area !== undefined && <span className="shown-as">{t('md.feature.area', { area: area.name })}</span>}
        </div>
      </header>
      <FeatureDetail feature={feature} findings={findings} locations={locations} featureNames={featureNames} />
    </article>
  );
}
