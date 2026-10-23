/**
 * The excavator-onboard skill is a prompt; its rules only hold if each one sits
 * where the model acts on it. These tests pin the language of everything the
 * skill writes to the user, where the guide goes and the reply that ends a run.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const skill = readFileSync(resolve(repoRoot, 'skills/excavator-onboard/SKILL.md'), 'utf-8');
const flat = (text) => text.replace(/\s+/g, ' ');

/** The language paragraph (the same words as /excavator-hotspots) and the option (whitespace flattened). */
const LANGUAGE_RULE = '**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file\'s rule to reply in another language is for work on the project\'s code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product\'s values stay as they are.';
const OPTION_LANGUAGE = '`--language <lang>` — the language of the guide and everything said to the user during the run; English when it is not given.';

/** Step 8: where the guide stays, the command that prints the reply, and what the reply may hold. */
const SAVE = "8. **Save and reply.** The guide stays in `.excavator/onboarding-guide.md`, Excavator's data directory: copy it to `docs/EXCAVATOR_ONBOARDING.md`, or a path the user gives, only when the user says so.";
const REPLY = "Then print the reply's lines with this command, putting in the guide's path:";
const REPLY_COMMAND = [
  '# the reply: where the guide is and the offer to save it',
  'printf \'%s\\n\' \\',
  '  "<the guide\'s path>" \\',
  '  "To save it in the project, say so: it goes to docs/EXCAVATOR_ONBOARDING.md unless you give another path. Commit it to share it with the team."',
].join('\n');
const REPLY_RULE = [
  "Reply with exactly the lines it prints and nothing else. Its first line, the guide's path, is the reply's first line and the offer to save its last: write nothing before, between or after them, no word on the guide or what was done, and no summary or notes.",
  "A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.",
  "In a language other than English, write the command's words translated; the path stays as it is.",
].join(' ');

/**
 * The problems with where a copy of the skill keeps its language rule: none when the options say only --language
 * changes the language, and the paragraph opens the instructions and stands again after the guide is written,
 * right before the command that prints the reply, word for word the same both times.
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
  const reply = steps.indexOf(REPLY);
  const rule = steps.lastIndexOf(LANGUAGE_RULE);
  if (rule < 0 || reply < rule || steps.slice(rule + LANGUAGE_RULE.length, reply).trim() !== '') {
    problems.push('the language paragraph does not stand right before the command that prints the reply');
  }
  if (rule >= 0 && rule < steps.indexOf('7. **Write the onboarding guide**')) problems.push('the second language paragraph comes before the guide is written');
  return problems;
}

describe('excavator-onboard skill: the language of what it writes', () => {
  it('names itself after its directory, takes --language and holds no Chinese character', () => {
    expect(skill.startsWith('---\nname: excavator-onboard\n')).toBe(true);
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

  it('opens the instructions and stands again right before the reply', () => {
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
    const byProject = '`--language <lang>` — the language of the guide; the project\'s own language when it is not given.';
    /** Each known-bad copy, and the problem that the check it was made for reports. */
    const bad = {
      noRule: [without(without(skill, paragraph), paragraph).replace(OPTION_LANGUAGE, byProject), 'the language paragraph is there 0 times, not twice'],
      notFirst: [without(skill, paragraph, '## Instructions'), 'the instructions do not open with the language paragraph'],
      ownSection: [without(without(skill, paragraph), paragraph).replace('## Instructions', `## Language\n\n${paragraph}## Instructions`), 'the instructions do not open with the language paragraph'],
      notBeforeReply: [without(skill, paragraph, '8. **Save and reply.**'), 'the language paragraph does not stand right before the command that prints the reply'],
      beforeGuide: [without(skill, paragraph, '8. **Save and reply.**').replace('7. **Write the onboarding guide**', `${paragraph}7. **Write the onboarding guide**`), 'the second language paragraph comes before the guide is written'],
      afterReply: [`${without(skill, paragraph, '8. **Save and reply.**')}\n${LANGUAGE_RULE}\n`, 'the language paragraph does not stand right before the command that prints the reply'],
      reworded: [skill.slice(0, skill.indexOf('8. **Save and reply.**')) + skill.slice(skill.indexOf('8. **Save and reply.**')).replace('memory and ', ''), '1 of 2 language paragraphs differ from the others'],
      byProject: [skill.replace(OPTION_LANGUAGE, byProject), 'the options do not say that only --language changes the language'],
    };
    for (const [name, [text, problem]] of Object.entries(bad)) expect(languageRuleProblems(text), name).toContain(problem);
  });

  it('writes the guide in $LANGUAGE', () => {
    expect(flat(skill)).toContain('7. **Write the onboarding guide** in `$LANGUAGE`, as clean markdown, to `.excavator/onboarding-guide.md` in the project, with these sections:');
  });
});

describe('excavator-onboard skill: the reply', () => {
  it('keeps the guide in the data directory and only offers to save it in the project', () => {
    expect(flat(skill)).toContain(SAVE);
    expect(skill).not.toContain('Offer to save the guide');
    expect(skill).not.toContain('Suggest the user commit it');
    expect(skill).not.toContain('Format as clean markdown');
  });

  it('ends with the command that prints the reply, and the reply is what it prints', () => {
    expect(skill.trimEnd().endsWith(`${REPLY_COMMAND}\n\`\`\`\n\n${REPLY_RULE}`)).toBe(true);
    expect(flat(skill)).toContain(`${SAVE} ${LANGUAGE_RULE} ${REPLY} \`\`\`bash`);
  });

  it('prints the two lines of the reply once its place is filled in', () => {
    const command = skill.match(/```bash\n(# the reply:[\s\S]*?)```/)[1].replace("<the guide's path>", '/work/shop/.excavator/onboarding-guide.md');
    const run = spawnSync('sh', ['-c', command], { encoding: 'utf-8' });
    expect(run.status).toBe(0);
    expect(run.stdout.split('\n').slice(0, -1)).toEqual([
      '/work/shop/.excavator/onboarding-guide.md',
      'To save it in the project, say so: it goes to docs/EXCAVATOR_ONBOARDING.md unless you give another path. Commit it to share it with the team.',
    ]);
  });

  it('opens a stale guide with the note it gives the user', () => {
    expect(flat(skill)).toContain('- `stale`: warn before generating the guide that onboarding content may omit recent changes, and open the guide with the same note.');
  });
});
