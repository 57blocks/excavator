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
## Points to confirm

Nobody can tell how long drafts live.

## Known defects

None.
`;

/** A defects chapter with one P0 defect (D1, display, F1) that passes `check defects`. */
export const DEFECTS_ONE = `# Defects

## P0

- **display** **Hidden button** The list hides a button, Orders (F1) (${cite('5')}).

## P1

None.

## P2

None.
`;

/** A remedies chapter that passes `check remedies` beside DEFECTS_ONE and no design problems chapter; \`extra\` is added to the end of the last list item's text. */
export const remediesText = (extra = '') => `# Remedies

## Measures across processes

None.

## Defect fixes

- **display** Show the hidden button again [D1] (${cite('5')}).

## To simplify and unify

None.

## To fix

1. **Fix** Show the button on the list [D1] (${cite('5')}).${extra}
`;

/** A domains chapter that passes `check domains`: one domain under the fixed level-3 headings (design D23). */
export const DOMAINS_TEXT = `# Domains

## Orders

The orders domain (${cite('5')}).

### Features

| Feature | Purpose |
| --- | --- |
| Orders (F1) | Takes orders (${cite('5')}) |

### Hand-overs

None.
`;

/** A remedies chapter that passes `check remedies` beside a defects chapter with no defect and no design problems: every section holds the none text. */
export const REMEDIES_NONE = `# Remedies

## Measures across processes

None.

## Defect fixes

None.

## To simplify and unify

None.

## To fix

None.
`;

/** The text of a chapter called `name` for a run with every chapter: the domains and remedies chapters above, any other `chapterText`. */
export const textOf = (name) => (name === 'domains' ? DOMAINS_TEXT : name === 'remedies' ? REMEDIES_NONE : chapterText(name));

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
