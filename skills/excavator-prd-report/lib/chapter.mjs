/**
 * The split of a feature chapter into what the document skeleton needs
 * (openspec change prd-report-prd-shape, design D4): its front-matter, its body
 * without the section the front-matter's `openItems` names, and that
 * section's text. `assemble`, `aggregate` and `page-data` all read chapters
 * through `splitChapter`, so the three cannot disagree about where a chapter
 * ends and its open items begin.
 */

import { parseFrontMatter } from './front-matter.mjs';
import { headingsOf } from './headings.mjs';

/** The text without a leading `---` front-matter block, line endings made LF, outer blank lines trimmed. */
export function body(text) {
  const lf = text.replace(/\r\n/g, '\n');
  const stripped = lf.startsWith('---\n') && lf.indexOf('\n---\n', 3) !== -1 ? lf.slice(lf.indexOf('\n---\n', 3) + 5) : lf;
  return trimmed(stripped);
}

const trimmed = (text) => text.replace(/^\s*\n/, '').replace(/\s+$/, '');
const featureNumber = (id) => Number(id.slice(1));
/** Document order of features: by chapter, then by the number of the id. */
export const byChapter = (a, b) => a.chapter - b.chapter || featureNumber(a.id) - featureNumber(b.id);

const listOf = (value) => (Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : []);

/**
 * Split the chapter file's `text`.
 * `openItems` is the text under the `###` heading `openItems` names (without
 * the heading line) or null when the front-matter names none; that heading
 * is the chapter's last `###` heading and its section runs to the end of the
 * body, so `body` is everything before it.
 * @returns {{ ok: true, data: object, actors: string[], permissionRoles: string[], flows: string[], body: string, openItems: string | null }
 *   | { ok: false, reason: string }}
 */
export function splitChapter(text) {
  const front = parseFrontMatter(text);
  if (!front.ok) return { ok: false, reason: front.reason };
  const whole = trimmed(front.body);
  const { data } = front;
  let main = whole;
  let openItems = null;
  if (Object.hasOwn(data, 'openItems')) {
    const heading = headingsOf(whole).filter((item) => item.level === 3).at(-1);
    if (heading === undefined || heading.text !== data.openItems) {
      return { ok: false, reason: `open items heading ${JSON.stringify(data.openItems)} is not the last ### heading` };
    }
    const lines = whole.split('\n');
    main = lines.slice(0, heading.line).join('\n').replace(/\s+$/, '');
    openItems = trimmed(lines.slice(heading.line + 1).join('\n'));
  }
  return {
    ok: true,
    data,
    actors: listOf(data.actors),
    permissionRoles: listOf(data.permissionRoles),
    flows: listOf(data.flows),
    body: main,
    openItems,
  };
}
