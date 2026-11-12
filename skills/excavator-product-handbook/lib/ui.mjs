/**
 * The fixed-text table (design D12): every heading, table header and label
 * that handbook.md, and later the page, writes by itself. The English table
 * ships with the skill (`ui-strings.json`); a run in English copies it to
 * `<out>/ui.json`, and a run in another language has it translated into
 * `<out>/ui.json`. `check-ui` holds a translation to the English table's
 * shape: the same keys, a non-empty string for each, and the same
 * `{placeholder}` names in each value. Keys are namespaced by output:
 * `md.*` for handbook.md, `page.*` for the texts only the page has. The page
 * also reads the `md.*` keys whose text it shares (section names, table
 * headers, reach and status names), so a translation covers both outputs once.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UsageError } from './errors.mjs';
import { readJson, writeJson } from './json-file.mjs';
import { readMap } from './map-check.mjs';
import { literal, nonEmptyString, objectOf, shapeProblems } from './schema.mjs';

export const UI_FORMAT = 'excavator-product-handbook-ui/1';
export const UI_FILE = 'ui.json';
const SHIPPED = resolve(dirname(fileURLToPath(import.meta.url)), '../ui-strings.json');
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** The English table shipped with the skill. */
export function shippedTable() {
  const read = readJson(SHIPPED);
  if (!read.ok) throw new UsageError(`cannot read the shipped table ${SHIPPED}: ${read.reason}`);
  return read.value;
}

export const isEnglish = (language) => typeof language === 'string' && language.trim().toLowerCase() === 'english';

/** The sorted, distinct placeholder names of a string. */
export const placeholders = (text) => [...new Set(Array.from(text.matchAll(PLACEHOLDER), (match) => match[1]))].sort();

/** Replace each `{name}` of `template` with `values[name]`; a name without a value is a bug in the caller. */
export function fill(template, values = {}) {
  return template.replace(PLACEHOLDER, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`no value for {${name}} in ${JSON.stringify(template)}`);
    return String(values[name]);
  });
}

/** The word lists whose entries are matched inside text: a one-character word of a script without spaces matches inside longer words. */
const SINGLE_CHAR_WORD_KEYS = ['md.findings.adviceWords', 'md.findings.scopeWords'];

/** Every way `table` departs from the English table; each line starts with `ui.json:`. */
export function uiProblems(table, english) {
  const top = shapeProblems(table, objectOf({ format: literal(UI_FORMAT), language: nonEmptyString, strings: { type: 'object', required: {}, optional: {} } }));
  const shape = top.filter((line) => !line.startsWith('strings: unexpected key'));
  if (shape.length > 0) return shape.map((line) => `${UI_FILE}: ${line}`);
  const problems = [];
  const given = table.strings;
  for (const key of Object.keys(english.strings)) {
    if (!Object.hasOwn(given, key)) problems.push(`${UI_FILE}: missing key ${JSON.stringify(key)}`);
  }
  for (const key of Object.keys(given)) {
    if (!Object.hasOwn(english.strings, key)) problems.push(`${UI_FILE}: unexpected key ${JSON.stringify(key)}`);
  }
  for (const [key, value] of Object.entries(given)) {
    if (!Object.hasOwn(english.strings, key)) continue;
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`${UI_FILE}: ${key}: the value must be a non-empty string`);
      continue;
    }
    if (SINGLE_CHAR_WORD_KEYS.includes(key)) {
      for (const word of value.split(',').map((item) => item.trim())) {
        if (/[^\x00-\x7F]/.test(word) && [...word].length === 1) problems.push(`${UI_FILE}: ${key}: "${word}" is a single character; in a script without spaces it matches inside longer words, write words of two or more characters`);
      }
    }
    const want = placeholders(english.strings[key]);
    const have = placeholders(value);
    for (const name of want.filter((n) => !have.includes(n))) problems.push(`${UI_FILE}: ${key}: lost the placeholder {${name}}`);
    for (const name of have.filter((n) => !want.includes(n))) problems.push(`${UI_FILE}: ${key}: has the placeholder {${name}}, which the English text does not`);
  }
  return problems;
}

/** The run's language, read from map.json: `{ ok: true, language }` or `{ ok: false, line }`. */
function runLanguage(outDir) {
  const read = readMap(outDir);
  if (!read.ok) return read;
  const language = read.value?.language;
  return typeof language === 'string' && language.trim() !== '' ? { ok: true, language } : { ok: false, line: 'map.json: language must be a non-empty string' };
}

/** The run's language as `--language` gives it: `{ ok: true, language }` or `{ ok: false, line }`. */
const namedLanguage = (language) => (language.trim() === '' ? { ok: false, line: '--language must be a non-empty name' } : { ok: true, language });

/**
 * `handbook.mjs check-ui <out> [--language <name>]`. The fixed text is written
 * before the map, so the run's language comes from `--language` when it is
 * given and from map.json otherwise. Returns { status, lines }.
 */
export function checkUi(outDir, givenLanguage) {
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  const language = givenLanguage === undefined ? runLanguage(outDir) : namedLanguage(givenLanguage);
  if (!language.ok) return { status: 1, lines: [language.line] };
  const english = shippedTable();
  const path = join(outDir, UI_FILE);
  const read = readJson(path);
  if (read.missing) {
    if (!isEnglish(language.language)) return { status: 1, lines: [`${UI_FILE} is missing; the run's language is ${language.language}, so ${UI_FILE} must hold the translated table`] };
    writeJson(path, english);
    return { status: 0, lines: [`${UI_FILE}: copied the English table (${Object.keys(english.strings).length} strings)`] };
  }
  if (!read.ok) return { status: 1, lines: [`${UI_FILE} ${read.reason}`] };
  const problems = uiProblems(read.value, english);
  return problems.length > 0
    ? { status: 1, lines: problems }
    : { status: 0, lines: [`${UI_FILE} ok: ${Object.keys(english.strings).length} strings`] };
}

/**
 * The strings an output is written with. A run in English with no ui.json
 * uses the shipped table (the bytes check-ui would copy); anything else must
 * pass the check-ui checks. Returns `{ ok: true, strings }` or `{ ok: false, lines }`.
 */
export function loadUi(outDir) {
  const language = runLanguage(outDir);
  if (!language.ok) return { ok: false, lines: [language.line] };
  const english = shippedTable();
  const read = readJson(join(outDir, UI_FILE));
  if (read.missing && isEnglish(language.language)) return { ok: true, strings: english.strings };
  const checked = checkUi(outDir);
  if (checked.status !== 0) return { ok: false, lines: checked.lines };
  return { ok: true, strings: readJson(join(outDir, UI_FILE)).value.strings };
}


