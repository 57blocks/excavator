// The edge ledger of a graph level (artifact-view task 7A.1): where every
// edge of the level's scope went, as one visible equation that turns red when
// the buckets do not add up to the independently counted total.
import { fmtNumber } from '../format';
import type { LedgerSums } from '../model/edge-ledger';

export function EdgeLedger({ sums, scope }: { sums: LedgerSums; scope: string }) {
  const parts: string[] = [`${fmtNumber(sums.drawn)} drawn`];
  if (sums.cut > 0) parts.push(`${fmtNumber(sums.cut)} past the link limit`);
  parts.push(`${fmtNumber(sums.collapsed)} to or inside "more"`);
  if (sums.inside > 0) parts.push(`${fmtNumber(sums.inside)} inside an item`);
  if (sums.fileNode > 0) parts.push(`${fmtNumber(sums.fileNode)} at the file's own node`);
  parts.push(`${fmtNumber(sums.outside)} ${scope}`);
  const sign = sums.balanced ? '=' : '≠';
  return (
    <div className={`secondary equation ${sums.balanced ? '' : 'bad-text'}`} data-graph-note="ledger" data-balanced={sums.balanced ? 'true' : 'false'}>
      Edges here: {parts.join(' + ')} {sign} {fmtNumber(sums.total)} in total.
    </div>
  );
}
