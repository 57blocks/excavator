/**
 * The excavator-verify skill is a prompt; its rules only hold if each one sits in
 * the phase where the model acts on it. These tests pin the language of the
 * report and of everything the skill writes to the user, and keep the
 * document's own language for what is quoted from it or written into it.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
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
  it('has the seven phases in order', () => {
    expect([...phase.keys()]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const titles = [...skill.matchAll(/^## Phase \d+ — (.+)$/gm)].map((m) => m[1]);
    expect(titles).toEqual([
      'Setup',
      'Dispatch section verifiers in parallel',
      'Cross-section consistency',
      'Report',
      'Self-check',
      'Fix (only with `--fix`)',
      'Reply',
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
    expect(skill).toContain('argument-hint: "<document> [project-path] [--fix] [--no-summary] [--report <path>] [--language <lang>]"');
    expect(phase.get(0)).toContain('1. Resolve `DOC` and `PROJECT_ROOT`, and parse `--fix`, `--no-summary`, `--report` and `--language` (`$LANGUAGE`: English when it is not given).');
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

  it('opens Phase 0 and stands again right before the reply, and every later phase points back to it', () => {
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
    const line = `${PHASE_LANGUAGE}\n\n`;
    const followsDocument = "`--language <lang>` — the language of the report; the document's language when it is not given.";
    const noRule = [...Array(6)].reduce((text) => without(text, line), without(without(skill, paragraph), paragraph)).replace(OPTION_LANGUAGE, followsDocument);
    /** Each known-bad copy, and the problem that the check it was made for reports. */
    const bad = {
      noRule: [noRule, 'the language paragraph is there 0 times, not twice'],
      noPhaseZero: [without(skill, paragraph, '## Phase 0 — '), 'Phase 0 does not open with the language paragraph'],
      ownSection: [without(without(skill, paragraph), paragraph).replace('---\n\n## Phase 0 — ', `## Language\n\n${paragraph}---\n\n## Phase 0 — `), 'Phase 0 does not open with the language paragraph'],
      noPhaseTwo: [without(skill, line, '## Phase 2 — '), 'Phase 2 does not open with the language line'],
      inFix: [without(skill, paragraph, '## Phase 6 — ').replace('Edit `DOC` in place', `${paragraph}Edit \`DOC\` in place`), 'the language paragraph does not stand right before the command that prints the reply'],
      afterReply: [`${without(skill, paragraph, '## Phase 6 — ')}\n${LANGUAGE_RULE}\n`, 'the language paragraph does not stand right before the command that prints the reply'],
      beforeSkip: [without(skill, paragraph, '## Phase 6 — ').replace(`${SKIP}\n\n`, `${paragraph}${SKIP}\n\n`), 'Phase 6 does not say when to skip it before the language paragraph'],
      reworded: [skill.slice(0, skill.indexOf('## Phase 6 — ')) + skill.slice(skill.indexOf('## Phase 6 — ')).replace('memory and ', ''), '1 of 2 language paragraphs differ from the others'],
      followsDocument: [skill.replace(OPTION_LANGUAGE, followsDocument), 'the options do not say that only --language changes the language'],
    };
    for (const [name, [text, problem]] of Object.entries(bad)) expect(languageRuleProblems(text), name).toContain(problem);
  });

  it('is told the language of the skill that follows its procedure', () => {
    const prd = flat(readFileSync(resolve(repoRoot, 'skills/excavator-prd/SKILL.md'), 'utf-8'));
    expect(prd).toContain('follow the procedure in `$PLUGIN_ROOT/skills/excavator-verify/SKILL.md` on it with `--fix`, `--language` set to `$LANGUAGE` and `PROJECT_ROOT` as the project path');
  });
});

/** Phase 6: when it is skipped, the command that prints the reply, and what the reply may hold. */
const SKIP = 'When you follow this procedure for another skill (for example `excavator-prd`), skip this phase: that skill says what to report.';
const REPLY = 'Then print the reply\'s lines with this command';
const REPLY_COMMAND = [
  '# the reply: where the report is, the counts by verdict and, with --fix, the corrections applied',
  'printf \'%s\\n\' \\',
  '  "<the report\'s path>" \\',
  '  "Statements: <V> verified, <X> contradicted, <Y> misattributed, <U> unverifiable" \\',
  '  "Open items: <RR> resolved right, <RW> resolved wrong, <S> still open" \\',
  '  "Cross-section conflicts: <C>; not checked: <K>" \\',
  '  "Corrections applied: <A> of <B>, in <the document\'s path>"',
].join('\n');
const REPLY_RULE = [
  'Reply with exactly the lines it prints and nothing else. Its first line, the report\'s path, is the reply\'s first line: write nothing before, between or after the lines, no word on the errors, the document or what was done, and no summary or notes; the errors are listed in the report.',
  'A project file\'s rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.',
  'In a language other than English, write the command\'s words translated; the paths and the numbers stay as they are.',
  'Without `--fix`, leave the last line out.',
].join(' ');
const FIX = 'Then add a section **Fix** at the end of the report: of the entries that carry a correction (contradicted, misattributed, resolved-right, resolved-wrong and conflict), how many there are and how many you applied, and each one you could not apply with the reason.';

