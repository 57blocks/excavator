/**
 * The excavator-prd skill is a prompt; its rules only hold if each one sits in
 * the phase where the model acts on it. These tests pin the target state of
 * the openspec change prd-feature-pipeline (design O2): five phases, the
 * language of everything the skill writes to the user, the defaults, the
 * resume rule, the scripts that check the index before any lane and each lane
 * after it returns, and a reply printed from the fields `aggregate` prints.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADVICE_WORDS } from '../../skills/excavator-prd/lib/lane-check.mjs';

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
const rawPhase = (n) => {
  const start = skill.indexOf(`## Phase ${n} — `);
  const end = skill.indexOf(`## Phase ${n + 1} — `);
  return start < 0 ? '' : skill.slice(start, end < 0 ? undefined : end);
};
/** The lane subagent's prompt: the four-backtick text block of Phase 2 (it holds three-backtick examples). */
const lanePrompt = (rawPhase(2).match(/^````text\n([\s\S]*?)\n````$/m) ?? [])[1] ?? '';

/** The language paragraph (the same words as /excavator-hotspots), the line each later phase starts with, and the option (whitespace flattened). */
const LANGUAGE_RULE = '**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file\'s rule to reply in another language is for work on the project\'s code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product\'s values stay as they are.';
const PHASE_LANGUAGE = 'Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.';
const OPTION_LANGUAGE = '`--language <lang>` — the language of the PRD and everything said to the user during the run; English when it is not given.';
const PRD = '"$PLUGIN_ROOT/skills/excavator-prd/prd.mjs"';
const VERIFY = 'follow the procedure in `$PLUGIN_ROOT/skills/excavator-verify/SKILL.md` on it with `--fix`, `--language` set to `$LANGUAGE` and `PROJECT_ROOT` as the project path';

