/**
 * The skopo skills are prompts; their rules hold only if each sits where the model acts on it
 * (openspec change skopo-extension, design D6, D7, D9). These tests pin the rules a run depends
 * on: unattended, no lock, the state machine read before any work, the scripts by their real
 * paths, and the researcher's dispatch.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { STATES } from '../../../skills/skopo-create/lib/run-state.mjs';
import { repoRoot } from './helpers.mjs';

const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');
const SKILLS = ['skopo-plan', 'skopo-create', 'skopo-report'];
const skill = Object.fromEntries(SKILLS.map((name) => [name, read(`skills/${name}/SKILL.md`)]));
const researcher = read('agents/skopo-researcher.md');
const LANGUAGE_RULE = '**Language.** Write everything you tell the user during this run in `$LANGUAGE`';

describe('skopo skills', () => {
  it.each(SKILLS)('%s names itself and states the language rule', (name) => {
    expect(skill[name]).toMatch(new RegExp(`^---\\nname: ${name}\\n`));
    expect(skill[name]).toContain(LANGUAGE_RULE);
  });

  it.each(SKILLS)('%s never asks the user and never writes a lock', (name) => {
    expect(skill[name]).not.toMatch(/AskUserQuestion/);
    expect(skill[name]).not.toMatch(/lock\.mjs|spec\.lock\.json"? *>|\/skopo:lock/);
  });

  it.each(SKILLS)('%s calls only scripts that exist', (name) => {
    const paths = [...skill[name].matchAll(/\$PLUGIN_ROOT\/([\w./-]+\.(?:mjs|md|json))/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(existsSync(resolve(repoRoot, path)), path).toBe(true);
  });

  it('reads the state before any work, and handles every state', () => {
    for (const name of ['skopo-plan', 'skopo-create']) {
      const text = flat(skill[name]);
      expect(text.indexOf('skopo.mjs" status')).toBeGreaterThan(0);
      expect(text.indexOf('skopo.mjs" status')).toBeLessThan(text.indexOf('## Phase 1'));
      for (const state of STATES) expect(text, `${name} handles ${state}`).toContain(`\`${state}\``);
    }
  });

  it('plan dispatches the researcher in the foreground with the facts and the stack', () => {
    const text = flat(skill['skopo-plan']);
    expect(text).toContain('`excavator:skopo-researcher`');
    expect(text).toMatch(/in the foreground \(never in the background/);
    for (const field of ['`LENS`', '`ROOTS`', '`FOCUS`', '`INVENTORY=$RUN/inventory.json`', '`GRAPH`', '`STACK`']) expect(text).toContain(field);
    expect(text).toContain('$PLUGIN_ROOT/skills/skopo-create/jakarta-ee.md');
  });

  it('plan splits a system too large for one run, and create stops on a split plan', () => {
    expect(flat(skill['skopo-plan'])).toMatch(/Above about 300,000 lines of code/);
    expect(flat(skill['skopo-plan'])).toContain('set "$RUN" plan=<auto|split>');
    expect(flat(skill['skopo-create'])).toMatch(/prints `split`.*stopped=needs-scope/);
  });

  it('create lints through run.mjs, assigns IDs before each lint, and ends with the verdict', () => {
    const text = flat(skill['skopo-create']);
    expect(text).toContain('checker/run.mjs" lint "$RUN" "$SKOPO"');
    expect(text).toContain('assign-ids.mjs" "$SKOPO" --map "$RUN/ids.json" --also "$RUN/questions.md" --also "$RUN/notes.md"');
    expect(text).toMatch(/verdict "\$OUT" --stage create/);
    expect(text).toMatch(/rm -rf "\$SKOPO"/);
  });

  it('report leaves the script-owned sections and files to the script', () => {
    const text = flat(skill['skopo-report']);
    for (const heading of ['`Status`', '`Questions`', '`Decisions without a recorded reason`', '`Scope and coverage`']) expect(text).toContain(heading);
    expect(text).toContain('Never write or edit `report.md` or `report.html` yourself.');
    expect(text).toMatch(/report-check "\$OUT".*report-assemble "\$OUT".*report-page "\$OUT".*verdict "\$OUT" --stage report/);
  });
});

describe('skopo-researcher', () => {
  it('reads the facts as a way in, never as evidence, and writes nothing', () => {
    const text = flat(researcher);
    expect(researcher).toMatch(/^---\nname: skopo-researcher\n/);
    expect(text).toContain('A fact is never evidence.');
    expect(text).toContain('`STACK`');
    expect(text).toMatch(/You write nothing/);
    expect(text).not.toContain('`MAP`');
  });

  it('can read and query the facts but has no tool that writes', () => {
    const tools = (researcher.match(/^tools: (.*)$/m) ?? [])[1]?.split(', ') ?? [];
    expect(tools).toEqual([
      'Read', 'Glob', 'Grep', 'Bash',
      'mcp__plugin_excavator_excavator__project_status', 'mcp__plugin_excavator_excavator__recall',
      'mcp__plugin_excavator_excavator__traverse', 'mcp__plugin_excavator_excavator__read_evidence',
    ]);
  });

  it('keeps the lenses and the report format of Skopo\'s researcher', () => {
    for (const lens of ['**world.**', '**documents.**', '**surfaces.**', '**design.**', '**history.**']) expect(researcher).toContain(lens);
    expect(researcher).toContain('report complete: <n> rules, <n> conflicts, <n> recorded reasons');
  });
});
