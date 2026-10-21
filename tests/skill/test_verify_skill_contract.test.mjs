/**
 * The excavator-verify skill is a prompt; its rules only hold if each one sits in
 * the phase where the model acts on it. These tests pin the language of the
 * report and of everything the skill writes to the user, and keep the
 * document's own language for what is quoted from it or written into it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const skill = readFileSync(resolve(repoRoot, 'skills/excavator-verify/SKILL.md'), 'utf-8');
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
const OPTION_LANGUAGE = '`--language <lang>` — the language of the report and everything said to the user during the run; English when it is not given. Quotes and corrections stay in the document\'s language.';

describe('excavator-verify skill: phases', () => {
  it('has the six phases in order', () => {
    expect([...phase.keys()]).toEqual([0, 1, 2, 3, 4, 5]);
    const titles = [...skill.matchAll(/^## Phase \d+ — (.+)$/gm)].map((m) => m[1]);
    expect(titles).toEqual([
      'Setup',
      'Dispatch section verifiers in parallel',
      'Cross-section consistency',
      'Report',
      'Self-check',
      'Fix (only with `--fix`)',
    ]);
  });

  it('frontmatter names the skill after its directory', () => {
    expect(skill.startsWith('---\nname: excavator-verify\n')).toBe(true);
  });

  it('holds no Chinese character', () => {
    expect(skill).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/u);
  });
});

describe('excavator-verify skill: the language of what it writes', () => {
  it('writes the report and every line to the user in English unless --language names another language', () => {
    expect(before).toContain(OPTION_LANGUAGE);
    expect(skill).toContain('argument-hint: "<document> [project-path] [--fix] [--report <path>] [--language <lang>]"');
    expect(phase.get(0)).toContain('1. Resolve `DOC` and `PROJECT_ROOT`, and parse `--fix`, `--report` and `--language` (`$LANGUAGE`: English when it is not given).');
    expect(flat(skill).split(LANGUAGE_RULE).join('').split('`--language').length - 1).toBe(2);
  });

  it('writes the report in $LANGUAGE and keeps quotes and corrections in the document\'s language', () => {
    expect(phase.get(0)).toContain('Note the document\'s language as `DOC_LANGUAGE`: quotes, corrections and the summary `--fix` appends are in `DOC_LANGUAGE` and the document\'s style, whatever `$LANGUAGE` is.');
    expect(phase.get(1)).toContain('Document language: <DOC_LANGUAGE>.');
    expect(phase.get(1)).toContain('the replacement statement in <DOC_LANGUAGE>, matching the document\'s style');
    expect(skill).not.toContain('<LANGUAGE>');
    expect(phase.get(2)).toContain('a correction for the wrong side, in `DOC_LANGUAGE`.');
    expect(phase.get(3)).toContain('Write the report to the `--report` path in `$LANGUAGE`; quotes and corrections stay in `DOC_LANGUAGE`, as the document has them:');
    expect(phase.get(5)).toContain('(heading in `DOC_LANGUAGE`, e.g. "Verification summary" for a document in English)');
    expect(skill).not.toContain('the document\'s language:');
  });

  it('is the paragraph /excavator-hotspots holds, word for word', () => {
    const hotspots = readFileSync(resolve(repoRoot, 'skills/excavator-hotspots/SKILL.md'), 'utf-8');
    expect(flat(hotspots)).toContain(LANGUAGE_RULE);
  });

  it('opens Phase 0, and every later phase points back to it', () => {
    expect(phase.get(0).startsWith(LANGUAGE_RULE)).toBe(true);
    for (const [n, body] of phase) if (n > 0) expect(body.startsWith(PHASE_LANGUAGE), `Phase ${n}`).toBe(true);
  });

  it('is told the language of the skill that follows its procedure', () => {
    const prd = flat(readFileSync(resolve(repoRoot, 'skills/excavator-prd/SKILL.md'), 'utf-8'));
    expect(prd).toContain('follow the procedure in `$PLUGIN_ROOT/skills/excavator-verify/SKILL.md` on it with `--fix`, `--language` set to `$LANGUAGE` and `PROJECT_ROOT` as the project path');
  });
});
