import { dropDuplicateTitle } from '../lib/chapter';
import { evidenceLocation } from '../lib/filter';
import type { Feature, Finding } from '../lib/types';
import { FindingCard } from './FindingCard';
import { Markdown } from './Markdown';
import { StatusBadge } from './StatusBadge';

function noChapterText(feature: Feature): string {
  switch (feature.status) {
    case 'failed':
      return 'This feature has no chapter: it failed (see the reasons above).';
    case 'planned':
      return 'This feature has no chapter yet: its status is planned, so its lane has not written one.';
    default:
      return `This feature has no chapter: its status is ${feature.status}.`;
  }
}

/** A feature's actors or permission roles as chips; an empty list reads None, so a missing answer is visible. */
function NameChips({ names }: { names: string[] }) {
  if (names.length === 0) return <>None</>;
  return <div className="chips">{names.map((name) => <span className="chip" key={name}>{name}</span>)}</div>;
}

/** `#/feature/<id>`: the chapter, the findings of this feature and its verification report. */
export function FeaturePage({ feature, findings }: { feature: Feature; findings: Finding[] }) {
  return (
    <div className="page narrow" data-view="feature" data-feature={feature.id}>
      <div className="chips" style={{ marginBottom: 10 }}>
        <span className="chip">{feature.id}</span>
        <span className="chip">{feature.kind}</span>
        <StatusBadge status={feature.status} />
      </div>
      <h1>{feature.name}</h1>

      {feature.failure !== null && (
        <div className="notice notice-failed" role="alert" data-failure={feature.failure.step}>
          <p><strong>Failed at step {feature.failure.step}</strong></p>
          <ul>{feature.failure.reasons.map((reason, at) => <li key={at}>{reason}</li>)}</ul>
        </div>
      )}

      <dl className="kv">
        <dt>Actors</dt>
        <dd><NameChips names={feature.actors} /></dd>
        <dt>Permission roles</dt>
        <dd><NameChips names={feature.permissionRoles} /></dd>
        {feature.flows.length > 0 && (
          <>
            <dt>Flows</dt>
            <dd><ul className="loc-list" style={{ listStyle: 'disc', paddingLeft: 18 }}>{feature.flows.map((flow, at) => <li key={at}>{flow}</li>)}</ul></dd>
          </>
        )}
        {feature.triggers.length > 0 && (
          <>
            <dt>Triggers</dt>
            <dd><ul className="loc-list" style={{ listStyle: 'disc', paddingLeft: 18 }}>{feature.triggers.map((trigger, at) => <li key={at}>{trigger}</li>)}</ul></dd>
          </>
        )}
        <dt>Entrypoints</dt>
        <dd>
          {feature.entrypoints.length === 0 ? 'None' : (
            <ul className="loc-list">
              {feature.entrypoints.map((entry) => (
                <li key={entry.id}><span className="loc">{evidenceLocation(entry)}</span> <span className="chip">{entry.kind}</span> <span className="chip">{entry.framework}</span></li>
              ))}
            </ul>
          )}
        </dd>
      </dl>

      {feature.body === null ? (
        <div className="notice" data-chapter="none"><p>{noChapterText(feature)}</p></div>
      ) : (
        <div style={{ marginTop: 28 }} data-chapter="body"><Markdown source={dropDuplicateTitle(feature.body, feature.name)} idPrefix={feature.id} /></div>
      )}

      <h2 className="section">Findings in this feature <span className="nav-count">({findings.length}, anchor-checked)</span></h2>
      {findings.length === 0 ? <div className="empty">No findings are recorded for this feature.</div> : (
        <div data-findings-list="feature">{findings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}</div>
      )}

      <details className="section-details" data-section="verification">
        <summary>Verification report</summary>
        <div className="inner">
          {feature.verificationReport === null
            ? <p>This feature has no verification report: its status is {feature.status}.</p>
            : <Markdown source={feature.verificationReport} idPrefix={`${feature.id}-verification`} />}
        </div>
      </details>
    </div>
  );
}
