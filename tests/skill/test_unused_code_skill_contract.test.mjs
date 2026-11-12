/**
 * The excavator-unused-code skill is a prompt; its rules only hold if each one
 * sits in the step where the model makes that decision. A rule stated once at
 * the top is skipped under pressure, so these tests pin every rule to its step
 * and check the signal names the skill explains exist in the script. A rule the
 * decision script enforces is run: the script is taken from the skill as written.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

  it('holds no Chinese character', () => {
    expect(skill).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/u);
  });

  it('writes the report, the reasons and every line to the user in English unless --language names another language', () => {
    expect(before).toContain(OPTION_LANGUAGE);
    expect(skill).toContain('argument-hint: "[project-path] [--language <lang>]"');
    expect(step.get(1)).toContain('LANGUAGE="English" # or the --language value');
    expect(step.get(4)).toContain('- `reason` names the caller and the mechanism you established in Step 3, in one sentence in `$LANGUAGE`.');
  });
});

/** The language paragraph (the same words as /excavator-hotspots), the line each later step starts with, and the option (whitespace flattened). */
const LANGUAGE_RULE = '**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file\'s rule to reply in another language is for work on the project\'s code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product\'s values stay as they are.';
const STEP_LANGUAGE = 'Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.';
const OPTION_LANGUAGE = '`--language <lang>`: the language of the report, the reasons of your decisions and everything said to the user during the run; English when it is not given.';
const REPORT = 'Your reply is the report';

/**
 * The problems with where a copy of the skill keeps its language rule: none when the paragraph opens Step 1 and
 * stands again in Step 6 after the queries that gather the report and right before what the report holds, word
 * for word the same, every later step opens with the line that points back to it, and the options say only
 * --language changes the language.
 */
