/**
 * The groups of findings a ranking works on (openspec change
 * handbook-findings-priority, design D3): the groups of the verified findings
 * as the handbook writes them (findings-model.mjs), each with its key, the
 * parts they are cut into and the lines `priority-items` prints. Pure except
 * `loadGroups`, which builds them from a loaded run.
 *
 * The key of a group is `<unit id>#<index>@<digest>`: the unit of the
 * representative finding, its index in that unit's file and the first 16 hex
 * digits of the SHA-256 of every statement of the group. A changed statement or
 * a changed membership is another key, so an old ranking never lands on a group
 * it was not made for.
 */

import { createHash } from 'node:crypto';

import { scanProject } from './applications.mjs';
import { buildFindings } from './findings-model.mjs';
import { partSize } from './priority-shape.mjs';

const ITEM_ID = /^(.+)\[(\d+)\]$/;
const DIGEST_LENGTH = 16;

/** The statements of a group are digested with a separator that no statement holds (a NUL). */
const digestOf = (items) => createHash('sha256').update(items.map((item) => item.text).join('\0')).digest('hex').slice(0, DIGEST_LENGTH);

/** The key of `group` (`{ items: [{ id, text }] }`, the first item the representative). */
export function groupKey(group) {
  const found = ITEM_ID.exec(group.items[0].id);
  if (found === null) throw new Error(`${group.items[0].id} is not the id of a finding`);
  return `${found[1]}#${found[2]}@${digestOf(group.items)}`;
}

/** The groups of a loaded run (`loadCheckedRun`), each with its `key`, in the order the handbook writes them before the ranking sorts them. */
export function loadGroups(run, root) {
  const scan = scanProject(root);
  return buildFindings(run, root, { technical: false, roots: scan.roots }).groups.map((group) => ({ ...group, key: groupKey(group) }));
}

/** The groups cut into parts of at most `partSize()`, in order; one empty part for none. */
export function partsOf(groups) {
  const size = partSize();
  const parts = [];
  for (let from = 0; from < groups.length; from += size) parts.push(groups.slice(from, from + size));
  return parts.length === 0 ? [[]] : parts;
}

/** The digest of the whole list of group keys: the input of the unit, kept in state.json so that another input starts the unit over. */
export const groupsDigest = (groups) => createHash('sha256').update(groups.map((group) => group.key).join('\n')).digest('hex');

const oneLine = (text) => text.replace(/\s+/g, ' ').trim();

/** The line `priority-items` prints for a group: key, category display name, the representative statement and the others joined with ` | `, tab-separated. */
export function groupLine(group, categoryName) {
  const [first, ...others] = group.items;
  return [group.key, oneLine(categoryName), oneLine(first.text), others.map((item) => oneLine(item.text)).join(' | ')].join('\t');
}
