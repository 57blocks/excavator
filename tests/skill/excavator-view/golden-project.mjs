/**
 * A synthetic project whose packed view page is the same bytes on every machine
 * (openspec: changes/viewer-explorer, spec scenario "old viewer unchanged"): a git
 * repository with a fixed author, fixed dates and a fixed directory name, so the
 * commit hash, the project name in the manifest and every product that records the
 * revision are fixed. The view page this project packs with `FIXTURE_TEMPLATE` was
 * frozen from the packer as it was before the explorer page was added.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { domainGraph, factGraphJsonl, hotspotsProduct, tourProduct, unusedProduct, writeProduct } from './fixture.mjs';

export const GOLDEN_FACTS_DIGEST = 'f'.repeat(64);

const FILES = {
  'src/a.js': 'export function run() {\n  return load();\n}\n\nfunction load() {\n  return 1;\n}\n',
  'src/b.js': 'export function load() {\n  return 2;\n}\n',
};

const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
  cwd,
  encoding: 'utf-8',
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  },
}).trim();

/** @returns {{ root: string, revision: string, cleanup: () => void }} */
export function makeGoldenProject() {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'xv-golden-')));
  const root = join(parent, 'golden-project');
  mkdirSync(root);
  git(root, 'init', '-q');
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'golden');
  const revision = `git:${git(root, 'rev-parse', 'HEAD')}`;

  const nodes = [
    { id: 'file:src/a.js', filePath: 'src/a.js' },
    { id: 'function:src/a.js:run', filePath: 'src/a.js' },
    { id: 'file:src/b.js', filePath: 'src/b.js' },
  ];
  writeProduct(root, 'knowledge-graph.jsonl', factGraphJsonl({ factsDigest: GOLDEN_FACTS_DIGEST, nodes }));
  writeProduct(root, 'source-manifest.json', { sourceRevision: revision });
  writeProduct(root, 'domain-graph.json', domainGraph({ sourceRevision: revision, factDigest: GOLDEN_FACTS_DIGEST }));
  writeProduct(root, 'tour.json', tourProduct({ sourceRevision: revision, factDigest: GOLDEN_FACTS_DIGEST }));
  writeProduct(root, 'hotspots.json', hotspotsProduct(revision));
  writeProduct(root, 'unused-code.json', unusedProduct(revision));
  writeProduct(root, 'hotspots-report.md', '# Hotspots\n');
  return { root, revision, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}
