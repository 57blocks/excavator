/**
 * Excavator: the page's name table (openspec: changes/view-name-translation, design D3 and D5). When the page was packed
 * with `--language`, `name-translations.json` maps the English text of each name the page shows to its translation, with
 * the language and counts. The graphs keep the English names; the page looks a name up here and falls back to the English.
 */

export interface NameTranslationCounts {
  names: number;
  translated: number;
  english: number;
  identical: number;
  mismatched: number;
  unused: number;
  refused: number;
}

export interface NameTranslations {
  language: string;
  names: Record<string, string>;
  counts: NameTranslationCounts;
}

/** The translation of an English name, or null when the table has none. */
export type Translate = (english: string) => string | null;

const COUNT_KEYS: (keyof NameTranslationCounts)[] = ["names", "translated", "english", "identical", "mismatched", "unused", "refused"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The table as the page was packed with it, or null when the data is not that shape (the page then shows English). */
export function parseNameTranslations(raw: unknown): NameTranslations | null {
  if (!isRecord(raw) || typeof raw.language !== "string" || raw.language === "") return null;
  if (!isRecord(raw.names) || !isRecord(raw.counts)) return null;
  for (const value of Object.values(raw.names)) if (typeof value !== "string") return null;
  const counts = raw.counts;
  for (const key of COUNT_KEYS) if (typeof counts[key] !== "number" || !Number.isFinite(counts[key])) return null;
  return raw as unknown as NameTranslations;
}

/** A lookup over the table; a name inherited from the object prototype is not a translation. */
export function translatorOf(table: NameTranslations | null): Translate | undefined {
  if (table === null) return undefined;
  const { names } = table;
  return (english) => (Object.prototype.hasOwnProperty.call(names, english) ? names[english] : null);
}

/** What a domain, flow or step shows: the translation as the label, with the English original, or the English name alone. */
export function domainTitle(name: string, translate?: Translate): { label: string; original: string | null } {
  const translated = translate?.(name.trim()) ?? null;
  return translated === null ? { label: name, original: null } : { label: translated, original: name };
}

/** The one line of the project overview that says the names were machine-translated. */
export function overviewLine(table: NameTranslations): string {
  const { translated, english, identical, refused } = table.counts;
  let line = `Names machine-translated to ${table.language}: ${translated} translated, ${english} kept in English`;
  if (identical > 0) line += `, ${identical} identical to English`;
  if (refused > 0) line += `, ${refused} refused by the check`;
  return line;
}
