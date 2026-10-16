// One language -> color mapping shared by every chart, so a language has the
// same color in the overview ring and the coverage bars. Slots follow a fixed
// order (languages by file count, then name); past the last slot languages
// fold into "other" instead of reusing or generating a hue.
import type { Coverage } from '../data';

export const SERIES_SLOTS = 8;
export const OTHER_COLOR = 'var(--series-other)';

/** Languages ordered by file count (descending), then name. */
export function languageOrder(coverage: Coverage | null): string[] {
  const byLanguage = coverage?.byLanguage ?? {};
  return Object.keys(byLanguage).sort((a, b) => {
    const diff = numberOr0(byLanguage[b]?.files) - numberOr0(byLanguage[a]?.files);
    return diff !== 0 ? diff : a < b ? -1 : a > b ? 1 : 0;
  });
}

export function languageColors(order: string[]): Map<string, string> {
  return new Map(order.map((language, i) => [language, i < SERIES_SLOTS ? `var(--series-${i + 1})` : OTHER_COLOR]));
}

/** Colors for skipped reasons (an orange ramp distinct from language hues). */
export function skipColor(index: number): string {
  return `var(--skip-${(index % 6) + 1})`;
}

function numberOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
