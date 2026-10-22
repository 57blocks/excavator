/**
 * The excavator-diff skill is a prompt; its rules only hold if each one sits
 * where the model acts on it. These tests pin the language of everything the
 * skill writes to the user and the shape of the analysis, which is the reply.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const skill = readFileSync(resolve(repoRoot, 'skills/excavator-diff/SKILL.md'), 'utf-8');
const flat = (text) => text.replace(/\s+/g, ' ');

/** The language paragraph (the same words as /excavator-hotspots) and the option (whitespace flattened). */
const LANGUAGE_RULE = '**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file\'s rule to reply in another language is for work on the project\'s code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product\'s values stay as they are.';
const OPTION_LANGUAGE = '`--language <lang>` — the language of the analysis and everything said to the user during the run; English when it is not given.';

/** Step 7: the analysis is the reply, under five fixed headings. */
const ANALYSIS = '7. **Write the analysis.** The analysis is the reply. Write it in `$LANGUAGE` under these five `##` headings, in this order:';
const HEADINGS = ['Changed Components', 'Affected Components', 'Affected Layers', 'Risk Assessment', 'Review Focus'];
const ANALYSIS_RULE = [
  'Write nothing before the first heading or after the last section\'s text.',
  'In a language other than English, write the headings translated; code identifiers and paths stay as they are.',
  'A project file\'s rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.',
].join(' ');
const STEP6 = '6. **Identify affected layers**';

/**
 * The problems with where a copy of the skill keeps its language rule: none when the options say only --language
 * changes the language, and the paragraph opens the instructions and stands again right before step 7, word for
 * word the same both times.
 */
function languageRuleProblems(text) {
  const problems = [];
  const head = flat(text.split(/^## Instructions$/m)[0]);
  const steps = flat(text.split(/^## Instructions$/m)[1] ?? '').trim();
  if (!head.includes(OPTION_LANGUAGE)) problems.push('the options do not say that only --language changes the language');
  const copies = flat(text).split(LANGUAGE_RULE).length - 1;
  const started = flat(text).split('**Language.**').length - 1;
  if (copies !== started) problems.push(`${started - copies} of ${started} language paragraphs differ from the others`);
  if (copies !== 2) problems.push(`the language paragraph is there ${copies} times, not twice`);
  if (!steps.startsWith(LANGUAGE_RULE)) problems.push('the instructions do not open with the language paragraph');
  const analysis = steps.indexOf('7. **Write the analysis.**');
  const rule = steps.lastIndexOf(LANGUAGE_RULE);
  if (rule < 0 || analysis < rule || steps.slice(rule + LANGUAGE_RULE.length, analysis).trim() !== '') {
    problems.push('the language paragraph does not stand right before step 7');
  }
  if (rule >= 0 && rule < steps.indexOf(STEP6)) problems.push('the second language paragraph comes before step 6');
  return problems;
}

describe('excavator-diff skill: the language of what it writes', () => {
  it('names itself after its directory, takes --language and holds no Chinese character', () => {
    expect(skill.startsWith('---\nname: excavator-diff\n')).toBe(true);
    expect(skill).toContain('argument-hint: "[--language <lang>]"');
    expect(skill).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/u);
  });

  it('is the paragraph /excavator-hotspots holds, word for word', () => {
    const hotspots = readFileSync(resolve(repoRoot, 'skills/excavator-hotspots/SKILL.md'), 'utf-8');
    expect(flat(hotspots)).toContain(LANGUAGE_RULE);
  });

  it('sets $LANGUAGE where it resolves the project root', () => {
    expect(skill).toContain('PROJECT_ROOT="$(pwd)"\n     LANGUAGE="English"   # or the --language value\n');
  });

  it('opens the instructions and stands again right before the analysis', () => {
    expect(languageRuleProblems(skill)).toEqual([]);
  });

  it('finds the rule out of place in known-bad copies of the skill', () => {
    /** The skill with `part` taken out at its first place at or after `from`. */
    const without = (text, part, from = '') => {
      const at = text.indexOf(part, text.indexOf(from));
      expect(at, part).toBeGreaterThan(-1);
      return text.slice(0, at) + text.slice(at + part.length);
    };
    const paragraph = `${LANGUAGE_RULE}\n\n`;
    const byProject = '`--language <lang>` — the language of the analysis; the project\'s own language when it is not given.';
    const bad = {
      noRule: without(without(skill, paragraph), paragraph).replace(OPTION_LANGUAGE, byProject),
      notFirst: without(skill, paragraph, '## Instructions'),
      ownSection: without(without(skill, paragraph), paragraph).replace('## Instructions', `## Language\n\n${paragraph}## Instructions`),
      notBeforeStep7: without(skill, paragraph, STEP6),
      beforeStep6: without(skill, paragraph, STEP6).replace(STEP6, `${paragraph}${STEP6}`),
      afterStep7: `${without(skill, paragraph, STEP6)}\n${LANGUAGE_RULE}\n`,
      reworded: skill.slice(0, skill.indexOf(STEP6)) + skill.slice(skill.indexOf(STEP6)).replace('memory and ', ''),
      byProject: skill.replace(OPTION_LANGUAGE, byProject),
    };
    for (const [name, text] of Object.entries(bad)) expect(languageRuleProblems(text), name).not.toEqual([]);
  });
});

describe('excavator-diff skill: the analysis is the reply', () => {
  const step7 = skill.slice(skill.indexOf('7. **Write the analysis.**'));

  it('ends with step 7: the five headings in order, then what the reply may hold', () => {
    expect(flat(step7)).toContain(ANALYSIS);
    const listed = [...step7.matchAll(/^ {3}- \*\*(.+?)\*\*:/gm)].map((m) => m[1]);
    expect(listed).toEqual(HEADINGS);
    expect(flat(skill).trimEnd().endsWith(ANALYSIS_RULE)).toBe(true);
  });

  it('puts the stale and missing notes inside the analysis, not before it', () => {
    expect(flat(skill)).toContain('- `stale`: the analysis says, as the first line under its first heading, that the graph may omit recent changes, and suggests running `/excavator` to refresh the graph.');
    expect(flat(skill)).toContain('- `missing` (no `source-manifest.json` yet): the analysis gives a brief best-effort note in the same place; continue instead of blocking.');
    expect(skill).not.toContain('warn before impact analysis');
  });
});
