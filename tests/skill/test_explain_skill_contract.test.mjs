/**
 * The excavator-explain skill is a prompt; its rules only hold if each one sits
 * where the model acts on it. These tests pin the language of everything the
 * skill writes to the user, the shape of the explanation, and the reply the last command prints.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const skill = readFileSync(resolve(repoRoot, 'skills/excavator-explain/SKILL.md'), 'utf-8');
const flat = (text) => text.replace(/\s+/g, ' ');

/** The language paragraph (the same words as /excavator-hotspots) and the option (whitespace flattened). */
const LANGUAGE_RULE = '**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file\'s rule to reply in another language is for work on the project\'s code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product\'s values stay as they are.';
const OPTION_LANGUAGE = '`$ARGUMENTS` holds the component to explain and may hold `--language <lang>`: the language of the explanation and everything said to the user during the run; English when it is not given.';

/**
 * Step 8 writes the explanation under five fixed headings to a file of this run's own, whose path a command prints;
 * step 9 prints that file and nothing else, and the reply is what it prints.
 */
const EXPLAIN = '8. **Write the explanation** in `$LANGUAGE`, as markdown, to a file of this run\'s own: the path this command prints, run from the project root.';
const UNDER_HEADINGS = 'Write it under these five `##` headings, in this order:';
const HEADINGS = ['Role', 'Internal Structure', 'External Connections', 'Data Flow', 'Worth Knowing'];
const EXPLAIN_RULE = [
  'Explain clearly, assuming the reader may not know the programming language.',
  'The file starts with the first heading and ends with the last section\'s text.',
  'It is at most 25,000 bytes: step 9 prints it whole as the reply, and hosts cut longer command output (Claude Code past 30,000 characters by default).',
  'In a language other than English, write the headings translated; code identifiers and paths stay as they are.',
].join(' ');
const REPLY = '9. **Reply.** Print the explanation with this command, run from the project root, putting in the path step 8 printed:';
const REPLY_FAILS = [
  'It prints the file, then keeps it as `.excavator/explanation.md` in place of any earlier one.',
  'When the file does not exist or is longer than 25,000 bytes, it prints nothing and fails: write the explanation to that path, or shorten it, and run the command again.',
  'Never print another file in its place.',
].join(' ');
const REPLY_RULE = [
  'Reply with exactly the lines it prints and nothing else: write nothing before or after them, no word on what was done, and no summary or notes.',
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
  const explain = steps.indexOf('8. **Write the explanation**');
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
    /** Each known-bad copy, and the problem that the check it was made for reports. */
    const bad = {
      noRule: [without(without(skill, paragraph), paragraph).replace(OPTION_LANGUAGE, byProject), 'the language paragraph is there 0 times, not twice'],
      notFirst: [without(skill, paragraph, '## Instructions'), 'the instructions do not open with the language paragraph'],
      ownSection: [without(without(skill, paragraph), paragraph).replace('## Instructions', `## Language\n\n${paragraph}## Instructions`), 'the instructions do not open with the language paragraph'],
      notBeforeStep8: [without(skill, paragraph, '7. **Read the actual source file**'), 'the language paragraph does not stand right before step 8'],
      beforeStep7: [without(skill, paragraph, '7. **Read the actual source file**').replace('7. **Read the actual source file**', `${paragraph}7. **Read the actual source file**`), 'the second language paragraph comes before step 7'],
      afterStep8: [`${without(skill, paragraph, '7. **Read the actual source file**')}\n${LANGUAGE_RULE}\n`, 'the language paragraph does not stand right before step 8'],
      reworded: [skill.slice(0, skill.indexOf('7. **Read the actual source file**')) + skill.slice(skill.indexOf('7. **Read the actual source file**')).replace('memory and ', ''), '1 of 2 language paragraphs differ from the others'],
      byProject: [skill.replace(OPTION_LANGUAGE, byProject), 'the options do not say that only --language changes the language'],
    };
    for (const [name, [text, problem]] of Object.entries(bad)) expect(languageRuleProblems(text), name).toContain(problem);
  });
});

