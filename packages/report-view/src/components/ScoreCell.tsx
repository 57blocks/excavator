import { NOT_PROVIDED, formatNumber } from '../lib/format';
import { scoreShare } from '../lib/hotspots';

/** A score beside a bar as wide as its share of the highest score. */
export function scoreCell(score: number | null | undefined, max: number | null) {
  if (score === undefined) return NOT_PROVIDED;
  if (score === null) return null;
  const share = scoreShare(score, max);
  return (
    <span className="flex h-5 items-center justify-end gap-2">
      <span className="inline-block h-1.5 w-14 overflow-hidden rounded-[3px] bg-paper-2">
        <span className="block h-full bg-accent" style={share === null ? undefined : { width: `${share}%` }} />
      </span>
      <span className="min-w-[72px] text-right tabular-nums">{formatNumber(score)}</span>
    </span>
  );
}
