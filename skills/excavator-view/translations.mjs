#!/usr/bin/env node
/**
 * translations.mjs
 *
 * Lists the names the page shows that the translation table lacks, and checks and merges the translations a
 * subagent wrote (openspec: changes/view-name-translation, design D2-D4). It calls no model: the subagent is
 * dispatched by the skill between `plan` and `check`.
 *
 *   node translations.mjs plan  <projectRoot> --language <lang> [--out <page path>]
 *   node translations.mjs check <projectRoot> --language <lang> [--out <page path>]
 *
 * The table and the work directory sit beside the page (`--out`, else `<projectRoot>/.excavator/explorer.html`):
 *   <page dir>/view-translations/<language>.json            the table, written through a temporary file and a rename
 *   <page dir>/view-translations/work-<language>/           batch-NNN.json, result-NNN.json
 *
 * `plan` builds the page data the way `pack.mjs` does, takes the displayed names (`translation-names.mjs`), leaves out
 * the ones the table has and writes the rest as batch files of at most 200 names, keyed "1".."N" within a batch. It
 * clears the work directory first, and removes it when nothing is missing.
 *
 * `check` reads the batch and result files of the latest round in the work directory. Every item passes or gets one
 * reason: missing-key, not-string, empty, multi-line, too-long (more than 60 code points, or more than twice the English
 * length plus 10), lost-code-token (a code token of the English is not in the text) or, for a result file that is absent
 * or not a JSON object, no-result. A key the batch does not have fails every item of that batch with extra-key and nothing of it is merged. Passing items are merged into the table. Round-1 failures are written as round-2 batch files; round-2 failures
 * are final and stay English: the table records each as { en, refused: <reason> } so a later `plan` does not list it,
 * but only when the reason judges a written text (CHECKED_TEXT_REASONS); no-result, extra-key and missing-key are not
 * recorded and the name is listed again.
 * Batch items carry `keep` (the English's code tokens); `check` computes the tokens itself and ignores it. When nothing is left to retry the work directory is deleted.
 *
 * English (`en`, `english`, `en-*`, `en_*`) prints {"language":"en","english":true} and touches no file.
 * Deterministic and model-free; it never reads or runs the project's code.
 */

import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDataDir, bindProjectRoot } from '../excavator/project-paths.mjs';
import { resolveSourceSnapshot } from '../excavator/source-snapshot.mjs';
import { buildExplorerData } from './explorer-data.mjs';
import { collectProducts } from './products.mjs';
import { collectSources } from './sources.mjs';
import {
  TABLE_FORMAT, codeTokens, displayedNames, hashName, missingNames, normalizeLanguage, readTable, tableDirOf, tablePathOf,
} from './translation-names.mjs';

export { codeTokens, displayedNames, hashName, normalizeLanguage };

const USAGE = 'Usage: node translations.mjs <plan|check> <projectRoot> --language <lang> [--out <page path>]';
const BATCH_FORMAT = 'excavator-view-translation-batch/1';
const BATCH_SIZE = 200;
const MAX_CHARS = 60;
const MULTI_LINE = /[\r\n\p{Zl}\p{Zp}]/u;

const codePoints = (text) => [...text].length;
const pad = (number) => String(number).padStart(3, '0');
const batchName = (number) => `batch-${pad(number)}.json`;
const resultName = (number) => `result-${pad(number)}.json`;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== 'plan' && command !== 'check') throw new Error(USAGE);
  const options = { command, root: null, language: undefined, out: null };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--language') {
      options.language = rest[++i];
      if (options.language === undefined) throw new Error(`--language needs a value\n${USAGE}`);
    } else if (arg === '--out') {
      options.out = rest[++i];
      if (!options.out) throw new Error(`--out needs a path\n${USAGE}`);
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}\n${USAGE}`);
    else if (options.root === null) options.root = arg;
    else throw new Error(`unexpected argument ${arg}\n${USAGE}`);
  }
  if (options.root === null) throw new Error(USAGE);
  if (options.language === undefined) throw new Error(`--language is needed\n${USAGE}`);
  return options;
}

/** Write through a sibling temporary file and a rename; on failure the target is untouched and the temporary file gone. */
function writeAtomic(path, text) {
  const tmpPath = `${path}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmpPath, text);
    renameSync(tmpPath, path);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

