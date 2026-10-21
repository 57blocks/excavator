/**
 * The excavator-prd skill is a prompt; its rules only hold if each one sits in
 * the phase where the model acts on it. These tests pin the language of
 * everything the skill writes to the user to the phases that write it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const skill = readFileSync(resolve(repoRoot, 'skills/excavator-prd/SKILL.md'), 'utf-8');
const flat = (text) => text.replace(/\s+/g, ' ');

/** Split the skill into its `## Phase N — Title` sections, keyed by N, each without its title line. */
function phases(text) {
  const out = new Map();
  const parts = text.split(/^## Phase (\d+) — /m);
  for (let i = 1; i < parts.length; i += 2) out.set(Number(parts[i]), flat(parts[i + 1].slice(parts[i + 1].indexOf('\n') + 1)).trim());
  return out;
}
const phase = phases(skill);
const before = flat(skill.split(/^## Phase 0 — /m)[0]);

/** The language paragraph (the same words as /excavator-hotspots), the line each later phase starts with, and the option (whitespace flattened). */
const LANGUAGE_RULE = '**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file\'s rule to reply in another language is for work on the project\'s code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product\'s values stay as they are.';
const PHASE_LANGUAGE = 'Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.';
const OPTION_LANGUAGE = '`--language <lang>` — the language of the PRD and everything said to the user during the run; English when it is not given.';

describe('excavator-prd skill: phases', () => {
  it('has the five phases in order', () => {
    expect([...phase.keys()]).toEqual([0, 1, 2, 3, 4]);
    const titles = [...skill.matchAll(/^## Phase \d+ — (.+)$/gm)].map((m) => m[1]);
    expect(titles).toEqual([
      'Setup',
      'Build the complete flow inventory',
      'Plan the outline for the audience',
      'Write the PRD',
      'Coverage self-check, then save',
    ]);
  });

  it('frontmatter names the skill after its directory', () => {
    expect(skill.startsWith('---\nname: excavator-prd\n')).toBe(true);
  });

  it('holds no Chinese character', () => {
    expect(skill).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/u);
  });
});

describe('excavator-prd skill: the language of what it writes', () => {
  it('writes the PRD and every line to the user in English unless --language names another language', () => {
    expect(before).toContain(OPTION_LANGUAGE);
    expect(before).not.toContain('primary human language');
    expect(skill).toContain('argument-hint: "[path] [--role <audience>] [--language <lang>] [--scope <domain-or-subdir>]"');
    expect(phase.get(0)).toContain('Parse `--role` (default `product manager`), `--language` (`$LANGUAGE`: English when it is not given) and `--scope`.');
  });

  it('writes the PRD in $LANGUAGE, which only the option and Phase 0 name by its flag', () => {
    const write = phase.get(3);
    expect(write).toContain('Write in `$LANGUAGE`, in product language for `--role`.');
    expect(write).toContain('localized to `$LANGUAGE`.');
    expect(write).toContain('When `$LANGUAGE` differs from the source\'s language');
    expect(write).not.toContain('`--language`');
  });

  it('opens Phase 0 with the paragraph /excavator-hotspots holds, word for word, and every later phase points back to it', () => {
    const hotspots = readFileSync(resolve(repoRoot, 'skills/excavator-hotspots/SKILL.md'), 'utf-8');
    expect(flat(hotspots)).toContain(LANGUAGE_RULE);
    expect(phase.get(0).startsWith(LANGUAGE_RULE)).toBe(true);
    for (const n of [1, 2, 3, 4]) expect(phase.get(n).startsWith(PHASE_LANGUAGE), `Phase ${n}`).toBe(true);
  });
});
