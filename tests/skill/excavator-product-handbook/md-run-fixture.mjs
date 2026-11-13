/**
 * Shared setup for the assemble and reply tests of the Markdown handbook: a throwaway run on
 * the synthetic fixture project whose chapters are written here and checked by the real `check`
 * command, so every record carries the real sha256 of its file.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeRun } from './helpers.mjs';

export const FORM = 'src/forms/order-form.js';
export const cite = (range, file = FORM) => `\`${file}:${range}\``;
export const CROSS = ['domains', 'roles', 'notifications', 'topics', 'defects', 'remedies'];

/** A chapter that passes `check` as a feature or system chapter. */
export const chapterText = (title = 'Orders', extra = '') => `# ${title}

## Operations

The clerk fills in the "Customer Name" field (${cite('5')}).

- An order is Draft until it is sent (${cite('10')}).
${extra}
## Open questions

Nobody can tell how long drafts live.

## Problems

None found.
`;

/** A run with a good map; `chapters` is `{ name: text }`; every written chapter is checked once. */
export function newMdRun(chapters = {}, { check = true } = {}) {
  const run = makeRun();
  run.writeMap();
  mkdirSync(join(run.out, 'chapters'), { recursive: true });
  run.write = (name, text) => writeFileSync(join(run.out, 'chapters', `${name}.md`), text);
  run.read = (file) => readFileSync(join(run.out, file), 'utf-8');
  run.check = (...args) => run.run('check', ...args);
  run.assemble = (...args) => run.run('assemble', ...args);
  run.reply = (...args) => run.run('reply', ...args);
  // A domains.json that passes `check domains` for the chapter as written: its first level-2 heading holds every feature.
  run.writeDomainsList = () => {
    const first = /^## (.+)$/m.exec(readFileSync(join(run.out, 'chapters', 'domains.md'), 'utf-8'));
    const value = { domains: [{ name: first[1].trim(), features: run.map.features.map((feature) => feature.id) }], handovers: [] };
    writeFileSync(join(run.out, 'domains.json'), `${JSON.stringify(value, null, 2)}\n`);
  };
  for (const [name, text] of Object.entries(chapters)) run.write(name, text);
  if (chapters.domains !== undefined) run.writeDomainsList();
  if (check && Object.keys(chapters).length > 0) run.check();
  return run;
}
