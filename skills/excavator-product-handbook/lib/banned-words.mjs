/**
 * The banned-words gate (design D7): reader-visible text must not carry
 * code-shaped fragments. Seven categories, each reported with the fragment
 * and its category:
 *
 *   underscore identifier  a word character, `_`, a word character in one token
 *   camelCase identifier   a token that starts in lower case and has a lower-to-upper step
 *   multi-hump word        a token that starts in upper case and has a lower-to-upper step
 *   path                   a fragment that starts with `/` and a word character, not after a word character
 *   source file extension  a word character, `.`, then go ts tsx js jsx java py sql json yaml yml
 *   call form              a word character right before `(`
 *   member directory name  a first-level directory of the project root that holds a .git
 *
 * "Word character" is ASCII [A-Za-z0-9_], so text in other scripts is never
 * a hit by itself. A hit that lies inside an occurrence of a verified label
 * is not a violation (`outsideLabels`).
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { normalize } from './normalize.mjs';

export const CATEGORIES = Object.freeze({
  snake: 'underscore identifier',
  camel: 'camelCase identifier',
  pascal: 'multi-hump word',
  path: 'path',
  extension: 'source file extension',
  call: 'call form',
  member: 'member directory name',
});

const SOURCE_EXTENSION = /[\w-]*\w\.(?:tsx|ts|jsx|js|json|java|py|sql|go|yaml|yml)(?!\w)/g;
const PATH = /(?<!\w)\/\w(?:[\w./-]*[\w/])?/g;
const CALL = /\w+\(/g;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The first-level directories of `projectRoot` that hold a `.git` (a directory or a worktree file), sorted. */
export function memberDirectories(projectRoot) {
  const names = [];
  for (const entry of readdirSync(projectRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (existsSync(join(projectRoot, entry.name, '.git')) && statSync(join(projectRoot, entry.name)).isDirectory()) names.push(entry.name);
  }
  return names.sort();
}

/** Every banned fragment of `text` as `{ start, end, fragment, category }`, in order of position. */
export function bannedFragments(text, { memberDirs = [] } = {}) {
  const hits = [];
  const add = (match, category) => hits.push({ start: match.index, end: match.index + match[0].length, fragment: match[0], category });

  for (const token of text.matchAll(/\w+/g)) {
    const word = token[0];
    if (/\w_\w/.test(word)) add(token, CATEGORIES.snake);
    else if (/[a-z][A-Z]/.test(word)) add(token, /^[A-Z]/.test(word) ? CATEGORIES.pascal : CATEGORIES.camel);
  }
  for (const match of text.matchAll(PATH)) add(match, CATEGORIES.path);
  for (const match of text.matchAll(SOURCE_EXTENSION)) add(match, CATEGORIES.extension);
  for (const match of text.matchAll(CALL)) add(match, CATEGORIES.call);
  for (const name of memberDirs) {
    for (const match of text.matchAll(new RegExp(`(?<![\\w-])${escapeRegex(name)}(?![\\w-])`, 'g'))) add(match, CATEGORIES.member);
  }
  return hits.sort((a, b) => a.start - b.start || a.end - b.end || (a.category < b.category ? -1 : 1));
}

/** Where `label` occurs in `text`, as [start, end) ranges: as written and as normalized. */
function labelRanges(text, label) {
  const ranges = [];
  for (const variant of new Set([label, normalize(label).text])) {
    if (variant === '') continue;
    for (let at = text.indexOf(variant); at !== -1; at = text.indexOf(variant, at + 1)) ranges.push([at, at + variant.length]);
  }
  return ranges;
}

/** The hits that do not lie inside an occurrence of one of `labels` (verified labels). */
export function outsideLabels(hits, text, labels) {
  if (hits.length === 0) return hits;
  const ranges = [...labels].flatMap((label) => labelRanges(text, label));
  return hits.filter((hit) => !ranges.some(([start, end]) => start <= hit.start && hit.end <= end));
}
