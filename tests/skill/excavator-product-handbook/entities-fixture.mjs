/**
 * A synthetic project and hand-built run inputs for the entity tests (openspec
 * change handbook-entities-and-views). The project has two application roots
 * (`svc`, with a listed sub-application `svc/admin`, and `other`) and files
 * that name an external system in a comment, with another case, in a test
 * file and under a skipped directory.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const SYSTEM = 'Slack';

const FILES = {
  'svc/package.json': '{}\n',
  'svc/a.js': `// notifies ${SYSTEM} when an order arrives\nexport const a = 1;\n`,
  'svc/a2.js': `export const post = () => '${SYSTEM}';\n`,
  'svc/a.test.js': `// ${SYSTEM} in a test file\n`,
  'svc/node_modules/dep/index.js': `// ${SYSTEM} in a dependency\n`,
  'svc/admin/package.json': '{}\n',
  'svc/admin/b.js': `export const b = '${SYSTEM}';\n`,
  'svc/admin/panel.js': 'export const panel = 1;\nexport const rows = 2;\nexport const title = 3;\n',
  'other/package.json': '{}\n',
  'other/c.js': `// the word ${SYSTEM.toLowerCase()} is lower case here\n`,
  'other/d.js': 'export const d = 1;\n',
  'other/jobs.js': 'export const job = () => 1;\n',
  'svc/routes.js': 'export const routes = 1;\nexport const more = 2;\n',
};

/** A throwaway copy of the synthetic project; returns { root, cleanup }. */
export function makeProject(extra = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'xhe-')));
  for (const [rel, text] of Object.entries({ ...FILES, ...extra })) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export const ev = (file, passage) => ({ file, passage });

/** A verified entry with the given `who` items and citations on a purpose and on one state. */
export function entryOf({ purpose, who = [], cites = [] }) {
  return {
    format: 'excavator-product-handbook-entry/2',
    id: 'X',
    ...(purpose === undefined ? {} : { purpose: { text: purpose, evidence: [cites[0] ?? ev('svc/routes.js', 'export const routes = 1;')] } }),
    who: who.map(({ role, can, at }) => ({ role, can, evidence: [at] })),
    where: [],
    screens: [],
    operations: [],
    transitions: [],
    states: cites.slice(1).map((citation, index) => ({ label: `S${index}`, meaning: 'm', evidence: [citation] })),
    notifications: [],
    automatic: [],
    unknowns: [],
  };
}
