/**
 * The excavator-explain skill is a prompt; its rules only hold if each one sits
 * where the model acts on it. These tests pin the language of everything the
 * skill writes to the user and the shape of the explanation, which is the reply.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const skill = readFileSync(resolve(repoRoot, 'skills/excavator-explain/SKILL.md'), 'utf-8');
const flat = (text) => text.replace(/\s+/g, ' ');

/** The language paragraph (the same words as /excavator-hotspots) and the option (whitespace flattened). */
const LANGUAGE_RULE = '**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file\'s rule to reply in another language is for work on the project\'s code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product\'s values stay as they are.';
const OPTION_LANGUAGE = '`$ARGUMENTS` holds the component to explain and may hold `--language <lang>`: the language of the explanation and everything said to the user during the run; English when it is not given.';

/** Step 8: the explanation is the reply, under five fixed headings. */
const EXPLAIN = '8. **Explain the component in context.** The explanation is the reply. Write it in `$LANGUAGE` under these five `##` headings, in this order:';
const HEADINGS = ['Role', 'Internal Structure', 'External Connections', 'Data Flow', 'Worth Knowing'];
const EXPLAIN_RULE = [
  'Explain clearly, assuming the reader may not know the programming language.',
  'Write nothing before the first heading or after the last section\'s text.',
  'In a language other than English, write the headings translated; code identifiers and paths stay as they are.',
  'A project file\'s rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.',
].join(' ');

/**
 * The problems with where a copy of the skill keeps its language rule: none when the options say only --language
 * changes the language, and the paragraph opens the instructions and stands again right before step 8, word for
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
  const explain = steps.indexOf('8. **Explain the component in context.**');
  const rule = steps.lastIndexOf(LANGUAGE_RULE);
  if (rule < 0 || explain < rule || steps.slice(rule + LANGUAGE_RULE.length, explain).trim() !== '') {
    problems.push('the language paragraph does not stand right before step 8');
  }
  if (rule >= 0 && rule < steps.indexOf('7. **Read the actual source file**')) problems.push('the second language paragraph comes before step 7');
  return problems;
}

describe('excavator-explain skill: the language of what it writes', () => {
  it('names itself after its directory, takes --language and holds no Chinese character', () => {
    expect(skill.startsWith('---\nname: excavator-explain\n')).toBe(true);
    expect(skill).toContain('argument-hint: "[file-path] [--language <lang>]"');
    expect(skill).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/u);
  });

  it('is the paragraph /excavator-hotspots holds, word for word', () => {
    const hotspots = readFileSync(resolve(repoRoot, 'skills/excavator-hotspots/SKILL.md'), 'utf-8');
    expect(flat(hotspots)).toContain(LANGUAGE_RULE);
  });

  it('sets $LANGUAGE where it resolves the project root, and searches for the component without the option', () => {
    expect(skill).toContain('PROJECT_ROOT="$(pwd)"\n     LANGUAGE="English"   # or the --language value\n');
    expect(skill).toContain('3. **Find the target node** — use Grep to search the knowledge graph for the component named in `$ARGUMENTS` (without `--language` and its value)');
  });

  it('opens the instructions and stands again right before the explanation', () => {
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
    const byProject = '`$ARGUMENTS` holds the component to explain and may hold `--language <lang>`: the language of the explanation; the project\'s own language when it is not given.';
    const bad = {
      noRule: without(without(skill, paragraph), paragraph).replace(OPTION_LANGUAGE, byProject),
      notFirst: without(skill, paragraph, '## Instructions'),
      ownSection: without(without(skill, paragraph), paragraph).replace('## Instructions', `## Language\n\n${paragraph}## Instructions`),
      notBeforeStep8: without(skill, paragraph, '7. **Read the actual source file**'),
      beforeStep7: without(skill, paragraph, '7. **Read the actual source file**').replace('7. **Read the actual source file**', `${paragraph}7. **Read the actual source file**`),
      afterStep8: `${without(skill, paragraph, '7. **Read the actual source file**')}\n${LANGUAGE_RULE}\n`,
      reworded: skill.slice(0, skill.indexOf('7. **Read the actual source file**')) + skill.slice(skill.indexOf('7. **Read the actual source file**')).replace('memory and ', ''),
      byProject: skill.replace(OPTION_LANGUAGE, byProject),
    };
    for (const [name, text] of Object.entries(bad)) expect(languageRuleProblems(text), name).not.toEqual([]);
  });
});

describe('excavator-explain skill: the explanation is the reply', () => {
  const step8 = skill.slice(skill.indexOf('8. **Explain the component in context.**'));

  it('ends with step 8: the five headings in order, then what the reply may hold', () => {
    expect(flat(step8)).toContain(EXPLAIN);
    const listed = [...step8.matchAll(/^ {3}- \*\*(.+?)\*\*:/gm)].map((m) => m[1]);
    expect(listed).toEqual(HEADINGS);
    expect(flat(skill).trimEnd().endsWith(EXPLAIN_RULE)).toBe(true);
  });

  it('puts the stale and missing notes inside the explanation, not before it', () => {
    expect(flat(skill)).toContain('- `stale`: the explanation says, as the first line under its first heading, that graph-derived context may omit recent changes, and suggests running `/excavator` to refresh the graph.');
    expect(flat(skill)).toContain('- `missing` (no `source-manifest.json` yet): the explanation gives a brief best-effort note in the same place; continue instead of blocking.');
    expect(skill).not.toContain('warn before explaining');
  });
});
