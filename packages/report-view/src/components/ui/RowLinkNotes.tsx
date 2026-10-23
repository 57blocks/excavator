import { formatNumber } from '../../lib/format';
import { normalizePrefix } from '../../lib/detail-rows';

/** The path filter of a table: the prefix, how many rows it keeps of how many, and a button that takes it off. */
export function PrefixBar({ prefix, shown, total, noun, onClear }: { prefix: string | null; shown: number; total: number; noun: string; onClear: () => void }) {
  const dir = normalizePrefix(prefix);
  if (dir === null) return null;
  return (
    <div data-xv-prefix={dir} data-xv-prefix-count={shown} className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-control border border-accent/40 bg-highlight px-3 py-2 text-[13px]">
      <span>
        {'Path under '}
        <code>{dir}</code>
        {`: ${formatNumber(shown)} of ${formatNumber(total)} ${noun}`}
      </span>
      <button type="button" data-xv-prefix-clear="" onClick={onClear} className="cursor-pointer rounded-full border border-line-2 bg-surface px-3 py-0.5 text-xs text-ink-soft hover:border-accent hover:text-accent">
        Clear filter
      </button>
    </div>
  );
}

/** What a page says when the address names a row its table does not have: no panel opens. */
export function RowMissing({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <p role="status" data-xv-row-missing="" className="mb-2 border-l-4 border-warning bg-surface px-3 py-2 text-ink">
      {text}
    </p>
  );
}
