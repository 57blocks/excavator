/**
 * `translations.mjs check` (openspec: changes/view-name-translation, design D3-D4, oracle 3): each result is checked,
 * the ones that pass are merged into the table, the ones that fail get one more round, then the work directory goes.
 */

import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { makeGitProject } from './fixture.mjs';
import {
  DISPLAYED, answerBatch, listTree, pageDirOf, readBatch, readJson, runTranslations, sha256, tableDir, tablePath, workDir,
  writeTable, writeTranslatableProducts,
} from './translation-fixture.mjs';

let project;
beforeAll(() => {
  project = makeGitProject();
});
afterAll(() => project.cleanup());
beforeEach(() => {
  rmSync(join(project.root, '.excavator'), { recursive: true, force: true });
  writeTranslatableProducts(project);
});

const pageDir = () => pageDirOf(project);
const plan = (...extra) => runTranslations('plan', project.root, '--language', 'fr', ...extra);
const check = (...extra) => runTranslations('check', project.root, '--language', 'fr', ...extra);
const table = () => readJson(tablePath(pageDir(), 'fr'));
const merged = () => Object.values(table().entries).map((entry) => entry.en).sort();

// One answer per displayed name: the good ones pass, each bad one fails for one reason (the comment says which).
const ANSWERS = {
  Billing: 'Facturation',
  'Charge a customer': undefined, // missing-key
  'Dispatch a parcel': '', // empty
  'Handle GET request': 'Traiter la requete', // lost-code-token (GET)
  'Run `make build`': 'Lancer `make build`',
  Shipping: 'Ligne un\nligne deux', // multi-line
  'Start the application': 'x'.repeat(61), // too-long (over 60)
  'Validate OAuth2 token': 'Valider le jeton', // lost-code-token (OAuth2)
  capture: 42, // not-string
  pick: 'Choisir',
  receipt: 'Recu',
  validate: 'Valider',
};
const PASSING = ['Billing', 'Run `make build`', 'pick', 'receipt', 'validate'];
const FAILING = DISPLAYED.filter((name) => !PASSING.includes(name));

