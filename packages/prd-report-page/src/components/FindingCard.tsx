import { evidenceLocation } from '../lib/filter';
import { featureHash } from '../lib/route';
import type { Finding } from '../lib/types';
import { ClassBadge, PriorityBadge } from './StatusBadge';

/**
 * One finding: its level, class, statement and each evidence item as `file:line` with
 * the quoted passage. The label is "anchor-checked": the script checked that
 * the passages occur in the files, nothing more, so the page never says verified.
 */
export function FindingCard({ finding, featureName }: { finding: Finding; featureName?: string }) {
  return (
    <article className="finding" id={`finding-${finding.id}`} data-finding={finding.id} data-class={finding.class} data-priority={finding.priority ?? 'unranked'} data-feature={finding.feature}>
      <div className="finding-head">
        <PriorityBadge value={finding.priority} />
        <ClassBadge value={finding.class} />
        <span className="badge badge-neutral" title="The script checked that each quoted passage occurs in its file; nobody has checked that the statement is true.">anchor-checked</span>
        <span className="finding-id">{finding.id}</span>
        {featureName !== undefined && (
          <a className="finding-feature" href={featureHash(finding.feature)}>{finding.feature} {featureName}</a>
        )}
      </div>
      <p className="finding-statement">{finding.statement}</p>
      {finding.priorityReason !== null && <p className="finding-reason" data-priority-reason><b>Why this level:</b> {finding.priorityReason}</p>}
      {finding.evidence.map((item, at) => (
        <div className="evidence" key={`${item.file}:${item.line ?? ''}:${at}`}>
          <div className="loc">{evidenceLocation(item)}</div>
          <pre><code>{item.passage}</code></pre>
        </div>
      ))}
    </article>
  );
}