/** The names the page will show, from page data built the way the packer builds it. */
function pageNames(root, dataDir) {
  const snapshot = resolveSourceSnapshot(root);
  const products = collectProducts(dataDir, snapshot.revision);
  const sources = collectSources({ noSource: true, snapshot, payloads: products.payloads });
  const { data } = buildExplorerData({ root, dataDir, snapshotRevision: snapshot.revision, products, sources });
  return displayedNames(data);
}

/** The directory the page sits in: beside `--out`, else the data directory. */
const pageDirFor = (dataDir, out) => (out ? dirname(resolve(out)) : dataDir);

const workDirOf = (pageDir, name) => join(tableDirOf(pageDir), `work-${name}`);

/** Write `items` ([{ hash, en }]) as batch files from number `first`; the result paths are named, none is written. */
function writeBatches(workDir, items, round, language, first) {
  const written = [];
  for (let start = 0, number = first; start < items.length; start += BATCH_SIZE, number += 1) {
    const slice = items.slice(start, start + BATCH_SIZE).map(({ hash, en }, i) => ({ key: String(i + 1), hash, en, keep: codeTokens(en) }));
    const batch = join(workDir, batchName(number));
    writeFileSync(batch, `${JSON.stringify({ format: BATCH_FORMAT, language, round, items: slice }, null, 2)}\n`);
    written.push({ batch, result: join(workDir, resultName(number)) });
  }
  return written;
}

/** Lists what is missing and writes the batch files. */
export function planTranslations({ root: rootArg, language, out = null }) {
  const lang = normalizeLanguage(language);
  if (lang.english) return { language: 'en', english: true };
  const root = bindProjectRoot(rootArg);
  const dataDir = assertDataDir(root);
  const pageDir = pageDirFor(dataDir, out);
  const names = pageNames(root, dataDir);
  const table = readTable(pageDir, lang.name);
  if (table.state === 'unreadable') throw new Error(`the translation table is unreadable: ${table.reason}`);
  const missing = missingNames(names, table.state === 'ok' ? table.entries : {});

  const workDir = workDirOf(pageDir, lang.name);
  rmSync(workDir, { recursive: true, force: true });
  let batches = [];
  if (missing.length > 0) {
    mkdirSync(workDir, { recursive: true });
    batches = writeBatches(workDir, missing.map((en) => ({ hash: hashName(en), en })), 1, language.trim(), 1);
  }
  return { language: lang.name, english: false, total: names.length, missing: missing.length, batches };
}

/** The reasons that judge a written text; only these are recorded as refusals. */
const CHECKED_TEXT_REASONS = new Set(['not-string', 'empty', 'multi-line', 'too-long', 'lost-code-token']);