describe('excavator-prd skill: phases', () => {
  it('has the five phases in order', () => {
    expect([...phase.keys()]).toEqual([0, 1, 2, 3, 4]);
    const titles = [...skill.matchAll(/^## Phase \d+ — (.+)$/gm)].map((m) => m[1]);
    expect(titles).toEqual([
      'Setup',
      'Overview and index',
      'Feature lanes',
      'Verify and aggregate',
      'Self-check and reply',
    ]);
  });

  it('frontmatter names the skill after its directory and lists the options', () => {
    expect(skill.startsWith('---\nname: excavator-prd\n')).toBe(true);
    expect(skill).toContain('argument-hint: "[path] [--role <audience>] [--language <lang>] [--scope <domain-or-subdir>] [--out <dir>] [--concurrency <n>] [--fresh]"');
  });

  it('holds no Chinese character', () => {
    expect(skill).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/u);
  });
});

describe('excavator-prd skill: setup, defaults and resume', () => {
  it('parses every option with its default', () => {
    expect(phase.get(0)).toContain('Parse `--role` (default `product manager`), `--language` (`$LANGUAGE`: English when it is not given), `--scope`, `--out` (`$OUT`, default `$PROJECT_ROOT/.excavator/prd`), `--concurrency` (`$CONCURRENCY`, default `3`) and `--fresh`.');
    expect(before).toContain('`--concurrency <n>`');
    expect(before).toContain('`--out <dir>`');
    expect(before).toContain('`--fresh`');
  });

  it('only reports stale or missing facts, never rebuilds them, and writes only under $OUT', () => {
    const setup = phase.get(0);
    expect(setup).toContain('`stale` or `missing` is only reported');
    expect(setup).toContain('This skill never runs `/excavator`, `sync_facts` or any other command that rebuilds the facts in `.excavator/`');
    expect(setup).toContain('Write only under `$OUT`');
  });

  it('resumes by status, refuses to resume over changed source, and starts over only with --fresh', () => {
    const setup = phase.get(0);
    for (const rule of [
      'With `--fresh`, delete `$OUT` and start over.',
      'When `$OUT/index.json` exists and `--fresh` is not given, resume',
      'If its `sourceRevision` differs from the current one, do not resume: tell the user to run again with `--fresh`, and stop.',
      '`verified` features are kept as they are',
      '`written` and `checked` features only get the later steps',
      '`planned` features, and `failed` features with `attempts` below 2, go back to Phase 2',
      '`failed` features with `attempts` 2 stay failed',
    ]) expect(setup, rule).toContain(rule);
  });

  it('takes the current source revision from consumer-freshness and brings the statuses up to date before resuming', () => {
    const setup = phase.get(0);
    expect(setup).toContain('node "$PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT"');
    expect(setup).toContain('Its `currentSourceRevision` is the current source revision');
    const refresh = setup.indexOf(`node ${PRD} aggregate "$OUT"`);
    expect(refresh).toBeGreaterThan(setup.indexOf('If its `sourceRevision` differs from the current one'));
    expect(refresh).toBeLessThan(setup.indexOf('`verified` features are kept as they are'));
    expect(phase.get(1)).toContain('`sourceRevision`: the `currentSourceRevision` Phase 0 printed');
  });
});

describe('excavator-prd skill: index and lanes', () => {
  it('lists the entrypoints by script, keeps the off-graph hunt as the source of inferred candidates, and resolves real routes', () => {
    const index = phase.get(1);
    expect(index).toContain(`node ${PRD} entrypoints "$PROJECT_ROOT"`);
    expect(index).toContain('| Notifications / messaging |');
    expect(index).toContain('| Scheduled / background / async |');
    expect(index).toContain('| Permission / authorization |');
    expect(index).toContain('`provenance: "inferred"`');
    expect(index).toContain('Resolve each UI page\'s real route from the router, not from its file location.');
  });

  it('runs check-index before any lane is dispatched', () => {
    const index = phase.get(1);
    expect(index).toContain(`node ${PRD} check-index "$OUT"`);
    expect(index).toContain('Do not dispatch any lane until `check-index` exits 0.');
    const checkAt = skill.indexOf('check-index "$OUT"');
    expect(checkAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(skill.indexOf('## Phase 2 — '));
    expect(checkAt).toBeLessThan(skill.indexOf('````text'));
  });

  it('dispatches at most $CONCURRENCY lanes per message in the foreground, checks each as it returns, and re-dispatches a missing lane once', () => {
    const lanes = phase.get(2);
    expect(lanes).toContain('Dispatch at most `$CONCURRENCY` lanes in one message');
    expect(lanes).toContain('in the foreground');
    expect(lanes).toContain('never in the background');
    expect(lanes).toContain(`node ${PRD} check-lane "$OUT" <id>`);
    expect(lanes).toContain('re-dispatch it once');
    expect(lanes).toContain('`lane-wrote-nothing`');
  });

  it('records each dispatch and a lane that wrote nothing twice with mark, and prints a progress line per lane', () => {
    const lanes = phase.get(2);
    const dispatched = lanes.indexOf(`node ${PRD} mark "$OUT" <id> dispatched`);
    expect(dispatched).toBeGreaterThan(-1);
    expect(dispatched).toBeLessThan(lanes.indexOf('Dispatch at most `$CONCURRENCY` lanes in one message'));
    expect(lanes).toContain(`node ${PRD} mark "$OUT" <id> failed lane lane-wrote-nothing`);
    expect(lanes).toContain(`node ${PRD} mark "$OUT" <id> failed check-lane`);
    expect(lanes).toContain('`Lane <id> <n>/<N>: <status>`');
    expect(lanes).toContain('never edit `index.json` yourself');
  });

  it('gives each lane the writing rules, the findings definition and the two files it may write', () => {
    expect(lanePrompt).not.toBe('');
    const prompt = flat(lanePrompt);
    for (const rule of [
      'Write in `$LANGUAGE`, in product language for `$ROLE`.',
      'When `$LANGUAGE` differs from the source\'s language',
      '**No code in the body.**',
      '**Translate codes — never print raw values.**',
      '**Preserve source-owned names; translate only the generic prose.**',
      '**Describe each flow end-to-end, across tiers.**',
      'Depth requirements',
      '**Prove the statements that tend to be wrong.**',
      '**Mermaid is required, not optional.**',
      '**Evidence stays foldable.**',
      'Write only these two files',
      'Reply with one line',
      'Do not write how to fix it',
      'or the same words in `$LANGUAGE`',
      '**As-Is only.**',
      '**Every flow in your scope.**',
      '**Terminology.**',
      '`{"findings": [{"id": "<id>-1", "class": "product", "statement": "<the defect as it is>", "flows": ["<id>"], "evidence": [{"file": "<path from the project root>", "passage": "<text copied from the file>"}]}]}`',
      'occurs exactly once in that file',
      'Give no severity and no confidence.',
      '`{"findings": []}`',
    ]) expect(prompt, rule).toContain(rule);
    expect(prompt).toMatch(/`product`/);
    expect(prompt).toMatch(/`technical`/);
    expect(phase.get(2)).not.toContain('`--language`');
  });

  it('names in the lane prompt every English word the advice gate refuses', () => {
    const prompt = lanePrompt.toLowerCase();
    for (const word of ADVICE_WORDS.filter((w) => /^[\x00-\x7f]+$/.test(w))) expect(prompt, word).toContain(word);
  });
});

/** The command lines of a phase's bash blocks that start with `start`, with `$OUT`, `$PROJECT_ROOT` and `$PLUGIN_ROOT` made real. */
function recipes(n, start, out, project) {
  const blocks = [...rawPhase(n).matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  return blocks.flatMap((block) => block.split('\n')).map((line) => line.trim()).filter((line) => line.startsWith(start))
    .map((line) => line.replaceAll('$OUT', out).replaceAll('$PROJECT_ROOT', project).replaceAll('$PLUGIN_ROOT', repoRoot));
}
const sh = (command) => spawnSync('sh', ['-c', command], { encoding: 'utf-8' });

describe('excavator-prd skill: --project', () => {
  it('passes --project "$PROJECT_ROOT" to every prd.mjs command that reads $OUT', () => {
    const commands = skill.split('\n').map((line) => line.trim()).filter((line) => line.startsWith(`node ${PRD} `));
    const reading = commands.filter((line) => !line.startsWith(`node ${PRD} entrypoints `));
    expect(new Set(reading.map((line) => line.split(' ')[2]))).toEqual(new Set(['check-index', 'check-lane', 'mark', 'aggregate', 'assemble']));
    for (const line of reading) expect(line, line).toMatch(/ --project "\$PROJECT_ROOT"$/);
  });
});

describe('excavator-prd skill: its recipes run', () => {
  const project = resolve(repoRoot, 'tests/fixtures/prd-pipeline/express-app');
  const PLAN = {
    language: 'English', role: 'product manager', scope: null,
    inferred: [{ id: 'i1', kind: 'job', file: 'src/jobs/reminders.js', line: 1, text: 'x', framework: 'node-schedule', provenance: 'inferred' }],
    features: [
      { id: 'F1', name: 'Orders', kind: 'flow', chapter: 1, entrypoints: ['c2', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'], seedFiles: ['src/routes/orders.js', 'src/routes/payments.js'], tiers: ['backend'] },
      { id: 'F2', name: 'Reminders', kind: 'automated', chapter: 2, entrypoints: ['c3', 'i1'], seedFiles: ['src/jobs/reminders.js'], tiers: ['backend'] },
    ],
    unassigned: ['c1'],
    glossary: [{ term: 'Order', meaning: 'A request for goods.' }],
    residualAssumptions: ['planned by hand for the test'],
  };

  /** Run Phase 1's entrypoints line and index recipe on the express fixture with `plan`; returns the out directory and check-index's run. */
  function buildIndex(plan) {
    const out = mkdtempSync(join(tmpdir(), 'xprd-skill-'));
    const listed = recipes(1, 'node ', out, project).find((line) => line.includes(' entrypoints '));
    expect(listed).toBeDefined();
    expect(sh(listed).status).toBe(0);
    writeFileSync(join(out, 'plan.json'), JSON.stringify(plan));
    const [build] = recipes(1, 'jq -n ', out, project);
    expect(build).toBeDefined();
    const made = sh(build.replace('<currentSourceRevision>', 'directory:test'));
    expect(made.status, made.stderr).toBe(0);
    const check = sh(recipes(1, 'node ', out, project).find((line) => line.includes(' check-index ')));
    return { out, check };
  }

  it('builds an index check-index accepts from the plan and the listed candidates, with the inferred ones and the revision', () => {
    const { out, check } = buildIndex(PLAN);
    try {
      expect(check.status, check.stdout).toBe(0);
      const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf-8'));
      expect(index.sourceRevision).toBe('directory:test');
      expect(index.projectRoot).toBe(project);
      expect(index.candidates.items.map((item) => item.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'i1']);
      expect(index.residualAssumptions.at(-1)).toBe('planned by hand for the test');
      const [list] = recipes(2, 'jq -r ', out, project);
      expect(sh(list).stdout).toBe('F1\t0\tOrders\nF2\t0\tReminders\n');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('lists again a failed lane with attempts below 2, and not one with 2 attempts or a written one', () => {
    const { out, check } = buildIndex({
      ...PLAN,
      features: [
        ...PLAN.features,
        { id: 'F3', name: 'Admin', kind: 'flow', chapter: 3, entrypoints: [], seedFiles: ['bin/admin.js'], tiers: ['backend'] },
        { id: 'F4', name: 'Health', kind: 'flow', chapter: 4, entrypoints: [], seedFiles: ['src/app.js'], tiers: ['backend'] },
      ],
    });
    try {
      expect(check.status, check.stdout).toBe(0);
      const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf-8'));
      const set = (id, fields) => Object.assign(index.features.find((f) => f.id === id), fields);
      set('F1', { status: 'failed', attempts: 1, failure: { step: 'check-lane', reasons: ['x'] } });
      set('F2', { status: 'failed', attempts: 2, failure: { step: 'lane', reasons: ['lane-wrote-nothing'] } });
      set('F3', { status: 'checked', attempts: 1 });
      writeFileSync(join(out, 'index.json'), JSON.stringify(index));
      const [list] = recipes(2, 'jq -r ', out, project);
      expect(sh(list).stdout).toBe('F1\t1\tOrders\nF4\t0\tHealth\n');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('lets check-index refuse a plan that leaves a candidate out', () => {
    const { out, check } = buildIndex({ ...PLAN, unassigned: [] });
    try {
      expect(check.status).toBe(1);
      expect(check.stdout).toContain('c1');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('joins the uncovered frameworks with a comma, and prints nothing after the colon for an empty list', () => {
    const line = REPLY_COMMAND.split('\n').find((row) => row.includes('<uncovered>')).trim().replace(/ \\$/, '');
    expect(sh(`printf '%s\\n' ${line.replace('<uncovered>', '["gin","spring"]')}`).stdout).toBe('No entrypoint patterns for: gin, spring\n');
    expect(sh(`printf '%s\\n' ${line.replace('<uncovered>', '[]')}`).stdout).toBe('No entrypoint patterns for: \n');
  });
});

describe('excavator-prd skill: verify and aggregate', () => {
  it('verifies each checked chapter itself, not in a lane, and keeps the reply lines verbatim for aggregate', () => {
    const verify = phase.get(3);
    expect(verify).toContain(VERIFY);
    expect(verify).toContain('not in a lane');
    expect(verify).toContain('`$OUT/verification/<id>.md`');
    expect(verify).toContain('`$OUT/verification/<id>.txt`');
    expect(verify).toContain('store the lines it prints verbatim in `$OUT/verification/<id>.txt`');
    expect(verify).toContain('even though Phase 6 of `excavator-verify` says to skip its reply when another skill follows its procedure');
  });

  it('writes the overview without tables and counts the scope by command', () => {
    const verify = phase.get(3);
    expect(verify).toContain('`$OUT/overview.md`');
    expect(verify).toContain('Put no table in `overview.md`');
    expect(verify).toContain('localized to `$LANGUAGE`');
    expect(verify).toContain('git ls-files -- "$SCOPE" | wc -l');
  });

  it('runs aggregate, then assemble', () => {
    const verify = phase.get(3);
    const aggregate = verify.indexOf(`node ${PRD} aggregate "$OUT"`);
    const assemble = verify.indexOf(`node ${PRD} assemble "$OUT"`);
    expect(aggregate).toBeGreaterThan(-1);
    expect(assemble).toBeGreaterThan(aggregate);
  });
});

describe('excavator-prd skill: the language of what it writes', () => {
  it('writes the PRD and every line to the user in English unless --language names another language', () => {
    expect(before).toContain(OPTION_LANGUAGE);
    expect(before).not.toContain('primary human language');
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
      beforeSelfCheck: without(skill, paragraph, '## Phase 4 — ').replace('1. **Self-check.**', `${paragraph}1. **Self-check.**`),
      reworded: skill.slice(0, skill.indexOf('## Phase 4 — ')) + skill.slice(skill.indexOf('## Phase 4 — ')).replace('memory and ', ''),
      byCodebase: skill.replace(OPTION_LANGUAGE, byCodebase),
    };
    for (const [name, text] of Object.entries(bad)) expect(languageRuleProblems(text), name).not.toEqual([]);
  });
});

/** Step 2 of Phase 4: where the PRD stays, the command that prints the reply, and what the reply may hold. */
const SAVE = 'The PRD stays in `$OUT`: write it into the project only when the user says so, to `docs/PRD.md` (a scoped PRD: `docs/PRD-<scope>.md`) or a path the user gives.';
const REPLY = 'Then print the reply\'s lines with this command';
const REPLY_COMMAND = [
  '# the reply: where the PRD is, the counts aggregate printed and the offer to save it',
  'printf \'%s\\n\' \\',
  '  "<prdPath>" \\',
  '  "<features.written>/<features.total> features written, <features.failed> failed" \\',
  '  "<diagrams> diagrams" \\',
  '  "<findings.product> product, <findings.technical> technical findings, anchors checked" \\',
  '  "Statements: <verification.verified> verified, <verification.contradicted> contradicted, <verification.misattributed> misattributed, <verification.unverifiable> unverifiable; open items: <verification.resolvedRight> resolved right, <verification.resolvedWrong> resolved wrong, <verification.stillOpen> still open; cross-section conflicts: <verification.conflicts>, not checked: <verification.notChecked>" \\',
  '  "No entrypoint patterns for: $(printf \'%s\' \'<uncovered>\' | jq -r \'join(", ")\')" \\',
  '  "To save it in the project, say so: it goes to <default path> unless you give another path. Commit it to share it with the team."',
].join('\n');
const REPLY_RULE = [
  'Reply with exactly the lines it prints and nothing else. Its first line, the PRD\'s path, is the reply\'s first line and the offer to save its last: write nothing before, between or after them, no word on the checks, the PRD or what was done, and no summary or notes.',
  'A project file\'s rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.',
  'In a language other than English, write the command\'s words translated; the path, the numbers and the framework names stay as they are.',
  'Leave the line of frameworks without patterns out when `uncovered` is empty, and the last line out when `--out` was given.',
].join(' ');
/** The fields `prd.mjs aggregate` prints (design D9), as the reply's placeholders name them. */
const AGGREGATE_FIELDS = [
  'prdPath',
  'features.total', 'features.written', 'features.failed',
  'diagrams',
  'findings.product', 'findings.technical',
  'verification.verified', 'verification.contradicted', 'verification.misattributed', 'verification.unverifiable',
  'verification.resolvedRight', 'verification.resolvedWrong', 'verification.stillOpen',
  'verification.conflicts', 'verification.notChecked',
  'uncovered',
];

/**
 * The problems with where a copy of the skill keeps its language rule: none when the paragraph opens Phase 0 and
 * stands again in Phase 4 after the self-check and right before the command that prints the reply, word for word
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
  if (rule >= 0 && rule < last.indexOf('1. **Self-check.**')) problems.push('the language paragraph of Phase 4 comes before the self-check');
  return problems;
}

describe('excavator-prd skill: the reply', () => {
  const save = skill.slice(skill.indexOf('2. **Save and reply.**'));

  it('keeps the PRD in $OUT and only offers to save it in the project', () => {
    expect(flat(save)).toContain(`2. **Save and reply.** ${SAVE}`);
    expect(skill).not.toContain('Offer to write the PRD to the project');
  });

  it('ends with the command that prints the reply, and the reply is what it prints', () => {
    expect(skill.trimEnd().endsWith(`${REPLY_COMMAND}\n\`\`\`\n\n${REPLY_RULE}`)).toBe(true);
    expect(flat(save)).toContain(`${LANGUAGE_RULE} ${REPLY}, putting in the fields \`aggregate\` printed and the default path: \`\`\`bash`);
  });

  it('fills every place of the command from a field aggregate prints, and every field has its place', () => {
    const places = [...REPLY_COMMAND.matchAll(/<([^<>]+)>/g)].map((m) => m[1]).filter((place) => place !== 'default path');
    expect([...new Set(places)].sort()).toEqual([...AGGREGATE_FIELDS].sort());
    expect(places).toHaveLength(AGGREGATE_FIELDS.length);
  });

  it('says to copy uncovered as the list aggregate printed, which jq joins', () => {
    expect(flat(save)).toContain('In the command, `<uncovered>` is the list exactly as `aggregate` printed it, brackets and quotes included, on one line; `jq` joins it.');
  });

  it('prints the seven lines of the reply once its places are filled in', () => {
    const values = {
      prdPath: '/tmp/out/PRD.md',
      'features.total': '5', 'features.written': '4', 'features.failed': '1',
      diagrams: '9',
      'findings.product': '3', 'findings.technical': '2',
      'verification.verified': '40', 'verification.contradicted': '2', 'verification.misattributed': '1', 'verification.unverifiable': '0',
      'verification.resolvedRight': '3', 'verification.resolvedWrong': '1', 'verification.stillOpen': '2',
      'verification.conflicts': '0', 'verification.notChecked': '0',
      uncovered: '["spring","laravel"]',
      'default path': 'docs/PRD.md',
    };
    const command = skill.match(/```bash\n(# the reply:[\s\S]*?)```/)[1].replace(/<([^<>]+)>/g, (_, place) => values[place]);
    const run = spawnSync('sh', ['-c', command], { encoding: 'utf-8' });
    expect(run.status).toBe(0);
    expect(run.stdout.split('\n').slice(0, -1)).toEqual([
      '/tmp/out/PRD.md',
      '4/5 features written, 1 failed',
      '9 diagrams',
      '3 product, 2 technical findings, anchors checked',
      'Statements: 40 verified, 2 contradicted, 1 misattributed, 0 unverifiable; open items: 3 resolved right, 1 resolved wrong, 2 still open; cross-section conflicts: 0, not checked: 0',
      'No entrypoint patterns for: spring, laravel',
      'To save it in the project, say so: it goes to docs/PRD.md unless you give another path. Commit it to share it with the team.',
    ]);
  });
});
