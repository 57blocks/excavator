import { evidenceLocation } from '../lib/filter';
import { featureHash } from '../lib/route';
import type { Finding } from '../lib/types';
import { ClassBadge, PriorityBadge } from './StatusBadge';

/**
 * One finding (design D4): its level, class, anchor-checked mark and id in the
 * head, the owning feature on the right when `featureName` is given, then the
 * statement, the reason for the level and each evidence item as `file:line` with
 * the quoted passage. The left border carries the level's colour; the level is
 * also written out. The label is "anchor-checked": the script checked that the
 * passages occur in the files, nothing more, so the page never says verified.
 */
export function FindingCard({ finding, featureName }: { finding: Finding; featureName?: string }) {
  const level = finding.priority ?? 'unranked';
  return (
    <article className={`finding finding-${level}`} id={`finding-${finding.id}`} tabIndex={-1} data-finding={finding.id} data-class={finding.class} data-priority={level} data-feature={finding.feature}>
      <div className="finding-head">
        <PriorityBadge value={finding.priority} />
        <ClassBadge value={finding.class} />
        <span className="badge badge-neutral" title="The script checked that each quoted passage occurs in its file; nobody has checked that the statement is true.">anchor-checked</span>
        <span className="finding-id">{finding.id}</span>
        {featureName !== undefined && (
          <a className="finding-feature" href={featureHash(finding.feature)}><span className="finding-feature-id">{finding.feature}</span> {featureName}</a>
        )}
      </div>
      <p className="finding-statement">{finding.statement}</p>
      {finding.priorityReason !== null && <p className="finding-reason" data-priority-reason><span className="inline-label">Why this level</span> {finding.priorityReason}</p>}
      {finding.evidence.map((item, at) => (
        <figure className="evidence" key={`${item.file}:${item.line ?? ''}:${at}`}>
          <figcaption className="loc">{evidenceLocation(item)}</figcaption>
          <pre><code>{item.passage}</code></pre>
        </figure>
      ))}
    </article>
  );
}
