/**
 * The excavator-unused-code skill is a prompt; its rules only hold if each one
 * sits in the step where the model makes that decision. A rule stated once at
 * the top is skipped under pressure, so these tests pin every rule to its step
 * and check the signal names the skill explains exist in the script.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const skill = readFileSync(resolve(repoRoot, 'skills/excavator-unused-code/SKILL.md'), 'utf-8');
const script = readFileSync(resolve(repoRoot, 'skills/excavator/unused-code.mjs'), 'utf-8');
const flat = (text) => text.replace(/\s+/g, ' ');

/** Split the skill into its `## Step N — Title` sections, keyed by N. */
function steps(text) {
  const out = new Map();
  const parts = text.split(/^## Step (\d+) — /m);
  for (let i = 1; i < parts.length; i += 2) out.set(Number(parts[i]), flat(parts[i + 1]));
  return out;
}
const step = steps(skill);
const before = flat(skill.split(/^## Step 1 — /m)[0]);

describe('excavator-unused-code skill: steps', () => {
  it('has the six steps in order', () => {
    expect([...step.keys()]).toEqual([1, 2, 3, 4, 5, 6]);
    const titles = [...skill.matchAll(/^## Step \d+ — (.+)$/gm)].map((m) => m[1]);
    expect(titles).toEqual([
      'Check the facts',
      'List the candidates',
      'Decide the entries',
      'Write the decisions',
      'Run the report',
      'Report to the user',
    ]);
  });

  it('frontmatter names the skill after its directory', () => {
    expect(skill.startsWith('---\nname: excavator-unused-code\n')).toBe(true);
  });
});

describe('excavator-unused-code skill: each rule in its step', () => {
  it('step 1 checks freshness with the shared helper and stops on stale facts', () => {
    expect(step.get(1)).toContain('skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT"');
    expect(step.get(1)).toContain('do not continue on stale facts');
  });

  it('step 2 runs candidates and reads the product with jq only', () => {
    expect(step.get(2)).toContain('node "$UC" candidates "$PROJECT_ROOT"');
    expect(step.get(2)).toContain('never read `$CANDS` whole');
  });

  it('step 3 decides entries from the addenda and sampled source, and only removes', () => {
    const s = step.get(3);
    expect(s).toContain('$PLUGIN_ROOT/skills/excavator/frameworks/<id>.md');
    expect(s).toContain('it is not a licence to reconstruct its conventions from memory');
    expect(s).toContain('**Decide an entry only when you can name its caller and the mechanism**');
    expect(s).toContain('Read at least three members of the group first');
    expect(s).toContain('**When unsure, do not decide.** A decision can only remove candidates.');
    expect(s).toContain('**Public is not an entry by itself.**');
    expect(s).toContain('Do not mark a whole test directory');
    expect(s).toContain('**A handler the facts did not link is still an entry.**');
  });

  it('step 4 makes ids the output of the query and refuses overlaps and empty decisions', () => {
    const s = step.get(4);
    expect(s).toContain('**Never type, paste or edit an id.**');
    expect(s).toContain('ids: ([ $3 | .id ] | unique)');
    expect(s).toContain('decide: no candidate matches');
    expect(s).toContain('ids already decided by an earlier decision');
    expect(s).toContain(`'{factsDigest: $digest, decisions: .}'`);
    expect(s).toContain('"$DATA/unused-decisions.json"');
  });

  it('step 5 runs report and leaves confidence to the rules', () => {
    expect(step.get(5)).toContain('node "$UC" report "$PROJECT_ROOT"');
    expect(step.get(5)).toContain('you never assign it');
  });

  it('step 6 never calls medium or low unused and never touches project files', () => {
    const s = step.get(6);
    expect(s).toContain('**Never call a `medium` or `low` candidate unused.**');
    expect(s).toContain('**Never edit, move or delete project files.**');
    expect(s).toContain('Do not add items the product does not list.');
  });

  it('keeps the step rules out of the preamble, where they would be skipped', () => {
    for (const rule of ['Never type, paste or edit an id', 'Never call a `medium` or `low`', 'When unsure, do not decide']) {
      expect(before).not.toContain(rule);
    }
  });
});

describe('excavator-unused-code skill: agrees with the script', () => {
  it('explains only signals the script emits', () => {
    const named = [...skill.matchAll(/\(`([a-z-]+)`\)/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThanOrEqual(5);
    for (const signal of named) expect(script).toContain(`'${signal}'`);
  });

  it('writes and reads the products the script names', () => {
    for (const file of ['unused-candidates.json', 'unused-decisions.json', 'unused-code.json']) {
      expect(script).toContain(`'${file}'`);
      expect(skill).toContain(file);
    }
  });
});
