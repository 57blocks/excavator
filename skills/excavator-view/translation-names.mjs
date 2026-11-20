/**
 * translation-names.mjs
 *
 * What `/excavator-view --language` knows about names (openspec: changes/view-name-translation, design D2-D4): the
 * language rule, the names the page shows, the translation table beside the page and what the packer takes from it.
 * No model call, no network; it reads the table and writes nothing (the writing is `translations.mjs`).
 *
 *   language   trimmed and lower-cased; `en`, `english`, `en-*` and `en_*` are English; any other name may hold only
 *              letters of any script, digits, `-` and `_`, because it is the table's file name
 *   names      every non-empty display name of the page's knowledge graph (after the semantic merge, so a
 *              contradicted or stale one is already empty) and every domain, flow and step name of the domain graph
 *   table      `<page dir>/view-translations/<language>.json`:
 *              { format, language, entries: { <sha256 of the English>: { en, text } } }
 *   taken      an entry is used only when its key is the SHA-256 of its own `en`, `en` is a displayed name and
 *              `text` is a non-empty string; every other entry is counted as mismatched or unused
 *   refused    `{ en, refused: <reason> }` under the hash of its `en`, with no `text`: the check refused every translation
 *              of that name; it is not a translation and not mismatched, `plan` does not list the name again, and the
 *              page keeps it in English (counted as `refused`)
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { parseJsonObject, readRegularFile } from './product-files.mjs';

export const TABLE_FORMAT = 'excavator-view-translations/1';
export const NAME_TRANSLATIONS_KEY = 'name-translations.json';
export const TABLE_DIR = 'view-translations';

const LANGUAGE_NAME = /^[\p{L}\p{N}_-]+$/u;
const DOMAIN_NAME_TYPES = new Set(['domain', 'flow', 'step']);
const HTTP_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (table, key) => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

/** `{ english: true }` or `{ english: false, name }`; throws a message naming the allowed characters for anything else. */
export function normalizeLanguage(raw) {
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (name === 'en' || name === 'english' || name.startsWith('en-') || name.startsWith('en_')) return { english: true };
  if (name === '' || !LANGUAGE_NAME.test(name)) {
    throw new Error(`the language name may hold only letters, digits, "-" and "_" (it is the translation table's file name); got ${JSON.stringify(raw ?? null)}`);
  }
  return { english: false, name };
}

/** The key of an English text in the table: SHA-256 as lower-case hex. */
export const hashName = (english) => createHash('sha256').update(english, 'utf-8').digest('hex');

/**
 * What a translation has to keep word for word: words (letters and digits, joined by `_` or `.`) that hold `_` or `.`
 * (`user_id`, `config.yaml`, `Node.js`), a digit or two capitals in a row (`OAuth2`, `CORS`, `S3`), the HTTP verbs as
 * whole words and the text inside backticks. A hyphen splits words and a trailing dot is not part of one. Each once,
 * in order of appearance.
 */
