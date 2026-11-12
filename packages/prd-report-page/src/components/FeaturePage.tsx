import { dropDuplicateTitle } from '../lib/chapter';
import { evidenceLocation } from '../lib/filter';
import { LEVELS, LEVEL_LABELS, levelOf } from '../lib/matrix';
import { neighbours } from '../lib/nav';
import { featureHash } from '../lib/route';
import { scrollToElement } from '../lib/scroll';
import type { Feature, Finding } from '../lib/types';
import { FindingCard } from './FindingCard';
import { Markdown } from './Markdown';
import { SectionHeading } from './SectionHeading';
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
  if (names.length === 0) return <span className="none">None</span>;
  return <div className="chips">{names.map((name) => <span className="chip" key={name}>{name}</span>)}</div>;
}

/** The findings summary bar: the total and each level that has findings; a click scrolls to the findings of this page. */
function FindingsSummary({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return <div className="findings-summary is-empty" data-findings-summary="none">No findings are recorded for this feature.</div>;
  const perLevel = LEVELS.map((level) => ({ level, count: findings.filter((finding) => levelOf(finding) === level).length })).filter((item) => item.count > 0);
  return (
    <button type="button" className="findings-summary" data-findings-summary={findings.length}
      onClick={() => { const target = document.getElementById('section-findings'); if (target !== null) scrollToElement(target); }}>
      <span className="findings-summary-total"><b>{findings.length}</b> {findings.length === 1 ? 'finding' : 'findings'}</span>
      <span className="findings-summary-levels">
        {perLevel.map(({ level, count }) => <span key={level} className={`badge badge-priority-${level}`}>{LEVEL_LABELS[level]} <b>{count}</b></span>)}
      </span>
      <span className="findings-summary-go">Go to findings <span aria-hidden="true">&darr;</span></span>
    </button>
  );
}

/** The previous and next feature in chapter order. */
function Pager({ features, id }: { features: Feature[]; id: string }) {
  const { previous, next } = neighbours(features, id);
  if (previous === null && next === null) return null;
  return (
    <nav className="pager" aria-label="Neighbouring features">
      {previous !== null ? <a className="pager-link pager-prev" href={featureHash(previous.id)} rel="prev"><span className="pager-dir">&larr; Previous</span><span className="pager-name"><span className="nav-id">{previous.id}</span>{previous.name}</span></a> : <span />}
      {next !== null ? <a className="pager-link pager-next" href={featureHash(next.id)} rel="next"><span className="pager-dir">Next &rarr;</span><span className="pager-name"><span className="nav-id">{next.id}</span>{next.name}</span></a> : <span />}
    </nav>
  );
}

/**
 * `#/feature/<id>` (design D3): labels and title, the facts (actors and roles always
 * shown, triggers, flows and entrypoints folded with their counts), the
 * findings summary, the chapter, the findings, the verification report and the
 * neighbouring features.
 */
export function FeaturePage({ feature, findings, features }: { feature: Feature; findings: Finding[]; features: Feature[] }) {
  return (
    <div className="page" data-view="feature" data-feature={feature.id}>
      <div className="labels">
        <span className="label-id">{feature.id}</span>
        <span className="label-kind">{feature.kind}</span>
        <StatusBadge status={feature.status} />
      </div>
      <h1>{feature.name}</h1>

      {feature.failure !== null && (
        <div className="notice notice-failed" role="alert" data-failure={feature.failure.step}>
          <p><strong>Failed at step {feature.failure.step}</strong></p>
          <ul>{feature.failure.reasons.map((reason, at) => <li key={at}>{reason}</li>)}</ul>
        </div>
      )}

      <section className="facts" aria-label="Facts" data-section="facts">
        <dl className="kv">
          <dt>Actors</dt>
          <dd><NameChips names={feature.actors} /></dd>
          <dt>Permission roles</dt>
          <dd><NameChips names={feature.permissionRoles} /></dd>
        </dl>
        <details className="fold" data-fold="triggers">
          <summary>Triggers ({feature.triggers.length})</summary>
          {feature.triggers.length === 0 ? <p className="none">None</p> : <ul className="plain-list">{feature.triggers.map((trigger, at) => <li key={at}>{trigger}</li>)}</ul>}
        </details>
        <details className="fold" data-fold="flows">
          <summary>Flows ({feature.flows.length})</summary>
          {feature.flows.length === 0 ? <p className="none">None</p> : <ol className="plain-list">{feature.flows.map((flow, at) => <li key={at}>{flow}</li>)}</ol>}
        </details>
        <details className="fold" data-fold="entrypoints">
          <summary>Entrypoints ({feature.entrypoints.length})</summary>
          {feature.entrypoints.length === 0 ? <p className="none">None</p> : (
            <ul className="loc-list">
              {feature.entrypoints.map((entry) => (
                <li key={entry.id}><span className="loc">{evidenceLocation(entry)}</span> <span className="chip">{entry.kind}</span> <span className="chip">{entry.framework}</span></li>
              ))}
            </ul>
          )}
        </details>
      </section>

      <FindingsSummary findings={findings} />

      {feature.body === null ? (
        <div className="notice" data-chapter="none"><p>{noChapterText(feature)}</p></div>
      ) : (
        <div className="chapter" data-chapter="body"><Markdown source={dropDuplicateTitle(feature.body, feature.name)} idPrefix={feature.id} /></div>
      )}

      <SectionHeading id="findings" name="Findings" label={<>Findings <span className="section-count">{findings.length}, anchor-checked</span></>} />
      {findings.length === 0 ? <div className="empty">No findings are recorded for this feature.</div> : (
        <div data-findings-list="feature">{findings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}</div>
      )}

      <details className="section-details" id="section-verification" data-section="verification" data-outline="section" data-outline-label="Verification report">
        <summary>Verification report</summary>
        <div className="inner">
          {feature.verificationReport === null
            ? <p>This feature has no verification report: its status is {feature.status}.</p>
            : <Markdown source={feature.verificationReport} idPrefix={`${feature.id}-verification`} outline={false} />}
        </div>
      </details>

      <Pager features={features} id={feature.id} />
    </div>
  );
}