/**
 * The problems with where a copy of the skill keeps its language rule: none when the paragraph opens Phase 0 and
 * stands again in Phase 6 after the line on when to skip it and right before the command that prints the reply, word
 * for word the same, every later phase opens with the line that points back to it, and the options say only
 * --language changes the language.
 */
function languageRuleProblems(text) {
  const problems = [];
  const [head, ...parts] = text.split(/^## Phase \d+ — /m);
  const bodies = parts.map((part) => flat(part.slice(part.indexOf('\n') + 1)).trim());
  if (!flat(head).includes(OPTION_LANGUAGE)) problems.push('the options do not say that only --language changes the language');
  const copies = flat(text).split(LANGUAGE_RULE).length - 1;
  const started = flat(text).split('**Language.**').length - 1;
  if (copies !== started) problems.push(`${started - copies} of ${started} language paragraphs differ from the others`);
  if (copies !== 2) problems.push(`the language paragraph is there ${copies} times, not twice`);
  if (!bodies[0]?.startsWith(LANGUAGE_RULE)) problems.push('Phase 0 does not open with the language paragraph');
  bodies.slice(1).forEach((body, at) => {
    if (!body.startsWith(PHASE_LANGUAGE)) problems.push(`Phase ${at + 1} does not open with the language line`);
  });
  const last = bodies[6] ?? '';
  const reply = last.indexOf(REPLY);
  const rule = last.lastIndexOf(LANGUAGE_RULE);
  if (rule < 0 || reply < rule || last.slice(rule + LANGUAGE_RULE.length, reply).trim() !== '') {
    problems.push('the language paragraph does not stand right before the command that prints the reply');
  }
  if (!last.startsWith(`${PHASE_LANGUAGE} ${SKIP} ${LANGUAGE_RULE}`)) problems.push('Phase 6 does not say when to skip it before the language paragraph');
  return problems;
}

describe('excavator-verify skill: --no-summary', () => {
  const options = flat(skill.split(/^## Phase 0 — /m)[0]);

  it('is an argument of the skill, named wherever the arguments are listed and parsed', () => {
    expect(skill).toContain('--no-summary]');
    expect(options).toContain('`--no-summary` — with `--fix`, do not append the verification summary to the document; the counts stay in the report. Without `--fix` it has no effect.');
    expect(phase.get(0)).toContain('parse `--fix`, `--no-summary`, `--report` and `--language`');
    expect(phase.get(0)).not.toContain('parse `--fix`, `--report`');
  });

  it('skips the append step under it, and the report keeps its counts', () => {
    const fix = phase.get(5);
    expect(fix).toContain('Then, unless `--no-summary` was given, append a short section at the end of `DOC`');
    expect(fix).toContain('With `--no-summary` append nothing to `DOC` after the corrections: the counts are in the report only.');
    expect(fix).not.toContain('Then append a short section');
    expect(phase.get(3)).toContain('**Counts** — a table of class × verdict');
  });

  it('has no effect without --fix', () => {
    expect(options).toContain('Without `--fix` it has no effect.');
    expect(skill).toContain('## Phase 5 — Fix (only with `--fix`)');
  });

  it('leaves the reply as it was: its last line says corrections were applied, not that a summary was', () => {
    expect(phase.get(6)).toContain('"Corrections applied: <A> of <B>, in <the document\'s path>"');
    expect(phase.get(6)).not.toMatch(/summary section|verification summary/i);
  });
});

describe('excavator-verify skill: the reply', () => {
  it('ends with the command that prints the reply, and the reply is what it prints', () => {
    expect(skill.trimEnd().endsWith(`${REPLY_COMMAND}\n\`\`\`\n\n${REPLY_RULE}`)).toBe(true);
    expect(phase.get(6)).toContain(`${LANGUAGE_RULE} ${REPLY}, putting in the report's path, the numbers in the report's table and, with \`--fix\`, the two numbers its Fix section gives and the document's path, each number as the report has it and none added up: \`\`\`bash`);
  });

  it('keeps the errors and what --fix applied in the report, not in a message of its own', () => {
    expect(skill).not.toContain('In the final message');
    expect(skill).not.toContain('Report how many entries were applied');
    expect(phase.get(5).endsWith(FIX)).toBe(true);
  });

  it('prints the five lines of the reply once its places are filled in', () => {
    const command = skill.match(/```bash\n(# the reply:[\s\S]*?)```/)[1]
      .replace("<the report's path>", '/tmp/docs/PRD.verification.md')
      .replace("<the document's path>", '/tmp/docs/PRD.md')
      .replace(/<[A-Z]+>/g, '2');
    const run = spawnSync('sh', ['-c', command], { encoding: 'utf-8' });
    expect(run.status).toBe(0);
    expect(run.stdout.split('\n').slice(0, -1)).toEqual([
      '/tmp/docs/PRD.verification.md',
      'Statements: 2 verified, 2 contradicted, 2 misattributed, 2 unverifiable',
      'Open items: 2 resolved right, 2 resolved wrong, 2 still open',
      'Cross-section conflicts: 2; not checked: 2',
      'Corrections applied: 2 of 2, in /tmp/docs/PRD.md',
    ]);
  });
});