export function codeTokens(english) {
  const found = [];
  for (const match of english.matchAll(/`([^`]+)`|[A-Za-z0-9]+(?:[_.][A-Za-z0-9]+)*/g)) {
    if (match[1] !== undefined) {
      found.push(match[1]);
      continue;
    }
    const word = match[0];
    if (/[0-9_.]/.test(word) || /[A-Z]{2}/.test(word) || HTTP_VERBS.has(word)) found.push(word);
  }
  return [...new Set(found)];
}

const nonEmptyName = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** The names the page shows, once each and sorted, from the page data `buildExplorerData` returns. */
export function displayedNames(data) {
  const names = new Set();
  const graph = data['knowledge-graph.json'];
  for (const node of Array.isArray(graph?.nodes) ? graph.nodes : []) {
    const name = nonEmptyName(node?.displayName);
    if (name !== null) names.add(name);
  }
  const domain = data['domain-graph.json'];
  for (const node of Array.isArray(domain?.nodes) ? domain.nodes : []) {
    if (!DOMAIN_NAME_TYPES.has(node?.type)) continue;
    const name = nonEmptyName(node.name);
    if (name !== null) names.add(name);
  }
  return [...names].sort();
}

/** The directory the page sits in holds the table directory. */
export const tableDirOf = (pageDir) => join(pageDir, TABLE_DIR);
export const tablePathOf = (pageDir, name) => join(tableDirOf(pageDir), `${name}.json`);

/** The table of a language beside the page: { state: 'absent' } | { state: 'unreadable', reason } | { state: 'ok', entries }. */
export function readTable(pageDir, name) {
  const file = `${TABLE_DIR}/${name}.json`;
  const read = readRegularFile(tablePathOf(pageDir, name), file);
  if (read.state === 'absent') return { state: 'absent' };
  if (read.state === 'unreadable') return { state: 'unreadable', reason: read.reason };
  const parsed = parseJsonObject(read.bytes, file);
  if (!parsed.value) return { state: 'unreadable', reason: parsed.reason };
  if (parsed.value.format !== TABLE_FORMAT || !isObject(parsed.value.entries)) {
    return { state: 'unreadable', reason: `${file} is not a ${TABLE_FORMAT} table` };
  }
  return { state: 'ok', entries: parsed.value.entries };
}

/** The entry's translation when the entry is sound for the key it is under (key is the hash of its own English), else null. */
function soundEntry(key, entry) {
  if (!isObject(entry) || typeof entry.en !== 'string' || typeof entry.text !== 'string') return null;
  if (entry.text.trim() === '' || hashName(entry.en) !== key) return null;
  return { en: entry.en, text: entry.text };
}

/** The English of an entry that records a refusal (key is the hash of its `en`, a non-empty `refused`, no `text`), else null. */
function refusedEnglish(key, entry) {
  if (!isObject(entry) || typeof entry.en !== 'string' || hashName(entry.en) !== key) return null;
  if (typeof entry.refused !== 'string' || entry.refused.trim() === '' || 'text' in entry) return null;
  return entry.en;
}

/** The table's sound entries by English text, the English texts of its refusal records, and how many entries are neither. */
export function soundEntries(entries) {
  const byEnglish = new Map();
  const refused = new Set();
  let mismatched = 0;
  for (const key of Object.keys(entries)) {
    const sound = soundEntry(key, entries[key]);
    if (sound !== null) {
      byEnglish.set(sound.en, sound.text);
      continue;
    }
    const english = refusedEnglish(key, entries[key]);
    if (english === null) mismatched += 1;
    else refused.add(english);
  }
  return { byEnglish, refused, mismatched };
}

/** The names of `names` the table neither translates nor records a refusal for. */
export function missingNames(names, entries) {
  const { byEnglish, refused } = soundEntries(entries);
  return names.filter((name) => !byEnglish.has(name) && !refused.has(name));
}

/**
 * The page's name table for a language: only the displayed names with a sound entry, and the counts.
 * An absent or unreadable table gives no translation at all; the row says which.
 * @returns {{ value: object, row: { key: string, status: string, reason?: string } }}
 */
export function nameTranslationsFor({ pageDir, name, names }) {
  const table = readTable(pageDir, name);
  const entries = table.state === 'ok' ? table.entries : {};
  const { byEnglish, refused, mismatched } = soundEntries(entries);
  const shown = new Set(names);
  // Null prototype: an English name such as `__proto__` is an entry like any other.
  const translations = Object.create(null);
  let identical = 0;
  for (const english of names) {
    const text = byEnglish.get(english);
    if (text === undefined) continue;
    translations[english] = text;
    if (text === english) identical += 1;
  }
  const translated = Object.keys(translations).length;
  const unused = [...byEnglish.keys(), ...refused].filter((english) => !shown.has(english)).length;
  const refusedShown = names.filter((english) => refused.has(english) && !byEnglish.has(english)).length;
  const counts = { names: names.length, translated, english: names.length - translated, identical, mismatched, unused, refused: refusedShown };
  const value = { language: name, names: translations, counts };
  let row;
  if (table.state === 'unreadable') row = { key: NAME_TRANSLATIONS_KEY, status: 'unreadable', reason: table.reason };
  else if (table.state === 'absent') row = { key: NAME_TRANSLATIONS_KEY, status: 'included', reason: `no ${TABLE_DIR}/${name}.json beside the page; every name stays English` };
  else row = { key: NAME_TRANSLATIONS_KEY, status: 'included', reason: `${translated} of ${names.length} names translated` };
  return { value, row };
}
