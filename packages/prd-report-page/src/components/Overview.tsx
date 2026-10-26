import { statusCounts } from '../lib/counts';
import { featureHash, findingsHash } from '../lib/route';
import { VERIFICATION_KEYS } from '../lib/types';
import type { Feature, Finding, PageData } from '../lib/types';
import { FlowIndex } from './FlowIndex';
import { Markdown } from './Markdown';
import { StatusBadge } from './StatusBadge';

const VERIFICATION_LABELS: Record<(typeof VERIFICATION_KEYS)[number], string> = {
  verified: 'Verified',
  contradicted: 'Contradicted',
  misattributed: 'Misattributed',
  unverifiable: 'Unverifiable',
  resolvedRight: 'Resolved right',
  resolvedWrong: 'Resolved wrong',
  stillOpen: 'Still open',
  conflicts: 'Conflicts',
  notChecked: 'Not checked',
};
const LEVELS: { key: keyof PageData['counts']['findings']['priority']; label: string }[] = [
  { key: 'P0', label: 'P0' },
  { key: 'P1', label: 'P1' },
  { key: 'P2', label: 'P2' },
  { key: 'unranked', label: 'Unranked' },
];
const STATEMENT_KEYS = VERIFICATION_KEYS.slice(0, 4);
const OPEN_ITEM_KEYS = VERIFICATION_KEYS.slice(4);

const Card = ({ value, label, sub }: { value: number; label: string; sub?: string }) => (
  <div className="card">
    <div className="num">{value}</div>
    <div className="lbl">{label}</div>
    {sub !== undefined && <div className="sub">{sub}</div>}
  </div>
);

function FeatureTable({ features, byFeature }: { features: Feature[]; byFeature: Map<string, Finding[]> }) {
  return (
    <div className="table-scroll">
      <table data-table="features">
        <thead>
          <tr>
            <th>Feature</th><th>Kind</th><th>Status</th>
            <th className="num">Findings</th>
            {STATEMENT_KEYS.map((key) => <th className="num" key={key}>{VERIFICATION_LABELS[key]}</th>)}
          </tr>
        </thead>
        <tbody>
          {features.map((feature) => {
            const verification = feature.counts.verification;
            return (
              <tr key={feature.id} data-feature-row={feature.id}>
                <td><a href={featureHash(feature.id)}><span className="nav-id">{feature.id}</span>{feature.name}</a></td>
                <td>{feature.kind}</td>
                <td><StatusBadge status={feature.status} /></td>
                <td className="num">{byFeature.get(feature.id)?.length ?? 0}</td>
                {STATEMENT_KEYS.map((key) => <td className="num" key={key}>{verification === null ? '-' : verification[key]}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** `#/`: the run's facts, the counts, the overview text and the feature table. */
export function Overview({ data, byFeature }: { data: PageData; byFeature: Map<string, Finding[]> }) {
  const perStatus = statusCounts(data.features);
  const verification = data.counts.verification;
  return (
    <div className="page" data-view="overview">
      <h1>{data.project}</h1>
      <p className="lede">PRD report</p>
      <div className="meta-row">
        <span><b>Language</b>{data.language}</span>
        <span><b>Reader</b>{data.role}</span>
        <span><b>Scope</b>{data.scope ?? 'whole project'}</span>
        <span><b>Revision</b><code className="loc">{data.sourceRevision}</code></span>
      </div>

      <div className="card-group-title">Features</div>
      <div className="cards" data-cards="features">
        <Card value={data.features.length} label="Features" sub={`${data.counts.diagrams} diagrams`} />
        {(Object.keys(perStatus) as (keyof typeof perStatus)[]).filter((status) => perStatus[status] > 0).map((status) => (
          <div className="card" key={status} data-status-card={status}>
            <div className="num">{perStatus[status]}</div>
            <div className="lbl"><StatusBadge status={status} /></div>
          </div>
        ))}
      </div>

      <div className="card-group-title">Findings, anchor-checked</div>
      <div className="cards" data-cards="findings">
        <Card value={data.findings.length} label="Findings" />
        <a className="card-link" href={findingsHash({ class: 'product' })}><Card value={data.counts.findings.product} label="Product" /></a>
        <a className="card-link" href={findingsHash({ class: 'technical' })}><Card value={data.counts.findings.technical} label="Technical" /></a>
      </div>
      <div className="cards" data-cards="findings-by-level">
        {LEVELS.map(({ key, label }) => (
          <a className="card-link" key={key} href={findingsHash({ priority: key })} data-level-card={key}><Card value={data.counts.findings.priority[key]} label={label} /></a>
        ))}
      </div>

      <div className="card-group-title">Verification, all verified features</div>
      <div className="cards" data-cards="verification">
        {STATEMENT_KEYS.map((key) => <Card key={key} value={verification[key]} label={VERIFICATION_LABELS[key]} sub="statements" />)}
        {OPEN_ITEM_KEYS.slice(0, 3).map((key) => <Card key={key} value={verification[key]} label={VERIFICATION_LABELS[key]} sub="open items" />)}
        {OPEN_ITEM_KEYS.slice(3).map((key) => <Card key={key} value={verification[key]} label={VERIFICATION_LABELS[key]} sub={key === 'conflicts' ? 'cross-section' : undefined} />)}
      </div>

      <div style={{ marginTop: 40 }}><Markdown source={data.overview} idPrefix="overview" /></div>

      <h2 className="section" data-section="terminology">Terminology</h2>
      <Markdown source={data.tables.terminology} idPrefix="terminology" />

      <h2 className="section" data-section="flow-index">Flow index</h2>
      <FlowIndex features={data.features} />

      <h2 className="section" data-section="roles">Roles</h2>
      <Markdown source={data.tables.roles} idPrefix="roles" />

      <h2 className="section" data-section="open-items">Open items</h2>
      <Markdown source={data.tables.openItems} idPrefix="open-items" />

      <h2 className="section">Features</h2>
      <FeatureTable features={data.features} byFeature={byFeature} />
    </div>
  );
}
