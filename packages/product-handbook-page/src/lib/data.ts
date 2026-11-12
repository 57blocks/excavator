import { PAGE_FORMAT } from './types';
import type { PageData } from './types';

export const DATA_ELEMENT_ID = 'xv-product-handbook-data';

export type LoadedData = { ok: true; data: PageData } | { ok: false; reason: string };

/**
 * Read the page data from its `<script type="application/json">` element.
 * The reasons are diagnostics for whoever opens the bare template; a handbook
 * page always carries its data, and with it its own fixed text, so these are
 * the only strings that do not come from the data's ui table.
 */
export function loadData(doc: Document = document): LoadedData {
  const element = doc.getElementById(DATA_ELEMENT_ID);
  if (!element) return { ok: false, reason: 'This is the handbook template: it holds no data. Generate the page with the handbook.mjs page command.' };
  let value: unknown;
  try {
    value = JSON.parse(element.textContent ?? '');
  } catch (error) {
    return { ok: false, reason: `The handbook data is not valid JSON (${(error as Error).message}).` };
  }
  const format = (value as { format?: unknown } | null)?.format;
  if (format !== PAGE_FORMAT) return { ok: false, reason: `The handbook data has format ${JSON.stringify(format ?? null)}, not ${PAGE_FORMAT}.` };
  return { ok: true, data: value as PageData };
}
