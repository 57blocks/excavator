import type { Chip, ChipTone, Confidence } from '../../lib/overlays';

/** The look of each chip: a filled one for a mark of the unused overlay or evidence, an outlined one for none. */
const CHIP: Record<ChipTone, string> = {
  high: 'bg-unused-high text-white',
  medium: 'bg-unused-medium text-white',
  low: 'bg-unused-low text-white',
  unrated: 'bg-muted text-white',
  evidence: 'bg-evidence text-white',
  'no-evidence': 'border border-line-2 bg-surface text-ink-soft',
};

/** The colour of the mark of an unused function's row inside an open file. */
export const UNUSED_ROW_COLOUR: Record<Confidence, string> = {
  high: 'var(--color-unused-high)',
  medium: 'var(--color-unused-medium)',
  low: 'var(--color-unused-low)',
  unrated: 'var(--color-muted)',
};

export const UNUSED_ROW_TEXT: Record<Confidence, string> = { high: 'unused high', medium: 'unused medium', low: 'unused low', unrated: 'unused' };

/** The marks of the overlays on a node, as chips across its lower edge: outside the box, so they take no room from it. */
export function OverlayChips({ chips }: { chips: readonly Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="pointer-events-none absolute -bottom-2.5 right-3 flex gap-1" data-xv-chips="">
      {chips.map((chip) => (
        <span key={chip.tone} data-xv-chip={chip.tone} className={`rounded-full px-2 py-px text-[11px] font-semibold leading-4 shadow-card ${CHIP[chip.tone]}`}>
          {chip.text}
        </span>
      ))}
    </div>
  );
}
