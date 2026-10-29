/**
 * The packer and the page agree (openspec: changes/explorer-chunked-data, design D4, D6): the page's
 * own reader (`inlineData.ts`) reads a page the real packer wrote, through a document that answers
 * `getElementById` from the page's text, and gets the data the test reader (`page.mjs`) rebuilds.
 */

import { readFileSync, rmSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { hasInlineFile, hasInlineSource, readInlineFile, readInlineSource } from '../../../packages/explorer/src/offline/inlineData.ts';
import { packProject } from '../../../skills/excavator-view/pack.mjs';
import { graphJsonl, hotspotsProduct, makeGitProject, sourceManifest, unusedProduct, writeProduct } from './fixture.mjs';
import { explorerPage } from './page.mjs';
import { writeTemplate } from './plugin-fixture.mjs';

let project;
let templateDir;
let templatePath;
beforeAll(() => {
  project = makeGitProject({ 'src/a.js': 'export const a = 1;\n', 'src/b.js': 'export const b = 2;\n' });
  ({ dir: templateDir, path: templatePath } = writeTemplate());
  writeProduct(project.root, 'knowledge-graph.jsonl', graphJsonl({ name: 'p' }));
  writeProduct(project.root, 'source-manifest.json', sourceManifest(project.revision));
  writeProduct(project.root, 'hotspots.json', hotspotsProduct(project.revision));
  const row = (file) => ({ id: file, name: file, language: 'javascript', file, lineRange: [1, 1], reason: 'unreferenced', confidence: 'high' });
  writeProduct(project.root, 'unused-code.json', unusedProduct(project.revision, { unused: ['src/a.js', 'src/b.js'].map(row) }));
});
afterAll(() => {
  project.cleanup();
  rmSync(templateDir, { recursive: true, force: true });
});
afterEach(() => {
  delete globalThis.document;
  vi.restoreAllMocks();
});

/** A document made of the page's own script blocks, by id. */
function documentOf(html) {
  const elements = new Map();
  for (const match of html.matchAll(/<script type="application\/(?:json|octet-stream)" id="([^"]+)">([^<]*)<\/script>/g)) {
    elements.set(match[1], { textContent: match[2] });
  }
  return { getElementById: (id) => elements.get(id) ?? null };
}

describe('the page reads what the packer wrote', () => {
  it.each([undefined, 64])('for a part limit of %s', async (partChars) => {
    const result = packProject(project.root, { explorerTemplate: templatePath, partChars });
    const html = readFileSync(result.out, 'utf-8');
    const { data } = explorerPage(html);
    globalThis.document = documentOf(html);

    expect(Object.keys(data)).toContain('knowledge-graph.json');
    for (const key of Object.keys(data).filter((name) => name !== 'sources')) {
      expect(hasInlineFile(key)).toBe(true);
      expect(await (await readInlineFile(key)).json()).toEqual(data[key]);
    }
    expect(hasInlineFile('config.json')).toBe(false);
    expect(Object.keys(data.sources)).toEqual(['src/a.js', 'src/b.js']);
    for (const [path, entry] of Object.entries(data.sources)) {
      expect(hasInlineSource(path)).toBe(true);
      expect(await (await readInlineSource(path)).json()).toEqual(entry);
    }
    expect(hasInlineSource('src/none.js')).toBe(false);
  });

  it('decodes nothing for the has calls and nothing of the sources when only the graph is read', async () => {
    const result = packProject(project.root, { explorerTemplate: templatePath, partChars: 64 });
    globalThis.document = documentOf(readFileSync(result.out, 'utf-8'));
    const atob = vi.spyOn(globalThis, 'atob');
    expect(hasInlineFile('knowledge-graph.json')).toBe(true);
    expect(hasInlineFile('hotspots.json')).toBe(true);
    expect(hasInlineSource('src/a.js')).toBe(true);
    expect(atob).not.toHaveBeenCalled();
    await readInlineFile('knowledge-graph.json');
    const index = JSON.parse(/id="xv-explorer-index">([^<]*)</.exec(readFileSync(result.out, 'utf-8'))[1]);
    const graphParts = new Set(index.files['knowledge-graph.json'].fields.flatMap((f) => f.parts ?? [f.part]));
    expect(atob).toHaveBeenCalledTimes(graphParts.size);
  });
});
