import { Fragment, useMemo } from 'react';

import { statusCounts } from '../lib/counts';
import { groupFeatures } from '../lib/nav';
import { LEVELS, LEVEL_LABELS, featureMatrix, hasUnranked } from '../lib/matrix';
import type { Level } from '../lib/matrix';
import { featureHash, findingsHash } from '../lib/route';
import { VERIFICATION_KEYS } from '../lib/types';
import type { Feature, Finding, PageData, VerificationKey } from '../lib/types';
import { FlowIndex } from './FlowIndex';
import { Markdown } from './Markdown';
import { SectionHeading } from './SectionHeading';
import { StatusMark } from './StatusBadge';

const VERIFICATION_LABELS: Record<VerificationKey, string> = {
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
const STATEMENT_KEYS = VERIFICATION_KEYS.slice(0, 4);
const OPEN_ITEM_KEYS = VERIFICATION_KEYS.slice(4);

interface Segment {
  key: string;
  label: string;
  value: number;
  href?: string;
  /** The CSS suffix of the segment's colour. */
  tone: string;
}

/** A horizontal bar cut into one segment per entry, with a legend that writes every number out, so the colours carry nothing alone. */
function StackedBar({ segments, name, dataKey }: { segments: Segment[]; name: string; dataKey: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div data-stack={dataKey}>
      <div className="stackbar" role="img" aria-label={`${name}: ${segments.map((segment) => `${segment.label} ${segment.value}`).join(', ')}`}>
        {segments.filter((segment) => segment.value > 0).map((segment) => (
          <span key={segment.key} className={`stack-seg tone-${segment.tone}`} style={{ flexGrow: segment.value }} />
        ))}
        {total === 0 && <span className="stack-seg tone-none" style={{ flexGrow: 1 }} />}
      </div>
      <ul className="legend">
        {segments.map((segment) => (
          <li key={segment.key} data-level-card={segment.href === undefined ? undefined : segment.key}>
            {segment.href === undefined ? (
              <><span className={`swatch tone-${segment.tone}`} aria-hidden="true" /><span className="legend-label">{segment.label}</span><span className="legend-num">{segment.value}</span></>
            ) : (
              <a href={segment.href}><span className={`swatch tone-${segment.tone}`} aria-hidden="true" /><span className="legend-label">{segment.label}</span><span className="legend-num">{segment.value}</span></a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, children, dataKey }: { label: string; value: number; children?: React.ReactNode; dataKey: string }) {
  return (
    <section className="stat" aria-label={label} data-cards={dataKey}>
      <div className="stat-num">{value}</div>
      <div className="stat-label">{label}</div>
      {children}
    </section>
  );
}

/** The four blocks above the matrix (design D2): features, diagrams, findings, checked statements. */
function Summary({ data }: { data: PageData }) {
  const perStatus = statusCounts(data.features);
  const groups = groupFeatures(data.features);
  const counts = data.counts.findings;
  const verification = data.counts.verification;
  const statementTotal = STATEMENT_KEYS.reduce((sum, key) => sum + verification[key], 0);
  const levelSegments: Segment[] = LEVELS.map((level) => ({ key: level, label: LEVEL_LABELS[level], value: counts.priority[level], href: findingsHash({ priority: level }), tone: level }));
  const statementTones: Record<string, string> = { verified: 'ok', contradicted: 'P0', misattributed: 'P1', unverifiable: 'P2' };
  return (
    <div className="summary" data-section="summary">
      <div className="summary-col">
      <Stat label="Features" value={data.features.length} dataKey="features">
        <p className="stat-note">{groups.map((group) => `${group.features.length} ${group.label.toLowerCase()}`).join(' · ')}</p>
        <ul className="stat-status">
          {(Object.keys(perStatus) as (keyof typeof perStatus)[]).filter((status) => perStatus[status] > 0).map((status) => (
            <li key={status} data-status-card={status}><StatusMark status={status} /><span className="stat-status-num">{perStatus[status]}</span> {status}</li>
          ))}
        </ul>
      </Stat>
      <Stat label="Diagrams" value={data.counts.diagrams} dataKey="diagrams">
        <p className="stat-note">Mermaid diagrams in the chapters</p>
      </Stat>
      </div>
      <Stat label="Findings, anchor-checked" value={data.findings.length} dataKey="findings">
        <StackedBar segments={levelSegments} name="Findings by level" dataKey="findings-by-level" />
        <p className="stat-note stat-links">
          <a href={findingsHash({ class: 'product' })}>Product <b>{counts.product}</b></a>
          <a href={findingsHash({ class: 'technical' })}>Technical <b>{counts.technical}</b></a>
        </p>
      </Stat>
      <Stat label="Statements checked" value={statementTotal} dataKey="verification">
        <StackedBar
          segments={STATEMENT_KEYS.map((key) => ({ key, label: VERIFICATION_LABELS[key], value: verification[key], tone: statementTones[key] }))}
          name="Statements by verdict" dataKey="statements"
        />
        <dl className="open-items" aria-label="Open items">
          {OPEN_ITEM_KEYS.map((key) => (
            <div key={key}><dt>{VERIFICATION_LABELS[key]}</dt><dd>{verification[key]}</dd></div>
          ))}
        </dl>
      </Stat>
    </div>
  );
}

/** One level cell: the count in a tint that deepens with the count relative to the column's largest; zero is a quiet dot. */
function LevelCell({ level, count, href, max }: { level: Level; count: number; href: string | null; max: number }) {
  if (href === null) return <td className="num cell-zero"><span aria-hidden="true">&middot;</span><span className="sr-only">0</span></td>;
  const depth = (0.1 + 0.28 * (count / Math.max(max, 1))).toFixed(3);
  return (
    <td className={`num cell-level cell-${level}`}>
      <a href={href} style={{ ['--depth' as string]: depth }} aria-label={`${count} ${LEVEL_LABELS[level]} findings`}>{count}</a>
    </td>
  );
}

const VERDICT_SHORT: Record<string, string> = { verified: 'Verif.', contradicted: 'Contra.', misattributed: 'Misattr.', unverifiable: 'Unver.' };

/** The function matrix (design D2): rows grouped under their kind, in the rail's order; findings per level and statement verdicts per feature. */
function FeatureMatrix({ features, findings }: { features: Feature[]; findings: Finding[] }) {
  const rows = useMemo(() => new Map(featureMatrix(features, findings).map((row) => [row.feature.id, row])), [features, findings]);
  const groups = useMemo(() => groupFeatures(features), [features]);
  const showUnranked = hasUnranked([...rows.values()]);
  const levels = LEVELS.filter((level) => level !== 'unranked' || showUnranked);
  const max = Object.fromEntries(LEVELS.map((level) => [level, Math.max(0, ...[...rows.values()].map((row) => row.cells.find((cell) => cell.level === level)?.count ?? 0))])) as Record<Level, number>;
  const columns = 3 + levels.length + STATEMENT_KEYS.length;
  return (
    <div className="table-scroll matrix">
      <table data-table="features">
        <thead>
          <tr>
            <th rowSpan={2} className="stick">Feature</th>
            <th rowSpan={2} className="mark-col">Status</th>
            <th rowSpan={2} className="num">Flows</th>
            <th colSpan={levels.length} className="group-head">Findings</th>
            <th colSpan={STATEMENT_KEYS.length} className="group-head">Statements</th>
          </tr>
          <tr>
            {levels.map((level) => <th className="num sub" key={level}>{LEVEL_LABELS[level]}</th>)}
            {STATEMENT_KEYS.map((key) => (
              <th className="num sub" key={key} title={VERIFICATION_LABELS[key]}><span aria-hidden="true">{VERDICT_SHORT[key]}</span><span className="sr-only">{VERIFICATION_LABELS[key]}</span></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.kind}>
              <tr className="group-row" data-kind-group={group.kind}>
                <th colSpan={columns} scope="colgroup">{group.label} &middot; {group.features.length}</th>
              </tr>
              {group.features.map((feature) => {
                const row = rows.get(feature.id);
                const verification = feature.counts.verification;
                return (
                  <tr key={feature.id} data-feature-row={feature.id}>
                    <td className="stick"><a href={featureHash(feature.id)}><span className="nav-id">{feature.id}</span>{feature.name}</a></td>
                    <td className="mark-col"><StatusMark status={feature.status} text /></td>
                    <td className="num">{feature.flows.length}</td>
                    {(row?.cells ?? []).filter((cell) => levels.includes(cell.level)).map((cell) => <LevelCell key={cell.level} level={cell.level} count={cell.count} href={cell.href} max={max[cell.level]} />)}
                    {STATEMENT_KEYS.map((key) => <td className="num" key={key}>{verification === null ? '-' : verification[key]}</td>)}
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `#/`: the run's facts, the summary and the function matrix, then the overview text and the reference tables. */
export function Overview({ data }: { data: PageData }) {
  return (
    <div className="page" data-view="overview">
      <header className="page-head">
        <p className="eyebrow">As-Is PRD report</p>
        <h1>{data.project}</h1>
        <div className="meta-row">
          <span><b>Reader</b>{data.role}</span>
          <span><b>Language</b>{data.language}</span>
          <span><b>Scope</b>{data.scope ?? 'whole project'}</span>
          <span><b>Revision</b><code className="loc">{data.sourceRevision}</code></span>
        </div>
      </header>

      <SectionHeading id="summary" name="Summary" label="Summary" />
      <Summary data={data} />

      <SectionHeading id="features" name="Features" label="Features" />
      <FeatureMatrix features={data.features} findings={data.findings} />

      <div className="overview-text"><Markdown source={data.overview} idPrefix="overview" /></div>

      <SectionHeading id="terminology" name="Terminology" label="Terminology" />
      <Markdown source={data.tables.terminology} idPrefix="terminology" />

      <SectionHeading id="flow-index" name="Flow index" label="Flow index" />
      <FlowIndex features={data.features} />

      <SectionHeading id="roles" name="Roles" label="Roles" />
      <Markdown source={data.tables.roles} idPrefix="roles" />

      <SectionHeading id="open-items" name="Open items" label="Open items" />
      <Markdown source={data.tables.openItems} idPrefix="open-items" />
    </div>
  );
}