describe('excavator-explain skill: the reply is the explanation the last command prints', () => {
  const step8 = skill.slice(skill.indexOf('8. **Write the explanation**'), skill.indexOf('9. **Reply.**'));
  const step9 = skill.slice(skill.indexOf('9. **Reply.**'));
  const runFile = step8.match(/```bash\n {3}(# this run's file for the explanation\n[\s\S]*?)\n {3}```/)[1];
  const reply = step9.match(/```bash\n {3}(# the reply:[\s\S]*?)\n {3}```/)[1];
  /** The reply command with the path step 8 printed put in. */
  const replyFor = (path) => reply.replace('<the path step 8 printed>', path);
  const sh = (command, cwd, env = process.env) => spawnSync('sh', ['-c', command], { cwd, env, encoding: 'utf-8' });
  /** Run `use` in a new project with an empty data directory, then remove the project. */
  const inProject = (use) => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'explain-reply-')));
    try {
      mkdirSync(join(project, '.excavator'));
      use(project, join(project, '.excavator'));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  };

  it('writes the explanation to a file of its own under the five headings, in order', () => {
    expect(flat(step8)).toContain(EXPLAIN);
    expect(flat(step8)).toContain(UNDER_HEADINGS);
    const listed = [...step8.matchAll(/^ {3}- \*\*(.+?)\*\*:/gm)].map((m) => m[1]);
    expect(listed).toEqual(HEADINGS);
    expect(flat(step8)).toContain(EXPLAIN_RULE);
  });

  it('ends with step 9: the command that prints the file, what it does when the file is not there, then what the reply may hold', () => {
    expect(flat(step9).startsWith(REPLY)).toBe(true);
    expect(flat(step9)).toContain(REPLY_FAILS);
    expect(flat(skill).trimEnd().endsWith(REPLY_RULE)).toBe(true);
  });

  it('prints a new path in the data directory for each run, two runs in the same second included', () => {
    inProject((project, data) => {
      const run = sh(runFile, project);
      expect(run.status).toBe(0);
      expect(run.stdout.startsWith(`${data}/explanation-`)).toBe(true);
      expect(run.stdout.slice(data.length)).toMatch(/^\/explanation-\d{8}T\d{6}Z-\d+\.md\n$/);
      // A date that always prints the same moment: the two runs still get two paths.
      const bin = join(project, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'date'), '#!/bin/sh\necho 20261022T000000Z\n', { mode: 0o755 });
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
      const [first, second] = [sh(runFile, project, env).stdout, sh(runFile, project, env).stdout];
      expect(first).toContain('/explanation-20261022T000000Z-');
      expect(second).toContain('/explanation-20261022T000000Z-');
      expect(first).not.toBe(second);
    });
  });

  it('prints this run\'s file line for line, then keeps it as explanation.md', () => {
    inProject((project, data) => {
      const text = '## Role\n\nA facade.\n\n## Worth Knowing\n\nStatic fields.\n';
      const path = join(data, 'explanation-20261022T000000Z-101.md');
      writeFileSync(path, text);
      const run = sh(replyFor(path), project);
      expect(run.status).toBe(0);
      expect(run.stdout).toBe(text);
      expect(readFileSync(join(data, 'explanation.md'), 'utf-8')).toBe(text);
      expect(existsSync(path)).toBe(false);
    });
  });

  it('fails and prints nothing when this run\'s file was not written, whatever earlier explanations there are', () => {
    inProject((project, data) => {
      const earlier = '## Role\n\nAn earlier component.\n';
      writeFileSync(join(data, 'explanation.md'), earlier);
      writeFileSync(join(data, 'explanation-20261022T000000Z-101.md'), '## Role\n\nAnother run\'s component.\n');
      const path = join(data, 'explanation-20261022T000000Z-102.md');
      const run = sh(replyFor(path), project);
      expect(run.status).not.toBe(0);
      expect(run.stdout).toBe('');
      expect(run.stderr).toContain(`${path} does not exist`);
      expect(readFileSync(join(data, 'explanation.md'), 'utf-8')).toBe(earlier);
      const unfilled = sh(reply, project);
      expect(unfilled.status).not.toBe(0);
      expect(unfilled.stdout).toBe('');
    });
  });

  it('prints a file of 25,000 bytes and refuses one longer, which hosts would cut', () => {
    inProject((project, data) => {
      const heading = '## Role\n\n';
      const sized = (bytes) => `${heading}${'x'.repeat(bytes - heading.length - 1)}\n`;
      const fits = join(data, 'explanation-20261022T000000Z-101.md');
      writeFileSync(fits, sized(25000));
      const printed = sh(replyFor(fits), project);
      expect(printed.status).toBe(0);
      expect(printed.stdout).toBe(sized(25000));
      const long = join(data, 'explanation-20261022T000000Z-102.md');
      writeFileSync(long, sized(25001));
      const refused = sh(replyFor(long), project);
      expect(refused.status).not.toBe(0);
      expect(refused.stdout).toBe('');
      expect(refused.stderr).toContain(`${long} is longer than 25000 bytes`);
      expect(readFileSync(long, 'utf-8')).toBe(sized(25001));
      expect(readFileSync(join(data, 'explanation.md'), 'utf-8')).toBe(sized(25000));
    });
  });

  it('prints each of two overlapping runs its own file', () => {
    inProject((project, data) => {
      const [first, second] = ['101', '102'].map((pid) => join(data, `explanation-20261022T000000Z-${pid}.md`));
      writeFileSync(first, '## Role\n\nThe first run\'s component.\n');
      writeFileSync(second, '## Role\n\nThe second run\'s component.\n');
      expect(sh(replyFor(first), project).stdout).toBe('## Role\n\nThe first run\'s component.\n');
      expect(sh(replyFor(second), project).stdout).toBe('## Role\n\nThe second run\'s component.\n');
      expect(readFileSync(join(data, 'explanation.md'), 'utf-8')).toBe('## Role\n\nThe second run\'s component.\n');
    });
  });

  it('puts the stale and missing notes inside the explanation, not before it', () => {
    expect(flat(skill)).toContain('- `stale`: the explanation says, as the first line under its first heading, that graph-derived context may omit recent changes. Suggest: Run `/excavator` to refresh the graph.');
    expect(flat(skill)).toContain('- `missing` (no `source-manifest.json` yet): the explanation gives a brief best-effort note in the same place; continue instead of blocking.');
    expect(skill).not.toContain('warn before explaining');
  });
});