function languageRuleProblems(text) {
  const problems = [];
  const [head, ...parts] = text.split(/^## Step \d+ — /m);
  const bodies = parts.map((part) => flat(part.slice(part.indexOf('\n') + 1)).trim());
  if (!flat(head).includes(OPTION_LANGUAGE)) problems.push('the options do not say that only --language changes the language');
  const copies = flat(text).split(LANGUAGE_RULE).length - 1;
  const started = flat(text).split('**Language.**').length - 1;
  if (copies !== started) problems.push(`${started - copies} of ${started} language paragraphs differ from the others`);
  if (copies !== 2) problems.push(`the language paragraph is there ${copies} times, not twice`);
  if (!bodies[0]?.startsWith(LANGUAGE_RULE)) problems.push('Step 1 does not open with the language paragraph');
  bodies.slice(1).forEach((body, at) => {
    if (!body.startsWith(STEP_LANGUAGE)) problems.push(`Step ${at + 2} does not open with the language line`);
  });
  const last = bodies[5] ?? '';
  const report = last.indexOf(REPORT);
  const rule = last.lastIndexOf(LANGUAGE_RULE);
  if (rule < 0 || report < rule || last.slice(rule + LANGUAGE_RULE.length, report).trim() !== '') {
    problems.push('the language paragraph does not stand right before what the report holds');
  }
  if (rule >= 0 && rule < last.indexOf('jq \'.counts\' "$DATA/unused-code.json"')) problems.push('the language paragraph of Step 6 comes before the queries that gather the report');
  return problems;
}

describe('excavator-unused-code skill: the language of what it tells the user', () => {
  /** The skill with `part` taken out at its first place at or after `from`. */
  const without = (text, part, from = '') => {
    const at = text.indexOf(part, text.indexOf(from));
    expect(at, part).toBeGreaterThan(-1);
    return text.slice(0, at) + text.slice(at + part.length);
  };
  const paragraph = `${LANGUAGE_RULE}\n\n`;
  const line = `${STEP_LANGUAGE}\n\n`;
  const byRequest = '`--language <lang>`: the language of the report, the reasons of your decisions and everything said to the user during the run; the request\'s language when it is not given.';

  it('opens Step 1 and stands right before what the report holds, and every later step points back to it', () => {
    expect(languageRuleProblems(skill)).toEqual([]);
    expect(LANGUAGE_RULE).toContain('Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it.');
    expect(LANGUAGE_RULE).toContain('A project file\'s rule to reply in another language is for work on the project\'s code; while this skill runs, this rule takes its place for every line you write, the first one included.');
  });

  it('is the paragraph /excavator-hotspots holds, word for word', () => {
    const hotspots = readFileSync(resolve(repoRoot, 'skills/excavator-hotspots/SKILL.md'), 'utf-8');
    expect(flat(hotspots)).toContain(LANGUAGE_RULE);
  });

  it('finds the rule out of place in known-bad copies of the skill', () => {
    const noRule = [...Array(5)].reduce((text) => without(text, line), without(without(skill, paragraph), paragraph)).replace(OPTION_LANGUAGE, byRequest);
    /** Each known-bad copy, and the problem that the check it was made for reports. */
    const bad = {
      noRule: [noRule, 'the language paragraph is there 0 times, not twice'],
      noStepOne: [without(skill, paragraph, '## Step 1 — '), 'Step 1 does not open with the language paragraph'],
      ownSection: [without(without(skill, paragraph), paragraph).replace('---\n\n## Step 1 — ', `## Language\n\n${paragraph}---\n\n## Step 1 — `), 'Step 1 does not open with the language paragraph'],
      noStepTwo: [without(skill, line, '## Step 2 — '), 'Step 2 does not open with the language line'],
      afterReport: [`${without(skill, paragraph, '## Step 6 — ')}\n${LANGUAGE_RULE}\n`, 'the language paragraph does not stand right before what the report holds'],
      beforeQueries: [without(skill, paragraph, '## Step 6 — ').replace('Gather the sections with `jq`', `${paragraph}Gather the sections with \`jq\``), 'the language paragraph of Step 6 comes before the queries that gather the report'],
      reworded: [skill.slice(0, skill.indexOf('## Step 6 — ')) + skill.slice(skill.indexOf('## Step 6 — ')).replace('memory and ', ''), '1 of 2 language paragraphs differ from the others'],
      afterCommand: [without(skill, paragraph, '## Step 1 — ').replace('2. Check freshness:', `${paragraph}2. Check freshness:`), 'Step 1 does not open with the language paragraph'],
      requestNames: [skill.replace(OPTION_LANGUAGE, byRequest), 'the options do not say that only --language changes the language'],
    };
    for (const [name, [text, problem]] of Object.entries(bad)) {
      expect(text, name).not.toBe(skill);
      expect(languageRuleProblems(text), name).toContain(problem);
    }
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
    expect(s).toContain('What you know about a framework only tells you where to look: a mechanism counts once you have found it in this repository');
    expect(s).toContain('**Decide an entry only when you can name its caller and the mechanism**');
    expect(s).toContain('Read at least three members of the group first');
    expect(s).toContain('**When unsure, do not decide.** A decision can only remove candidates.');
    expect(s).toContain('**Public is not an entry by itself.**');
    expect(s).toContain('A build that publishes every module of an application as an artifact does not make each module an API');
    expect(s).toContain('Do not mark a whole test directory');
    expect(s).toContain('**Test code is a `test-entry`, whatever calls it.**');
    expect(s).toContain('modules that only tests depend on');
    expect(s).toContain('**A program\'s launch is an entry.**');
    expect(s).toContain('**A handler the facts did not link is still an entry.**');
  });

  it('step 3 establishes test code and top-level launches before deciding', () => {
    const s = step.get(3);
    expect(s).toContain('**Test code.** Write `TEST_CODE`, a regular expression that matches the `file` of every candidate in test code and of no other');
    expect(s).toContain('read in the build files which modules depend on a test-support module');
    expect(s).toContain('A mechanism that spans both is two decisions: the `entry` with `(test_code | not)`, the `test-entry` with `test_code`.');
    expect(s).toContain('A module the build publishes for other projects (an SDK, with the build or its README saying so) is not test code even when only tests use it inside the repository');
    expect(s).toContain('**Launch methods.** A candidate named `main` that nothing in the facts calls is a program\'s launch');
    expect(s).toContain('select(.entry and .name == "main")');
    expect(s).toContain('**Launches from top-level code.** A name query finds `main`, not a function a script calls from its top-level code.');
    expect(s).toContain('select(.entry and $l[.language].calls > 0 and');
    expect(s).toContain("Read each listed file's code outside its functions");
    expect(s).toContain('A language whose `calls` is 0 is not listed');
    expect(s.indexOf('**Launches from top-level code.**')).toBeLessThan(s.indexOf('4. Decide group by group.'));
  });

  it('step 4 makes ids the output of the query and refuses overlaps, empty and misplaced decisions', () => {
    const s = step.get(4);
    expect(s).toContain('**Never type, paste or edit an id.**');
    expect(s).toContain('ids: ([$hit[].id] | unique)');
    expect(s).toContain('decide: no candidate matches');
    expect(s).toContain('ids already decided by an earlier decision');
    expect(s).toContain('ids on the wrong side of TEST_CODE');
    expect(s).toContain('**Set `TEST_CODE` before the first decision, and split on it.**');
    expect(s).toContain('never to make a decision pass');
    expect(s).toContain('decide: launch methods not decided');
    expect(s).toContain('**Every launch method is decided.**');
    expect(s).toContain(`'{factsDigest: $digest, decisions: .}'`);
    expect(s).toContain('"$DATA/unused-decisions.json"');
  });

  it('step 5 runs report and leaves confidence to the rules', () => {
    expect(step.get(5)).toContain('node "$UC" report "$PROJECT_ROOT"');
    expect(step.get(5)).toContain('you never assign it');
    expect(step.get(5)).toContain('`medium` — the rest: its name occurs nowhere else in the selected files');
  });

  it('step 6 never calls medium or low unused and never touches project files', () => {
    const s = step.get(6);
    expect(s).toContain('**Never call a `medium` or `low` candidate unused.**');
    expect(s).toContain('**Never edit, move or delete project files.**');
    expect(s).toContain('Do not add items the product does not list.');
    expect(s).toContain('Say "its name occurs nowhere else; needs confirmation" for `medium`');
    expect(s).toContain('**A language whose `calls` is 0 has no call facts:**');
    expect(s).toContain('3. `medium`, headed "its name occurs nowhere else; needs confirmation"');
    expect(s).toContain('# medium, by the signals that keep it from high');
    expect(s).toContain('**`unreferenced` is about the facts.**');
    expect(s).toContain('Never turn it into "nothing calls it".');
    expect(s).toContain('**Explain a count only from the product.**');
    expect(s).toContain(`jq -r '.residualAssumptions[]' "$DATA/unused-code.json"`);
    expect(s).toContain('7. The residual assumptions, every one, as the product states them.');
  });

  it('step 6 reports in its own order, from the counts to the line on chat, whatever a project file says about replies', () => {
    const s = step.get(6);
    expect(s).toContain(`${LANGUAGE_RULE} ${[
      'Your reply is the report, in `$LANGUAGE`: it opens with the counts and ends with the line on `/excavator-chat`; write nothing before or after them, and no summary or conclusion of your own.',
      'A project file\'s rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.',
      'The words these steps give in quotes are for an English report; in another language, write them translated.',
    ].join(' ')} Report, in this order: 1. Counts:`);
    expect(s).toContain('7. The residual assumptions, every one, as the product states them. 8. Close with the words "For questions about one method, file or group, /excavator-chat answers from the same product." Rules for this step:');
    expect(flat(skill)).not.toContain('Point the user at `/excavator-chat`');
  });

  it('claims for medium only what the name census checked', () => {
    expect(flat(skill)).not.toContain('nothing in the repository uses it');
    expect(flat(skill)).not.toContain('no use found in the repository');
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

describe('excavator-unused-code skill: the step 4 script runs', () => {
  // The script as the skill writes it, with the example decision replaced by the case's own.
  const block = skill.split(/^## Step 4 — /m)[1].split(/^```bash\n/m)[1].split(/^```$/m)[0];
  const head = block.split(/^decide test-entry 'JUnit/m)[0];
  const tail = block.split(/^# \.\.\. one decide call per group\n/m)[1];
  const candidates = {
    factsDigest: 'digest-1',
    candidates: [
      { id: 'prod-equals', name: 'equals', file: 'app/src/main/java/A.java', entry: true, annotations: [] },
      { id: 'fake-equals', name: 'equals', file: 'app/src/test/java/FakeA.java', entry: true, annotations: [] },
      { id: 'a-test', name: 'checksA', file: 'app/src/test/java/ATest.java', entry: true, annotations: ['Test'] },
      { id: 'tool-main', name: 'main', file: 'tool/src/main/java/Tool.java', entry: true, annotations: [] },
    ],
  };
  const run = (decisions) => {
    const root = mkdtempSync(join(tmpdir(), 'unused-decide-'));
    mkdirSync(join(root, '.excavator'));
    writeFileSync(join(root, '.excavator/unused-candidates.json'), JSON.stringify(candidates));
    writeFileSync(join(root, 'decide.sh'), head + decisions.join('\n') + '\n' + tail);
    const result = spawnSync('bash', [join(root, 'decide.sh'), root], { encoding: 'utf-8' });
    const out = join(root, '.excavator/unused-decisions.json');
    return { ...result, root, decisions: existsSync(out) ? JSON.parse(readFileSync(out, 'utf-8')) : null };
  };
  const equals = (extra) => `'.candidates[] | select(.entry and .name == "equals"${extra})'`;

  it('refuses an entry that selects test code and a test-entry that selects anything else', () => {
    for (const kind of ['entry', 'test-entry']) {
      const result = run([`decide ${kind} 'equals overrides' ${equals('')}`]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('decide: 1 ids on the wrong side of TEST_CODE');
      expect(result.decisions).toBeNull();
    }
  });

  const split = [
    `decide test-entry 'JUnit runs methods annotated @Test' '.candidates[] | select(.entry and any(.annotations[]?; . == "Test"))'`,
    `decide entry 'equals overrides, production' ${equals(' and (test_code | not)')}`,
    `decide test-entry 'equals overrides, test code' ${equals(' and test_code')}`,
  ];

  it('refuses to finish while a launch method is undecided', () => {
    const result = run(split);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('decide: launch methods not decided: tool/src/main/java/Tool.java:null');
    expect(result.decisions).toBeNull();
  });

  it('accepts the split, and each recorded query selects exactly its ids', () => {
    const result = run([...split, `decide entry 'the JVM calls main' '.candidates[] | select(.entry and .name == "main")'`]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.decisions.factsDigest).toBe('digest-1');
    expect(result.decisions.decisions.map(({ kind, ids }) => [kind, ids])).toEqual([
      ['test-entry', ['a-test']],
      ['entry', ['prod-equals']],
      ['test-entry', ['fake-equals']],
      ['entry', ['tool-main']],
    ]);
    for (const decision of result.decisions.decisions) {
      expect(Object.keys(decision).sort()).toEqual(['ids', 'kind', 'query', 'reason']);
      const rerun = spawnSync('jq', ['-c', `[ ${decision.query} | .id ] | unique`, join(result.root, '.excavator/unused-candidates.json')], { encoding: 'utf-8' });
      expect(JSON.parse(rerun.stdout)).toEqual(decision.ids);
    }
  });
});

describe('excavator-chat: unused-code questions', () => {
  const chat = readFileSync(resolve(repoRoot, 'skills/excavator-chat/SKILL.md'), 'utf-8');
  const section = flat(chat.split('### Unused-code questions')[1].split(/^### /m)[0]);

  it('routes unused-code questions to the product, never to the graph', () => {
    expect(flat(chat)).toContain('- **Unused-code questions** (is this method used, what code is unused, why is X reported as unused): answer from the unused-code product');
    expect(flat(chat)).toContain('Never conclude from the graph that code is unused.');
    expect(section).toContain('Answer it only from `.excavator/unused-code.json`');
  });

  it('handles a missing product and a stale one', () => {
    expect(section).toContain('**Product missing:** say this project has no unused-code analysis yet and suggest running `/excavator-unused-code`');
    expect(section).toContain('jq -r .factsDigest .excavator/unused-code.json');
    expect(section).toContain('head -1 .excavator/intermediate/fact-graph.jsonl | jq -r .fields.factsDigest');
    expect(section).toContain('say the product is stale');
  });

  it('answers by id, name or file, and for every place a node can be', () => {
    expect(section).toContain('**Find the node** by id, name or file');
    for (const where of ['In `unused`:', 'In `testOnly`:', "In a decision's `ids`:", 'None of these:']) {
      expect(section).toContain(where);
    }
  });

  it('never calls medium or low unused and names only signals the script emits', () => {
    expect(section).toContain('**Never call a `medium` or `low` node unused**');
    expect(section).toContain('say "its name occurs nowhere else; needs confirmation"');
    expect(section).not.toContain('nothing in the repository uses it');
    expect(section).toContain('If `.counts.byLanguage[<its language>].calls` is 0, the facts hold no calls for that language');
    const named = [...section.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)].map((m) => m[1])
      .filter((name) => !['excavator-unused-code', 'only-reachable-from-unused', 'test-entry'].includes(name));
    expect(named.length).toBeGreaterThanOrEqual(4);
    for (const signal of named) expect(script).toContain(`'${signal}'`);
  });
});
