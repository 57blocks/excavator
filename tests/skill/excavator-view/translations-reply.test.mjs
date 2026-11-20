/**
 * The sixth reply line (openspec: changes/view-name-translation, design D6, oracle 7): its shape and its counts come
 * from the manifest the packer wrote into the page.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { packProject } from '../../../skills/excavator-view/pack.mjs';
import { readExplorerManifest, replyLines } from '../../../skills/excavator-view/reply.mjs';
import { makeGitProject } from './fixture.mjs';
import { writeTemplate, repoRoot } from './plugin-fixture.mjs';
import { DISPLAYED, pageDirOf, writeTable, writeTranslatableProducts } from './translation-fixture.mjs';

const replyScript = join(repoRoot, 'skills/excavator-view/reply.mjs');

let project;
let templateDir;
let templatePath;
beforeAll(() => {
  project = makeGitProject();
  ({ dir: templateDir, path: templatePath } = writeTemplate());
});
afterAll(() => {
  project.cleanup();
  rmSync(templateDir, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(join(project.root, '.excavator'), { recursive: true, force: true });
  writeTranslatableProducts(project);
});

const reply = (options) => {
  const result = packProject(project.root, { explorerTemplate: templatePath, ...options });
  const run = spawnSync(process.execPath, [replyScript, result.out], { encoding: 'utf-8' });
  expect(run.status).toBe(0);
  return { result, lines: run.stdout.trimEnd().split('\n') };
};

describe('replyLines', () => {
  const manifest = (translation) => ({ explorer: 2, products: [], source: { embedded: false, counts: {} }, issues: null, ...(translation ? { translation } : {}) });
  const counts = { names: 12, translated: 3, english: 9, identical: 1, mismatched: 0, unused: 0 };

  it('has five lines when the manifest has no translation', () => {
    expect(replyLines('/p/explorer.html', 1048576, manifest())).toHaveLength(5);
  });

  it('adds Translation: <language> <translated>/<names> names (<english> in English) when it has one', () => {
    const lines = replyLines('/p/explorer.html', 1048576, manifest({ language: 'zh', counts }));
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe('Translation: zh 3/12 names (9 in English)');
  });

  it('takes every number from the counts', () => {
    const lines = replyLines('/p/explorer.html', 1, manifest({ language: 'pt-br', counts: { names: 0, translated: 0, english: 0, identical: 0, mismatched: 0, unused: 0 } }));
    expect(lines[5]).toBe('Translation: pt-br 0/0 names (0 in English)');
  });
});

describe('reply.mjs on a packed page', () => {
  it('prints five lines for a page packed with no language, and for English', () => {
    expect(reply().lines).toHaveLength(5);
    expect(reply({ language: 'english' }).lines).toHaveLength(5);
  });

  it('prints the sixth line with the counts the page manifest holds', () => {
    writeTable(pageDirOf(project), 'zh', [
      { en: 'Billing', text: 'Billing' },
      { en: 'pick', text: 'Choisir' },
      { en: 'receipt', text: 'Recu' },
    ]);
    const { result, lines } = reply({ language: 'zh' });
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe(`Explorer: ${result.out}`);
    expect(lines[5]).toBe(`Translation: zh 3/${DISPLAYED.length} names (${DISPLAYED.length - 3} in English)`);
    const manifest = readExplorerManifest(readFileSync(result.out, 'utf-8'));
    expect(lines[5]).toBe(`Translation: ${manifest.translation.language} ${manifest.translation.counts.translated}/${manifest.translation.counts.names} names (${manifest.translation.counts.english} in English)`);
  });

  it('still prints the sixth line when no name is translated', () => {
    const { lines } = reply({ language: 'zh' });
    expect(lines[5]).toBe(`Translation: zh 0/${DISPLAYED.length} names (${DISPLAYED.length} in English)`);
  });
});
