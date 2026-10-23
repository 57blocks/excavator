/** Helpers that read a packed explorer page back the way the browser would: the data block and the manifest block. */

const BLOCK = (id) => new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`);

/** The data object and the pack's manifest of an explorer page. */
export function explorerPage(html) {
  const data = BLOCK('xv-explorer-data').exec(html);
  const manifest = BLOCK('xv-explorer-manifest').exec(html);
  if (!data || !manifest) throw new Error('no data or manifest block in the page');
  return { data: JSON.parse(data[1]), manifest: JSON.parse(manifest[1]) };
}

/** The raw text of one JSON block, as the page holds it (before parsing). */
export function blockText(html, id) {
  const match = BLOCK(id).exec(html);
  return match ? match[1] : null;
}