describe('one result file, each reason', () => {
  it('puts each bad answer under its reason, keeps it out of the table, merges the good ones, and reports an extra key once', () => {
    const planned = plan();
    answerBatch(planned.json.batches[0], (en) => ANSWERS[en], { 99: 'stray' });
    const run = check();
    expect(run.status).toBe(0);
    expect(run.json.language).toBe('fr');
    expect(run.json.merged).toBe(PASSING.length);
    expect(run.json.failed).toEqual({
      'missing-key': 1, empty: 1, 'lost-code-token': 2, 'multi-line': 1, 'too-long': 1, 'not-string': 1, 'extra-key': 1,
    });
    expect(run.json.finalEnglish).toBe(0);
    expect(merged()).toEqual([...PASSING].sort());
    for (const name of FAILING) expect(merged()).not.toContain(name);
  });

  it('writes the table with its format, the language, one entry per English text keyed by its hash, sorted by key', () => {
    const planned = plan();
    answerBatch(planned.json.batches[0], (en) => ANSWERS[en]);
    check();
    const written = table();
    expect(written.format).toBe('excavator-view-translations/1');
    expect(written.language).toBe('fr');
    expect(Object.keys(written.entries)).toEqual(Object.keys(written.entries).slice().sort());
    expect(written.entries[sha256('Billing')]).toEqual({ en: 'Billing', text: 'Facturation' });
    expect(written.entries[sha256('Run `make build`')]).toEqual({ en: 'Run `make build`', text: 'Lancer `make build`' });
    // Written through a temporary file and a rename: none is left beside the table.
    expect(readdirSync(tableDir(pageDir())).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('keeps the entries the table already had', () => {
    writeTable(pageDir(), 'fr', [{ en: 'Name nothing shows', text: 'Rien' }]);
    const planned = plan();
    answerBatch(planned.json.batches[0], (en) => ANSWERS[en]);
    check();
    expect(merged()).toContain('Name nothing shows');
    expect(merged()).toContain('Billing');
  });

  it('trims the translation and merges it trimmed', () => {
    const planned = plan();
    answerBatch(planned.json.batches[0], (en) => (en === 'pick' ? '  Choisir  ' : undefined));
    check();
    expect(table().entries[sha256('pick')].text).toBe('Choisir');
  });

  it('accepts the English text as its own translation', () => {
    const planned = plan();
    answerBatch(planned.json.batches[0], (en) => (en === 'Billing' ? 'Billing' : undefined));
    check();
    expect(table().entries[sha256('Billing')]).toEqual({ en: 'Billing', text: 'Billing' });
  });

  it('allows up to 60 characters and up to twice the English length plus 10; counts code points', () => {
    const planned = plan();
    answerBatch(planned.json.batches[0], (en) => {
      if (en === 'Billing') return 'a'.repeat(24); // 2 * 7 + 10 = 24: at the limit
      if (en === 'pick') return 'b'.repeat(19); // 2 * 4 + 10 = 18: one over
      if (en === 'Shipping') return String.fromCodePoint(0x1F600).repeat(26); // 26 code points, 52 UTF-16 units: within 2 * 8 + 10 = 26
      return undefined;
    });
    const run = check();
    expect(table().entries[sha256('Billing')]).toBeDefined();
    expect(table().entries[sha256('Shipping')]).toBeDefined();
    expect(table().entries[sha256('pick')]).toBeUndefined();
    expect(run.json.failed['too-long']).toBe(1);
  });

  it('requires the backticked text and the HTTP verb as whole words, and OAuth2 verbatim', () => {
    const planned = plan();
    answerBatch(planned.json.batches[0], (en) => ({
      'Run `make build`': 'Lancer make build', // backticks dropped: the text inside must still appear verbatim, so this passes
      'Handle GET request': 'Traiter GET', // verb kept
      'Validate OAuth2 token': 'Valider OAuth2',
    })[en]);
    const run = check();
    expect(table().entries[sha256('Run `make build`')]).toBeDefined();
    expect(table().entries[sha256('Handle GET request')]).toBeDefined();
    expect(table().entries[sha256('Validate OAuth2 token')]).toBeDefined();
    expect(run.json.failed['lost-code-token'] ?? 0).toBe(0);
  });

  it('fails a translation that loses the backticked text', () => {
    const planned = plan();
    answerBatch(planned.json.batches[0], (en) => ({ 'Run `make build`': 'Lancer la construction', pick: 'Choisir' })[en]);
    const run = check();
    expect(table().entries[sha256('Run `make build`')]).toBeUndefined();
    expect(run.json.failed['lost-code-token']).toBe(1);
  });

  it('fails every item of a missing or unparsable result file with no-result', () => {
    const planned = plan();
    expect(check().json.failed).toEqual({ 'no-result': DISPLAYED.length });
    const again = plan();
    writeFileSync(again.json.batches[0].result, '{ not json');
    expect(check().json.failed).toEqual({ 'no-result': DISPLAYED.length });
  });

  it('fails every item of a result that is not an object with no-result', () => {
    const planned = plan();
    writeFileSync(planned.json.batches[0].result, JSON.stringify(['a', 'b']));
    expect(check().json.failed).toEqual({ 'no-result': DISPLAYED.length });
  });
});

describe('the second round', () => {
  it('writes the failures as round-2 batch files, numbered after the existing ones, and prints them as retry', () => {
    const planned = plan();
    answerBatch(planned.json.batches[0], (en) => ANSWERS[en]);
    const run = check();
    expect(run.json.retry).toHaveLength(1);
    expect(run.json.retry[0].batch).toBe(join(workDir(pageDir(), 'fr'), 'batch-002.json'));
    expect(run.json.retry[0].result).toBe(join(workDir(pageDir(), 'fr'), 'result-002.json'));
    const retry = readBatch(run.json.retry[0]);
    expect(retry).toMatchObject({ format: 'excavator-view-translation-batch/1', language: 'fr', round: 2 });
    expect(retry.items.map((item) => item.en)).toEqual(FAILING);
    expect(retry.items.map((item) => item.key)).toEqual(FAILING.map((_, i) => String(i + 1)));
    expect(retry.items[0].hash).toBe(sha256(retry.items[0].en));
    // The work directory stays while there is something to retry.
    expect(existsSync(workDir(pageDir(), 'fr'))).toBe(true);
  });

  it('merges what the retry fixed, leaves the rest in English as final, and deletes the work directory', () => {
    const planned = plan();
    answerBatch(planned.json.batches[0], (en) => ANSWERS[en]);
    const first = check();
    answerBatch(first.json.retry[0], (en) => ({
      'Charge a customer': 'Facturer un client',
      'Dispatch a parcel': 'Expedier un colis',
      'Handle GET request': 'Traiter la requete', // still no GET
      Shipping: 'Expedition',
      'Start the application': 'Demarrer',
      'Validate OAuth2 token': 'Valider le jeton OAuth2',
      capture: 'Capturer',
    })[en]);
    const second = check();
    expect(second.json).toMatchObject({ language: 'fr', merged: FAILING.length - 1, retry: [], finalEnglish: 1 });
    expect(second.json.failed).toEqual({ 'lost-code-token': 1 });
    expect(merged()).toHaveLength(DISPLAYED.length - 1);
    expect(merged()).not.toContain('Handle GET request');
    expect(existsSync(workDir(pageDir(), 'fr'))).toBe(false);
  });

  it('does not retry a second time: a round-2 failure is final', () => {
    const planned = plan();
    answerBatch(planned.json.batches[0], (en) => ANSWERS[en]);
    const first = check();
    const second = check();
    expect(first.json.retry).toHaveLength(1);
    // The round-2 result was never written: every retried item is no-result and final.
    expect(second.json.retry).toEqual([]);
    expect(second.json.failed).toEqual({ 'no-result': FAILING.length });
    expect(second.json.finalEnglish).toBe(FAILING.length);
    expect(existsSync(workDir(pageDir(), 'fr'))).toBe(false);
  });

  it('deletes the work directory at once when every answer passes', () => {
    const planned = plan();
    answerBatch(planned.json.batches[0], (en) => `${en} fr`);
    const run = check();
    expect(run.json).toMatchObject({ merged: DISPLAYED.length, failed: {}, retry: [], finalEnglish: 0 });
    expect(existsSync(workDir(pageDir(), 'fr'))).toBe(false);
    expect(merged()).toEqual([...DISPLAYED].sort());
  });

  it('retries only the items that failed', () => {
    const planned = plan();
    answerBatch(planned.json.batches[0], (en) => (en === 'Billing' ? '' : `${en} fr`));
    const run = check();
    expect(run.json.merged).toBe(DISPLAYED.length - 1);
    expect(run.json.retry).toHaveLength(1);
    expect(readBatch(run.json.retry[0]).items.map((item) => item.en)).toEqual(['Billing']);
  });
});

describe('check with --out', () => {
  it('reads the work directory and writes the table beside the page, and nothing under .excavator', () => {
    const outDir = join(project.root, 'elsewhere');
    const before = listTree(pageDir());
    const out = join(outDir, 'page.html');
    const planned = plan('--out', out);
    answerBatch(planned.json.batches[0], (en) => `${en} fr`);
    const run = check('--out', out);
    expect(run.json.merged).toBe(DISPLAYED.length);
    expect(existsSync(tablePath(outDir, 'fr'))).toBe(true);
    expect(listTree(pageDir())).toEqual(before);
  });
});

describe('check and English', () => {
  it('prints the English answer and touches no file', () => {
    const before = listTree(pageDir());
    const run = runTranslations('check', project.root, '--language', 'english');
    expect(run.status).toBe(0);
    expect(run.json).toEqual({ language: 'en', english: true });
    expect(listTree(pageDir())).toEqual(before);
  });

  it('refuses a language that is not a file name', () => {
    const run = runTranslations('check', project.root, '--language', '../x');
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/letters.*digits/);
  });
});