/** { reason } for the first rule an answer breaks for its English text, or { text } (trimmed) when it passes. */
function reasonFor(english, answer) {
  if (typeof answer !== 'string') return { reason: 'not-string' };
  const text = answer.trim();
  if (text === '') return { reason: 'empty' };
  if (MULTI_LINE.test(text)) return { reason: 'multi-line' };
  const length = codePoints(text);
  if (length > MAX_CHARS || length > 2 * codePoints(english) + 10) return { reason: 'too-long' };
  if (codeTokens(english).some((token) => !text.includes(token))) return { reason: 'lost-code-token' };
  return { text };
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return undefined;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The batch files of the work directory, as { number, batch, result, content }, in number order. */
function readBatches(workDir) {
  let names;
  try {
    names = readdirSync(workDir);
  } catch {
    return null;
  }
  return names
    .map((file) => /^batch-(\d+)\.json$/.exec(file))
    .filter((match) => match !== null)
    .map((match) => ({ number: Number(match[1]), file: match[0] }))
    .sort((a, b) => a.number - b.number)
    .map(({ number, file }) => {
      const content = readJsonFile(join(workDir, file));
      if (!isObject(content) || content.format !== BATCH_FORMAT || !Array.isArray(content.items) || !Number.isInteger(content.round)) throw new Error(`${file} is not a ${BATCH_FORMAT} batch file`);
      return { number, batch: join(workDir, file), result: join(workDir, resultName(number)), content };
    });
}

function bump(counts, reason, by = 1) {
  counts[reason] = (counts[reason] ?? 0) + by;
}

/** Checks the latest round's results, merges what passes into the table and writes round-2 batches for round-1 failures. */
export function checkTranslations({ root: rootArg, language, out = null }) {
  const lang = normalizeLanguage(language);
  if (lang.english) return { language: 'en', english: true };
  const root = bindProjectRoot(rootArg);
  const dataDir = assertDataDir(root);
  const pageDir = pageDirFor(dataDir, out);
  const workDir = workDirOf(pageDir, lang.name);
  const all = readBatches(workDir);
  if (all === null || all.length === 0) throw new Error(`no batch files in ${workDir}; run plan first`);

  const round = Math.max(...all.map((entry) => entry.content.round));
  const batches = all.filter((entry) => entry.content.round === round);
  const failed = {};
  const passed = new Map();
  const failures = [];
  for (const entry of batches) {
    const result = readJsonFile(entry.result);
    const items = entry.content.items;
    if (!isObject(result)) {
      for (const item of items) {
        bump(failed, 'no-result');
        failures.push({ hash: hashName(item.en), en: item.en, reason: 'no-result' });
      }
      continue;
    }
    const keys = new Set(items.map((item) => item.key));
    if (Object.keys(result).some((key) => !keys.has(key))) {
      // The keys must match the batch one to one: a shifted numbering would pair names with another name's text.
      for (const item of items) {
        bump(failed, 'extra-key');
        failures.push({ hash: hashName(item.en), en: item.en, reason: 'extra-key' });
      }
      continue;
    }
    for (const item of items) {
      const verdict = Object.prototype.hasOwnProperty.call(result, item.key)
        ? reasonFor(item.en, result[item.key])
        : { reason: 'missing-key' };
      if (verdict.reason) {
        bump(failed, verdict.reason);
        failures.push({ hash: hashName(item.en), en: item.en, reason: verdict.reason });
      } else {
        passed.set(item.en, verdict.text);
      }
    }
  }

  // A round-2 failure is final: the table records the refusal so the next plan does not list the name again.
  // A refusal means a translation was written and the check refused it. no-result, extra-key and missing-key judge no
  // written text for the name, so they are not recorded: the name stays English for this export and is listed again.
  const refused = round >= 2 ? new Map(failures.filter(({ reason }) => CHECKED_TEXT_REASONS.has(reason)).map(({ en, reason }) => [en, reason])) : new Map();
  if (passed.size > 0 || refused.size > 0) mergeIntoTable(pageDir, lang.name, passed, refused);

  const last = Math.max(...all.map((entry) => entry.number));
  const retry = round === 1 && failures.length > 0 ? writeBatches(workDir, failures, 2, batches[0].content.language, last + 1) : [];
  const finalEnglish = round >= 2 ? failures.length : 0;
  if (retry.length === 0) rmSync(workDir, { recursive: true, force: true });
  return { language: lang.name, merged: passed.size, failed, retry, finalEnglish };
}

/** Adds the passing translations and the final refusals to the table (a new one when there is none), sorted by key, through a temporary file and a rename. */
function mergeIntoTable(pageDir, name, passed, refused) {
  const table = readTable(pageDir, name);
  if (table.state === 'unreadable') throw new Error(`the translation table is unreadable, so it is not overwritten: ${table.reason}`);
  const entries = table.state === 'ok' ? { ...table.entries } : {};
  for (const [en, reason] of refused) entries[hashName(en)] = { en, refused: reason };
  for (const [en, text] of passed) entries[hashName(en)] = { en, text };
  const sorted = {};
  for (const key of Object.keys(entries).sort()) sorted[key] = entries[key];
  writeAtomic(tablePathOf(pageDir, name), `${JSON.stringify({ format: TABLE_FORMAT, language: name, entries: sorted }, null, 2)}\n`);
}

function main(argv) {
  const options = parseArgs(argv);
  const run = options.command === 'plan' ? planTranslations : checkTranslations;
  process.stdout.write(`${JSON.stringify(run({ root: options.root, language: options.language, out: options.out }))}\n`);
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`excavator-view translations failed: ${error.message}\n`);
    process.exit(1);
  }
}
