import { replaceHash } from '../../hooks/use-route';
import { MODE_LABELS, MODES, withMode, type Mode } from '../../lib/view-mode';

/** The shorter labels of a window under 1440 px, where the full overlay switches and the search box need the room. */
const SHORT_LABELS: Readonly<Record<Mode, string>> = { overview: 'Overview', learn: 'Learn', deep: 'Deep' };

/**
 * The mode switch of the top bar (design D1): Overview, Learn and Deep dive on the graph pages. The mode is a setting
 * of the view kept in the hash, so a change replaces the current history entry.
 */
export function ModeSwitch({ mode }: { mode: Mode }) {
  return (
    <div role="group" aria-label="Mode" data-xv-modes="" className="inline-flex shrink-0 rounded-full border border-line-2 bg-surface p-0.5">
      {MODES.map((value) => (
        <button
          key={value}
          type="button"
          data-xv-mode={value}
          aria-pressed={value === mode}
          aria-label={MODE_LABELS[value]}
          title={MODE_LABELS[value]}
          onClick={() => value !== mode && replaceHash(withMode(window.location.hash, value))}
          className={`h-8 cursor-pointer whitespace-nowrap rounded-full border-0 text-[13px] transition-colors duration-200 ease-site px-2 min-[1440px]:px-3.5 ${value === mode ? 'bg-accent text-white' : 'bg-transparent text-ink-soft hover:text-accent'}`}
        >
          <span className="min-[1440px]:hidden">{SHORT_LABELS[value]}</span>
          <span className="max-[1439px]:hidden">{MODE_LABELS[value]}</span>
        </button>
      ))}
    </div>
  );
}
