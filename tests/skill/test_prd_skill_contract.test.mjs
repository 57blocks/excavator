/**
 * The excavator-prd skill is a prompt; its rules only hold if each one sits in
 * the phase where the model acts on it. These tests pin the language of
 * everything the skill writes to the user to the phases that write it.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
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
    const byCodebase = "`--language <lang>` — output language of the PRD (default: match the codebase's primary human language / the user's request).";
    const noRule = [...Array(4)].reduce((text) => without(text, line), without(without(skill, paragraph), paragraph)).replace(OPTION_LANGUAGE, byCodebase);
    const bad = {
      noRule,
      noPhaseZero: without(skill, paragraph, '## Phase 0 — '),
      ownSection: without(without(skill, paragraph), paragraph).replace('---\n\n## Phase 0 — ', `## Language\n\n${paragraph}---\n\n## Phase 0 — `),
      noPhaseTwo: without(skill, line, '## Phase 2 — '),
      afterReply: `${without(skill, paragraph, '## Phase 4 — ')}\n${LANGUAGE_RULE}\n`,
      beforeVerification: without(skill, paragraph, '## Phase 4 — ').replace('5. **Verification', `${paragraph}5. **Verification`),
      reworded: skill.slice(0, skill.indexOf('## Phase 4 — ')) + skill.slice(skill.indexOf('## Phase 4 — ')).replace('memory and ', ''),
      byCodebase: skill.replace(OPTION_LANGUAGE, byCodebase),
    };
    for (const [name, text] of Object.entries(bad)) expect(languageRuleProblems(text), name).not.toEqual([]);
  });
});

/** Step 6 of Phase 4: where the PRD stays, the command that prints the reply, and what the reply may hold. */
const SAVE = 'The PRD stays where step 5 wrote it: write it into the project only when the user says so, to `docs/PRD.md` (a scoped PRD: `docs/PRD-<scope>.md`) or a path the user gives.';
const REPLY = 'Then print the reply\'s lines with this command';
const REPLY_COMMAND = [
  '# the reply: where the PRD is, the counts of the checks and the offer to save it',
  'printf \'%s\\n\' \\',
  '  "<the PRD\'s path>" \\',
  '  "<N>/<N> flows covered" \\',
  '  "<N> diagrams" \\',
  '  "<N> terms; 0 translated-variant leaks" \\',
  '  "<N> checked; contradicted <X>, misattributed <Y>; open items resolved <R> (guess wrong <W>), still open <S>" \\',
  '  "To save it in the project, say so: it goes to <default path> unless you give another path. Commit it to share it with the team."',
].join('\n');
const REPLY_RULE = [
  'Reply with exactly the lines it prints and nothing else. Its first line, the PRD\'s path, is the reply\'s first line and the offer to save its last: write nothing before, between or after them, no word on the checks, the PRD or what was done, and no summary or notes.',
  'A project file\'s rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.',
  'In a language other than English, write the command\'s words translated; the path and the numbers stay as they are.',
  'When the PRD is already at a path the user gave, leave the last line out.',
].join(' ');

/**
 * The problems with where a copy of the skill keeps its language rule: none when the paragraph opens Phase 0 and
 * stands again in Phase 4 after the verification and right before the command that prints the reply, word for word
 * the same, every later phase opens with the line that points back to it, and the options say only --language
 * changes the language.
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
  const last = bodies[4] ?? '';
  const reply = last.indexOf(REPLY);
  const rule = last.lastIndexOf(LANGUAGE_RULE);
  if (rule < 0 || reply < rule || last.slice(rule + LANGUAGE_RULE.length, reply).trim() !== '') {
    problems.push('the language paragraph does not stand right before the command that prints the reply');
  }
  if (rule >= 0 && rule < last.indexOf('5. **Verification')) problems.push('the language paragraph of Phase 4 comes before the verification');
  return problems;
}

describe('excavator-prd skill: the reply', () => {
  const save = skill.slice(skill.indexOf('6. **Save and reply.**'));

  it('keeps the PRD where step 5 wrote it and only offers to save it in the project', () => {
    expect(flat(save)).toContain(`6. **Save and reply.** ${SAVE}`);
    expect(skill).not.toContain('Offer to write the PRD to the project');
    expect(skill).not.toContain('Suggest committing it for the team');
  });

  it('ends with the command that prints the reply, and the reply is what it prints', () => {
    expect(skill.trimEnd().endsWith(`${REPLY_COMMAND}\n\`\`\`\n\n${REPLY_RULE}`)).toBe(true);
    expect(flat(save)).toContain(`${LANGUAGE_RULE} ${REPLY}, putting in the PRD's path, the counts steps 1, 2, 4 and 5 report, and the default path: \`\`\`bash`);
  });

  it('names the counts in the forms the checks report them', () => {
    const checks = flat(skill.slice(skill.indexOf('## Phase 4 — '), skill.indexOf('6. **Save and reply.**')));
    expect(checks).toContain('Report the count: `N/N flows covered`.');
    expect(checks).toContain('Report the count: `N diagrams`.');
    expect(checks).toContain('Report: `N terms; 0 translated-variant leaks`.');
    expect(checks).toContain('Report its counts: `N checked; contradicted X, misattributed Y; open items resolved R (guess wrong W), still open S`.');
  });

  it('prints the six lines of the reply once its places are filled in', () => {
    const command = skill.match(/```bash\n(# the reply:[\s\S]*?)```/)[1]
      .replace("<the PRD's path>", '/tmp/drafts/PRD-orders.md')
      .replace('<default path>', 'docs/PRD-orders.md')
      .replace(/<[A-Z]>/g, '2');
    const run = spawnSync('sh', ['-c', command], { encoding: 'utf-8' });
    expect(run.status).toBe(0);
    expect(run.stdout.split('\n').slice(0, -1)).toEqual([
      '/tmp/drafts/PRD-orders.md',
      '2/2 flows covered',
      '2 diagrams',
      '2 terms; 0 translated-variant leaks',
      '2 checked; contradicted 2, misattributed 2; open items resolved 2 (guess wrong 2), still open 2',
      'To save it in the project, say so: it goes to docs/PRD-orders.md unless you give another path. Commit it to share it with the team.',
    ]);
  });
});
