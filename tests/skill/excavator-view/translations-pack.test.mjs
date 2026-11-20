/**
 * `pack.mjs --language` (openspec: changes/view-name-translation, design D3 and D5, oracles 1, 4, 5 and 6): English or
 * no language leaves the page as it was; another language adds a name table read from the table beside the page.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { packProject } from '../../../skills/excavator-view/pack.mjs';
import { makeGitProject } from './fixture.mjs';
import { explorerPage } from './page.mjs';
import { FIXTURE_TEMPLATE, makePluginRoot, repoRoot, writeTemplate } from './plugin-fixture.mjs';
import { DISPLAYED, listTree, pageDirOf, readJson, sha256, tableDir, tablePath, workDir, writeTable, writeTranslatableProducts } from './translation-fixture.mjs';

const KEY = 'name-translations.json';

let project;
let templateDir;
let templatePath;
let pluginRoot;
beforeAll(() => {
  project = makeGitProject();
  ({ dir: templateDir, path: templatePath } = writeTemplate());
  pluginRoot = makePluginRoot(FIXTURE_TEMPLATE);
});
afterAll(() => {
  project.cleanup();
  rmSync(templateDir, { recursive: true, force: true });
  rmSync(pluginRoot, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(join(project.root, '.excavator'), { recursive: true, force: true });
  rmSync(join(project.root, 'elsewhere'), { recursive: true, force: true });
  writeTranslatableProducts(project);
});

const pack = (options = {}) => {
  const result = packProject(project.root, { explorerTemplate: templatePath, ...options });
  const html = readFileSync(result.out, 'utf-8');
  return { result, html, ...explorerPage(html) };
};

// The table the page is checked against: three good entries (one identical to its English), two that do not match, one nothing shows.
const GOOD = [
  { en: 'Start the application', text: 'Demarrer l application' },
  { en: 'Validate OAuth2 token', text: 'Valider le jeton OAuth2' },
  { en: 'Billing', text: 'Billing' },
];
const BAD = [
  { en: 'Shipping', text: 'Expedition', storedEn: 'Another text' }, // the stored English is not the key's
  { en: 'Charge a customer', text: 'Facturer', key: sha256('something else') }, // the key is not the English's hash
];
const UNUSED = [{ en: 'A name no node uses', text: 'Un nom' }];
const COUNTS = { names: DISPLAYED.length, translated: 3, english: DISPLAYED.length - 3, identical: 1, mismatched: 2, unused: 1 };

describe('English and no language (negative checks: the page is as it was)', () => {
  const same = (a, b) => {
    expect(b.html).toBe(a.html);
    expect(b.data).toEqual(a.data);
    expect(b.manifest).toEqual(a.manifest);
  };

  it.each(['en', 'english', ' English ', 'en-GB'])('--language %j writes the page of no language, byte for byte, and no translation directory', (language) => {
    const plain = pack();
    const withLanguage = pack({ language });
    same(plain, withLanguage);
    expect(withLanguage.data).not.toHaveProperty(KEY);
    expect(withLanguage.manifest).not.toHaveProperty('translation');
    expect(existsSync(tableDir(pageDirOf(project)))).toBe(false);
  });

  it('does not read a table that is there when the language is English', () => {
    const plain = pack();
    writeTable(pageDirOf(project), 'en', [{ en: 'Billing', text: 'Facturation' }]);
    writeTable(pageDirOf(project), 'english', [{ en: 'Billing', text: 'Facturation' }]);
    same(plain, pack({ language: 'english' }));
    same(plain, pack());
  });
});

describe('another language', () => {
  it('adds the name table with only the displayed names that have a translation the table backs, and its counts', () => {
    writeTable(pageDirOf(project), 'zh', [...GOOD, ...BAD, ...UNUSED]);
    const packed = pack({ language: 'zh' });
    expect(packed.data[KEY]).toEqual({
      language: 'zh',
      names: {
        'Start the application': 'Demarrer l application',
        'Validate OAuth2 token': 'Valider le jeton OAuth2',
        Billing: 'Billing',
      },
      counts: COUNTS,
    });
  });

  it('takes a table entry only when its hash and its English both match (oracle 4), and counts the others as mismatched', () => {
    writeTable(pageDirOf(project), 'zh', [...GOOD, ...BAD]);
    const packed = pack({ language: 'zh' });
    expect(Object.keys(packed.data[KEY].names).sort()).toEqual(['Billing', 'Start the application', 'Validate OAuth2 token']);
    expect(packed.data[KEY].counts.mismatched).toBe(2);
    expect(packed.data[KEY].counts.unused).toBe(0);
    expect(JSON.stringify(packed.data[KEY])).not.toContain('Expedition');
    expect(JSON.stringify(packed.data[KEY])).not.toContain('Facturer');
  });

  it('counts an entry that is not an object with a text string as mismatched', () => {
    writeTable(pageDirOf(project), 'zh', GOOD);
    const path = tablePath(pageDirOf(project), 'zh');
    const table = readJson(path);
    table.entries[sha256('pick')] = { en: 'pick' };
    table.entries[sha256('receipt')] = 'Recu';
    writeFileSync(path, JSON.stringify(table));
    const counts = pack({ language: 'zh' }).data[KEY].counts;
    expect(counts).toMatchObject({ translated: 3, mismatched: 2 });
  });

  it('leaves the knowledge graph and the domain graph exactly as without a language (oracle 5)', () => {
    const plain = pack();
    writeTable(pageDirOf(project), 'zh', [...GOOD, ...BAD, ...UNUSED]);
    const packed = pack({ language: 'zh' });
    expect(packed.data[KEY]).toBeDefined();
    expect(packed.data['knowledge-graph.json']).toEqual(plain.data['knowledge-graph.json']);
    expect(packed.data['domain-graph.json']).toEqual(plain.data['domain-graph.json']);
    const withoutName = { ...packed.data };
    delete withoutName[KEY];
    expect(withoutName).toEqual(plain.data);
    // The graph still names the node in English; only the name table holds the translation.
    const node = packed.data['knowledge-graph.json'].nodes.find((n) => n.id === 'file:src/a.js');
    expect(node.displayName).toBe('Start the application');
  });

  it('does not list a stale or contradicted name, even when the table has a translation for it', () => {
    writeTable(pageDirOf(project), 'zh', [
      { en: 'Old stale name', text: 'Ancien nom' },
      { en: 'Secret contradicted name', text: 'Nom secret' },
      ...GOOD,
    ]);
    const packed = pack({ language: 'zh' });
    expect(Object.keys(packed.data[KEY].names)).not.toContain('Old stale name');
    expect(Object.keys(packed.data[KEY].names)).not.toContain('Secret contradicted name');
    expect(packed.data[KEY].counts.unused).toBe(2);
    expect(packed.html).not.toContain('Nom secret');
  });

  it('writes the key\'s row, the manifest\'s translation block and the key\'s size', () => {
    writeTable(pageDirOf(project), 'zh', [...GOOD, ...BAD, ...UNUSED]);
    const packed = pack({ language: 'zh' });
    expect(packed.manifest.translation).toEqual({ language: 'zh', counts: COUNTS });
    expect(packed.result.rows.find((row) => row.key === KEY)).toMatchObject({ key: KEY, status: 'included' });
    expect(packed.manifest.rows.find((row) => row.key === KEY)).toMatchObject({ status: 'included' });
    expect(packed.result.keys[KEY]).toBeGreaterThan(0);
    expect(packed.manifest.keys[KEY]).toBe(packed.result.keys[KEY]);
  });

  it('counts a displayed name that has no entry as English, and a table of nothing as all English', () => {
    const packed = pack({ language: 'zh' });
    expect(packed.data[KEY]).toEqual({
      language: 'zh',
      names: {},
      counts: { names: DISPLAYED.length, translated: 0, english: DISPLAYED.length, identical: 0, mismatched: 0, unused: 0 },
    });
    expect(packed.manifest.translation).toEqual({ language: 'zh', counts: packed.data[KEY].counts });
  });

  it('names an unreadable table in the key\'s row and treats it as no table', () => {
    mkdirSync(tableDir(pageDirOf(project)), { recursive: true });
    writeFileSync(tablePath(pageDirOf(project), 'zh'), '{ not json');
    const packed = pack({ language: 'zh' });
    expect(packed.data[KEY].counts).toMatchObject({ translated: 0, english: DISPLAYED.length });
    expect(packed.result.rows.find((row) => row.key === KEY)).toMatchObject({ status: 'unreadable' });
  });

  it('names the table after the trimmed, lower-cased language', () => {
    writeTable(pageDirOf(project), 'zh-cn', GOOD);
    const packed = pack({ language: ' ZH-CN ' });
    expect(packed.data[KEY].language).toBe('zh-cn');
    expect(packed.data[KEY].counts.translated).toBe(3);
  });

  it('never writes the table, a work directory or any other file', () => {
    const path = writeTable(pageDirOf(project), 'zh', [...GOOD, ...BAD]);
    const before = readFileSync(path, 'utf-8');
    const files = listTree(pageDirOf(project));
    expect(pack({ language: 'zh' }).data[KEY]).toBeDefined();
    expect(readFileSync(path, 'utf-8')).toBe(before);
    expect(listTree(pageDirOf(project)).filter((file) => !files.includes(file))).toEqual(['explorer.html']);
    expect(existsSync(workDir(pageDirOf(project), 'zh'))).toBe(false);
  });

  it('is deterministic: the same table gives the same page', () => {
    writeTable(pageDirOf(project), 'zh', [...GOOD, ...UNUSED]);
    const first = pack({ language: 'zh' });
    expect(first.data[KEY]).toBeDefined();
    expect(pack({ language: 'zh' }).html).toBe(first.html);
  });
});

describe('--out (oracle 6)', () => {
  it('reads the table beside the page and leaves .excavator without a new file', () => {
    const outDir = join(project.root, 'elsewhere');
    writeTable(outDir, 'zh', GOOD);
    const before = listTree(pageDirOf(project));
    const packed = pack({ language: 'zh', out: join(outDir, 'page.html') });
    expect(packed.data[KEY].counts.translated).toBe(3);
    expect(listTree(pageDirOf(project))).toEqual(before);
    expect(existsSync(tableDir(pageDirOf(project)))).toBe(false);
  });

  it('does not use the table under .excavator when the page is elsewhere', () => {
    writeTable(pageDirOf(project), 'zh', GOOD);
    const packed = pack({ language: 'zh', out: join(project.root, 'elsewhere', 'page.html') });
    expect(packed.data[KEY].counts.translated).toBe(0);
  });
});

describe('the command line', () => {
  const run = (...args) => {
    const result = spawnSync(process.execPath, [join(pluginRoot, 'skills/excavator-view/pack.mjs'), project.root, ...args], { encoding: 'utf-8' });
    return { ...result, json: result.status === 0 ? JSON.parse(result.stdout) : null };
  };

  it('--language zh packs with the table beside the page', () => {
    writeTable(pageDirOf(project), 'zh', GOOD);
    const out = run('--language', 'zh');
    expect(out.status).toBe(0);
    const { data, manifest } = explorerPage(readFileSync(out.json.out, 'utf-8'));
    expect(data[KEY].counts.translated).toBe(3);
    expect(manifest.translation.language).toBe('zh');
    expect(out.json.keys[KEY]).toBeGreaterThan(0);
  });

  it('--language english packs as no language does', () => {
    const plain = run();
    const plainHtml = readFileSync(plain.json.out, 'utf-8');
    const english = run('--language', 'english');
    expect(readFileSync(english.json.out, 'utf-8')).toBe(plainHtml);
  });

  it.each([[['--language', '../x'], /letters.*digits/], [['--language', 'a b'], /letters.*digits/], [['--language'], /--language needs a value/]])('%j exits non-zero and writes no page', (args, message) => {
    const out = run(...args);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(message);
    expect(existsSync(join(pageDirOf(project), 'explorer.html'))).toBe(false);
    expect(existsSync(tableDir(pageDirOf(project)))).toBe(false);
  });
});

describe('the built explorer template', () => {
  it('reads the name table and shows the English original beside a translation', () => {
    const template = readFileSync(join(repoRoot, 'packages/explorer/dist/explorer.html'), 'utf-8');
    expect(template).toContain(KEY);
    expect(template).toContain('machine-translated');
    expect(template).toContain('English: ');
  });
});
