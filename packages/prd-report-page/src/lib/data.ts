import { PAGE_FORMAT } from './types';
import type { PageData } from './types';

export const DATA_ELEMENT_ID = 'xv-prd-report-data';

export type LoadedData = { ok: true; data: PageData } | { ok: false; reason: string };

/** Read the page data from its `<script type="application/json">` element. */
export function loadData(doc: Document = document): LoadedData {
  const element = doc.getElementById(DATA_ELEMENT_ID);
  if (!element) {
    return { ok: false, reason: 'This is the report template: it holds no report data. Generate the page with the prd.mjs page command.' };
  }
  let value: unknown;
  try {
    value = JSON.parse(element.textContent ?? '');
  } catch (error) {
    return { ok: false, reason: `The report data is not valid JSON (${(error as Error).message}).` };
  }
  const format = (value as { format?: unknown } | null)?.format;
  if (format !== PAGE_FORMAT) {
    return { ok: false, reason: `The report data has format ${JSON.stringify(format ?? null)}, not ${PAGE_FORMAT}.` };
  }
  return { ok: true, data: value as PageData };
}
