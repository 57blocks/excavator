/**
 * `translations.mjs plan` (openspec: changes/view-name-translation, design D2-D3, oracles 2 and 6):
 * the names the page shows, less the ones the table already has, in batch files; the language rule.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { makeGitProject } from './fixture.mjs';
import {
  DISPLAYED, NOT_SHOWN, listTree, manyStepNodes, pageDirOf, readBatch, readJson, runTranslations, sha256, tableDir, tablePath,
  workDir, writeTable, writeTranslatableProducts,
} from './translation-fixture.mjs';

let project;
beforeAll(() => {
  project = makeGitProject();
});
afterAll(() => project.cleanup());
beforeEach(() => rmSync(join(project.root, '.excavator'), { recursive: true, force: true }));

const plan = (...extra) => runTranslations('plan', project.root, ...extra);
const namesOf = (batches) => batches.flatMap((entry) => readBatch(entry).items.map((item) => item.en));

describe('plan lists what the page shows', () => {
  it('lists the displayed names once each, sorted, and not a stale or contradicted entry\'s name', () => {
    writeTranslatableProducts(project);
    const run = plan('--language', 'fr');
    expect(run.status).toBe(0);
    expect(run.json).toMatchObject({ language: 'fr', english: false, total: DISPLAYED.length, missing: DISPLAYED.length });
    expect(run.json.batches).toHaveLength(1);
    expect(namesOf(run.json.batches)).toEqual(DISPLAYED);
    for (const name of NOT_SHOWN) expect(namesOf(run.json.batches)).not.toContain(name);
    // "Start the application" is on two nodes and listed once.
    expect(namesOf(run.json.batches).filter((name) => name === 'Start the application')).toHaveLength(1);
  });

  it('writes the batch file with the language as given, the round, short keys, the hash and the English', () => {
    writeTranslatableProducts(project);
    const run = plan('--language', ' fr ');
    const entry = run.json.batches[0];
    expect(entry.batch).toBe(join(workDir(pageDirOf(project), 'fr'), 'batch-001.json'));
    expect(entry.result).toBe(join(workDir(pageDirOf(project), 'fr'), 'result-001.json'));
    const batch = readJson(entry.batch);
    expect(batch).toMatchObject({ format: 'excavator-view-translation-batch/1', language: 'fr', round: 1 });
    expect(batch.items[0]).toEqual({ key: '1', hash: sha256('Billing'), en: 'Billing', keep: [] });
    expect(batch.items.map((item) => item.key)).toEqual(DISPLAYED.map((_, i) => String(i + 1)));
  });

  it('gives each item the code tokens its translation has to keep, as an array that may be empty', () => {
    writeTranslatableProducts(project);
    const items = readBatch(plan('--language', 'fr').json.batches[0]).items;
    const keepOf = (en) => items.find((item) => item.en === en).keep;
    expect(keepOf('Validate OAuth2 token')).toEqual(['OAuth2']);
    expect(keepOf('Handle GET request')).toEqual(['GET']);
    expect(keepOf('Run `make build`')).toEqual(['make build']);
    expect(keepOf('Billing')).toEqual([]);
  });

  it('does not list a name that has a refusal record, and writes no batch when only refused names were missing', () => {
    writeTranslatableProducts(project);
    writeTable(pageDirOf(project), 'fr', DISPLAYED.map((en) => ({ en, text: `${en} fr` })));
    const path = tablePath(pageDirOf(project), 'fr');
    const table = readJson(path);
    table.entries[sha256('Billing')] = { en: 'Billing', refused: 'too-long' };
    writeFileSync(path, JSON.stringify(table));
    const run = plan('--language', 'fr');
    expect(run.json).toMatchObject({ missing: 0, batches: [] });
    expect(existsSync(workDir(pageDirOf(project), 'fr'))).toBe(false);
  });

  it('lists only the names the table does not have', () => {
    writeTranslatableProducts(project);
    writeTable(pageDirOf(project), 'fr', [{ en: 'Billing', text: 'Facturation' }, { en: 'pick', text: 'Choisir' }, { en: 'Name nothing shows', text: 'Rien' }]);
    const run = plan('--language', 'fr');
    expect(run.json).toMatchObject({ total: DISPLAYED.length, missing: DISPLAYED.length - 2 });
    expect(namesOf(run.json.batches)).toEqual(DISPLAYED.filter((name) => name !== 'Billing' && name !== 'pick'));
  });

  it('does not take a table entry whose English or hash does not match as having the name', () => {
    writeTranslatableProducts(project);
    writeTable(pageDirOf(project), 'fr', [
      { en: 'Billing', text: 'Facturation', storedEn: 'Something else' },
      { en: 'pick', text: 'Choisir', key: sha256('another') },
    ]);
    const run = plan('--language', 'fr');
    expect(run.json.missing).toBe(DISPLAYED.length);
    expect(namesOf(run.json.batches)).toContain('Billing');
    expect(namesOf(run.json.batches)).toContain('pick');
  });

  it('has no batch and removes the work directory when nothing is missing', () => {
    writeTranslatableProducts(project);
    writeTable(pageDirOf(project), 'fr', DISPLAYED.map((en) => ({ en, text: `${en} fr` })));
    mkdirSync(workDir(pageDirOf(project), 'fr'), { recursive: true });
    writeFileSync(join(workDir(pageDirOf(project), 'fr'), 'batch-001.json'), '{}');
    const run = plan('--language', 'fr');
    expect(run.json).toMatchObject({ language: 'fr', english: false, total: DISPLAYED.length, missing: 0, batches: [] });
    expect(existsSync(workDir(pageDirOf(project), 'fr'))).toBe(false);
  });

  it('deletes and recreates the work directory', () => {
    writeTranslatableProducts(project);
    mkdirSync(workDir(pageDirOf(project), 'fr'), { recursive: true });
    writeFileSync(join(workDir(pageDirOf(project), 'fr'), 'leftover.json'), '{}');
    writeFileSync(join(workDir(pageDirOf(project), 'fr'), 'batch-007.json'), '{}');
    plan('--language', 'fr');
    expect(listTree(workDir(pageDirOf(project), 'fr'))).toEqual(['batch-001.json']);
  });

  it('cuts the names into batches of at most 200, numbered from 001, with keys from 1 in each', () => {
    writeTranslatableProducts(project, { domainNodes: manyStepNodes(405) });
    const run = plan('--language', 'fr');
    const sizes = run.json.batches.map((entry) => readBatch(entry).items.length);
    // 405 steps, the domain, the flow and the two node names that are fresh and shown.
    expect(run.json.total).toBe(405 + 2 + 2);
    expect(sizes).toEqual([200, 200, 9]);
    expect(run.json.batches.map((entry) => entry.batch.split('/').pop())).toEqual(['batch-001.json', 'batch-002.json', 'batch-003.json']);
    expect(readBatch(run.json.batches[1]).items[0].key).toBe('1');
    expect(readBatch(run.json.batches[1]).items[199].key).toBe('200');
    expect(new Set(namesOf(run.json.batches)).size).toBe(run.json.total);
  });

  it('plans the names of a project with no domain graph from the graph alone', () => {
    writeTranslatableProducts(project, { domain: false });
    const run = plan('--language', 'fr');
    expect(namesOf(run.json.batches)).toEqual(['Start the application', 'Validate OAuth2 token']);
  });

  it('writes nothing outside the work directory, and nothing under .excavator but view-translations', () => {
    writeTranslatableProducts(project);
    const before = listTree(pageDirOf(project));
    plan('--language', 'fr');
    const after = listTree(pageDirOf(project));
    expect(after.filter((path) => !before.includes(path)).every((path) => path.startsWith('view-translations/work-fr/'))).toBe(true);
    expect(before.every((path) => after.includes(path))).toBe(true);
    expect(after.filter((path) => !before.includes(path))).toContain('view-translations/work-fr/batch-001.json');
  });
});

describe('plan with --out', () => {
  it('keeps the work directory beside the page and writes nothing under .excavator', () => {
    writeTranslatableProducts(project);
    const before = listTree(pageDirOf(project));
    const outDir = join(project.root, 'elsewhere');
    const run = plan('--language', 'fr', '--out', join(outDir, 'page.html'));
    expect(run.status).toBe(0);
    expect(run.json.batches[0].batch).toBe(join(workDir(outDir, 'fr'), 'batch-001.json'));
    expect(listTree(pageDirOf(project))).toEqual(before);
    expect(existsSync(tableDir(pageDirOf(project)))).toBe(false);
  });

  it('reads the table beside the page, not the one under .excavator', () => {
    writeTranslatableProducts(project);
    const outDir = join(project.root, 'elsewhere');
    writeTable(pageDirOf(project), 'fr', DISPLAYED.map((en) => ({ en, text: `${en} fr` })));
    const run = plan('--language', 'fr', '--out', join(outDir, 'page.html'));
    expect(run.json.missing).toBe(DISPLAYED.length);
    writeTable(outDir, 'fr', DISPLAYED.map((en) => ({ en, text: `${en} fr` })));
    expect(plan('--language', 'fr', '--out', join(outDir, 'page.html')).json.missing).toBe(0);
    expect(existsSync(tablePath(outDir, 'fr'))).toBe(true);
  });
});

describe('the language name', () => {
  it.each(['en', 'EN', ' English ', 'english', 'en-GB', 'EN-us'])('%s is English: nothing is listed, no file is touched', (language) => {
    writeTranslatableProducts(project);
    const before = listTree(pageDirOf(project));
    const run = plan('--language', language);
    expect(run.status).toBe(0);
    expect(run.json).toEqual({ language: 'en', english: true });
    expect(listTree(pageDirOf(project))).toEqual(before);
    expect(existsSync(tableDir(pageDirOf(project)))).toBe(false);
  });

  it.each(['../x', 'a/b', 'a b', 'zh.json', '', '   ', 'zh\\x'])('%j is refused: non-zero exit, a message naming the allowed characters, nothing written', (language) => {
    writeTranslatableProducts(project);
    const before = listTree(pageDirOf(project));
    const run = plan('--language', language);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/letters|digits/);
    expect(listTree(pageDirOf(project))).toEqual(before);
    expect(existsSync(tableDir(pageDirOf(project)))).toBe(false);
  });

  it('names the table after the lower-cased name, and takes letters of any script, digits, hyphens and underscores', () => {
    writeTranslatableProducts(project);
    const run = plan('--language', 'PT-BR_1');
    expect(run.json.language).toBe('pt-br_1');
    expect(run.json.batches[0].batch).toBe(join(workDir(pageDirOf(project), 'pt-br_1'), 'batch-001.json'));
    expect(plan('--language', String.fromCharCode(0x4e2d, 0x6587)).status).toBe(0);
  });

  it('needs a language', () => {
    writeTranslatableProducts(project);
    const run = plan();
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/--language/);
  });
});
