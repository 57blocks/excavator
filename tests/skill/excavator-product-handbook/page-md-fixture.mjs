/**
 * Shared setup for the page tests of the Markdown handbook: a checked run (md-run-fixture.mjs) whose
 * feature chapter has a table, a list, two diagrams and a diagram that cannot be drawn, with the data
 * section, the status dictionaries and the code health written beside the chapters.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

import { writeHistory } from './appendix-fixture.mjs';
import { repoRoot, runHandbook } from './helpers.mjs';
import { chapterText, cite, newMdRun } from './md-run-fixture.mjs';

import { extractData } from '../../../skills/excavator-product-handbook/lib/data-extract.mjs';
import { extractDictionaries } from '../../../skills/excavator-product-handbook/lib/dict-extract.mjs';

export const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
export const STUB_TWO = `${STUB.replace('<body>', '<body data-template="two">')}`;
export const BROKEN_DIAGRAM = 'flowchart TD\n  A[Start --> ';

/** The extra block of the feature chapter: a table, a list, a flowchart, a state diagram and a diagram with a syntax error. */
export const richExtra = () => `
| Role | Can do |
| --- | --- |
| Clerk ${cite('1', 'src/roles.js')} | Creates an order ${cite('2', 'src/roles.js')} |
| Approver | Sends an order ${cite('3', 'src/roles.js')} |

- First step ${cite('5')}
- Second step ${cite('10')}

\`\`\`mermaid
flowchart TD
  A[Clerk] --> B[Order]
\`\`\`

\`\`\`mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Sent
\`\`\`

\`\`\`mermaid
${BROKEN_DIAGRAM}
\`\`\`
`;

/** A checked run with the system and F1 chapters, the data section, the dictionaries and the code health. */
export function pageRun(cleanups, { withScripts = true } = {}) {
  const run = newMdRun({ system: chapterText('System'), F1: chapterText('Orders', richExtra()) });
  cleanups.push(run.cleanup);
  if (withScripts) {
    writeFileSync(join(run.out, 'data.json'), `${JSON.stringify(extractData(join(repoRoot, 'tests/fixtures/product-handbook/data-project')), null, 2)}\n`);
    writeFileSync(join(run.out, 'dictionaries.json'), `${JSON.stringify(extractDictionaries(join(repoRoot, 'tests/fixtures/product-handbook/dict-project')), null, 2)}\n`);
    mkdirSync(join(run.out, 'entries'), { recursive: true });
    writeHistory(run);
  }
  return run;
}

/** Run `page`; `env` is merged over the environment; `views` is the --views value. */
export function runPage(run, { template, views = 'product,technical', env = {} } = {}) {
  return runHandbook(['page', run.out, '--project', run.root, '--views', views], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: template, ...env } });
}

export const html = (run) => readFileSync(join(run.out, 'handbook.html'), 'utf-8');
/** The page data parsed out of the data block. */
export function dataOf(text) {
  const match = /<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(text);
  if (match === null) throw new Error('the page has no data block');
  return JSON.parse(match[1]);
}

/** Every file under `dir` with its sha256, as `{ path: hash }`, skipping the paths for which `skip(relativePath)` is true. */
export function listing(dir, skip = () => false) {
  const out = {};
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const rel = relative(dir, path);
      if (skip(rel)) continue;
      if (statSync(path).isDirectory()) walk(path);
      else out[rel] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  };
  walk(dir);
  return out;
}
