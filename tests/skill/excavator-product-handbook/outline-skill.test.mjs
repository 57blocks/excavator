// Task 4.1 of openspec change handbook-outline: the outline phase is written down where the orchestrator acts on it: its own stage
// file with the commands the script has, the rules of the outline, no example part or chapter name; and SKILL.md names it in the
// file table, the work split, the Sections part and Phase 7.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HANDBOOK_SCRIPT, repoRoot } from './helpers.mjs';

const skillDir = join(repoRoot, 'skills/excavator-product-handbook');
const stage = readFileSync(join(skillDir, 'stages/outline.md'), 'utf-8');
const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8');
const flat = (text) => text.replace(/\s+/g, ' ');

describe('stages/outline.md', () => {
  it('is Phase 6e, after Phase 6d and before Phase 7, in the language of the run', () => {
    expect(stage.startsWith('## Phase 6e: The outline\n')).toBe(true);
    expect(flat(stage)).toContain('Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.');
    expect(flat(stage)).toContain('after Phase 6d');
    expect(flat(stage)).toContain('before Phase 7');
  });

  it('runs the two commands the script has, with the run\'s paths, and writes outline.json', () => {
    for (const command of ['outline-facts', 'check-outline']) {
      // outline-facts also passes --features (openspec change handbook-phase-gate).
      const features = command === 'outline-facts' ? ' --features "<ids>"' : '';
      expect(stage).toContain(`handbook.mjs" ${command} "$OUT"${features} --project "$PROJECT_ROOT"`);
      expect(readFileSync(HANDBOOK_SCRIPT, 'utf-8')).toContain(`'${command}'(args)`);
    }
    expect(stage).toContain('`$OUT/outline.json`');
    expect(stage).toContain('"format": "excavator-product-handbook-outline/1"');
  });

  it('states the rules: the readers\' own words in $LANGUAGE, readers\' first questions first, technical blocks after, unplaced only with a true reason, no content removed', () => {
    const text = flat(stage);
    expect(text).toContain('the way the readers of this project think of it');
    expect(text).toContain('in `$LANGUAGE`');
    expect(text).toContain('Put what a reader asks first at the front');
    expect(text).toContain('Put the technical blocks');
    expect(text).toContain('only with a reason that is true');
    expect(text).toContain('The outline never removes or edits content');
    expect(text).toContain('exactly once');
    expect(text).toContain('until it exits 0');
  });

  it('gives no example part or chapter name: every title in its JSON shape is a placeholder', () => {
    const titles = [...stage.matchAll(/"title": "([^"]*)"/g)].map((match) => match[1]);
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) expect(title.startsWith('<') && title.endsWith('>'), title).toBe(true);
    expect(stage).not.toMatch(/[^\x00-\x7F]/);
  });
});

describe('SKILL.md names the outline', () => {
  it('lists outline.json in the file table as written by the orchestrator in Phase 6e', () => {
    expect(skill).toContain('| `outline.json` | you (Phase 6e) |');
  });

  it('has the orchestrator write the outline in the work split table, and names stages/outline.md in the Sections part', () => {
    expect(flat(skill)).toContain('Write the map, the business domains and the outline (Phase 6e');
    expect(flat(skill)).toContain('`stages/outline.md` holds Phase 6e');
    expect(flat(skill)).toContain('`outline` (the parts and chapters of the handbook');
  });

  it('puts the outline after the other after-trace phases and says Phase 7 follows it, falling back to the default order without it', () => {
    const text = flat(skill);
    expect(text).toContain('Phase 6e, which writes the outline, `stages/outline.md`');
    expect(text).toContain('Both follow `$OUT/outline.json` (Phase 6e)');
    expect(text).toContain('they use the default order under the fixed names and say so in the coverage section');
  });

  it('has no part or chapter name in its text for the outline', () => {
    expect(skill).not.toMatch(/[^\x00-\x7F]/);
  });
});
