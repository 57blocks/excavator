/**
 * The excavator-prd-report skill is a prompt; its rules only hold if each one sits in
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

import { ADVICE_WORDS } from '../../skills/excavator-prd-report/lib/lane-check.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const skill = readFileSync(resolve(repoRoot, 'skills/excavator-prd-report/SKILL.md'), 'utf-8');
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
const PRD = '"$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs"';
/** The rule Phases 2 and 3 hold: the orchestrator changes no file a lane wrote. */
const NEVER_EDIT = 'Never edit `features/<id>.md` or `findings/<id>.json` yourself.';
/** The heading a re-dispatched lane's prompt gets, above the reasons check-lane printed. */
const RETRY_HEADING = 'Your previous attempt failed these checks; fix them and write both files again:';
/** The sentence the lane prompt's evidence example and check-lane's message share. */
const ANCHOR_RULE = 'Write each anchor in backticks, as `path:line` or `path:line-line`, with the path from the project root.';
const VERIFY = 'follow the procedure in `$PLUGIN_ROOT/skills/excavator-verify/SKILL.md` on it with `--fix`, `--language` set to `$LANGUAGE` and `PROJECT_ROOT` as the project path';

describe('excavator-prd-report skill: phases', () => {
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
    expect(skill.startsWith('---\nname: excavator-prd-report\n')).toBe(true);
    expect(skill).toContain('argument-hint: "[path] [--role <audience>] [--language <lang>] [--scope <domain-or-subdir>] [--out <dir>] [--concurrency <n>] [--fresh]"');
  });

  it('holds no Chinese character', () => {
    expect(skill).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/u);
  });
});

describe('excavator-prd-report skill: setup, defaults and resume', () => {
  it('parses every option with its default', () => {
    expect(phase.get(0)).toContain('Parse `--role` (default `product manager`), `--language` (`$LANGUAGE`: English when it is not given), `--scope`, `--out` (`$OUT`, default `$PROJECT_ROOT/.excavator/prd-report`), `--concurrency` (`$CONCURRENCY`, default `3`) and `--fresh`.');
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

  it('says to delete a stale index lock only when no other prd.mjs command of the run is running', () => {
    expect(phase.get(0)).toContain('When a `prd.mjs` command exits 2 naming `$OUT/index.json.lock` and no other `prd.mjs` command of this run is still running (this skill runs them one at a time), delete that lock file and run the command again; never delete it while a command runs.');
  });

  it('checks the index before it resumes, and fixes it in place without dispatching when check-index fails', () => {
    const setup = phase.get(0);
    const check = setup.indexOf(`node ${PRD} check-index "$OUT" --project "$PROJECT_ROOT"`);
    expect(check).toBeGreaterThan(setup.indexOf('If its `sourceRevision` differs from the current one'));
    expect(check).toBeLessThan(setup.indexOf(`node ${PRD} aggregate "$OUT"`));
    expect(check).toBeLessThan(setup.indexOf('go back to Phase 2'));
    expect(setup).toContain('When `check-index` exits 1, fix the index, and dispatch no lane until `check-index` exits 0.');
    expect(setup).toContain('Never rebuild `index.json` from `plan.json` on a resume: that drops each feature\'s `status`, `attempts` and `failure`.');
    expect(setup).toContain('Fix only the candidates and seed files `check-index` named, with `jq` edits to `$OUT/index.json`, and run `check-index` again.');
    expect(setup).not.toContain('go back to Phase 1');
    const raw = rawPhase(0);
    expect(raw.indexOf('check-index "$OUT"')).toBeGreaterThan(raw.indexOf('When `$OUT/index.json` exists and `--fresh` is not given, resume'));
    expect(raw.indexOf('check-index "$OUT"')).toBeLessThan(raw.indexOf('Phase 2'));
  });
});

describe('excavator-prd-report skill: index and lanes', () => {
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
    expect(skill).not.toMatch(/mark "\$OUT" <id> failed (check-lane|verify)/);
    expect(lanes).toContain('`Lane <id> <n>/<N>: <status>`');
    expect(lanes).toContain('never edit `index.json` yourself');
  });

  it('brings the statuses up to date from the files before it lists the lanes', () => {
    const lanes = phase.get(2);
    const refresh = lanes.indexOf(`node ${PRD} aggregate "$OUT" --project "$PROJECT_ROOT"`);
    expect(refresh).toBeGreaterThan(-1);
    expect(refresh).toBeLessThan(lanes.indexOf('jq -r \'.features | sort_by(.chapter)[]'));
    expect(lanes).toContain('Run `aggregate` right after `check-index` passes, before you list the lanes');
  });

  it('records the dispatches of a batch in one Bash command and checks the lanes one at a time', () => {
    const lanes = phase.get(2);
    const batch = 'Put the `mark` calls of one batch in one Bash command, one after another, before the message that dispatches the batch';
    expect(lanes).toContain(batch);
    expect(lanes.indexOf(batch)).toBeLessThan(lanes.indexOf('Dispatch at most `$CONCURRENCY` lanes in one message'));
    expect(lanes).toContain('Run `check-lane` for one lane at a time, as each returns');
  });

  it('never edits a lane\'s files: re-dispatches a lane that failed check-lane once, with the reasons under a fixed heading', () => {
    const lanes = phase.get(2);
    expect(lanes).toContain(NEVER_EDIT);
    expect(phase.get(3)).toContain(NEVER_EDIT);
    expect(lanes).toContain(`its prompt followed by this line and then each line \`check-lane\` printed: \`${RETRY_HEADING}\``);
    expect(lanes).toContain('A second `check-lane` failure leaves the feature `failed` at `check-lane`');
    expect(lanes).toContain('`check-lane` records its result in `index.json` itself');
    const retry = lanes.indexOf(RETRY_HEADING);
    expect(retry).toBeGreaterThan(lanes.indexOf(`node ${PRD} check-lane "$OUT" <id>`));
    expect(phase.get(4)).not.toContain('in the feature\'s chapter');
    expect(phase.get(4)).not.toContain('When you changed a chapter');
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

  it('tells the lane how to write an anchor, right after the evidence example', () => {
    const prompt = flat(lanePrompt);
    expect(prompt).toContain(`</details> \`\`\` ${ANCHOR_RULE}`);
  });

  it('passes every line check-lane printed to the retried lane, the findings lines included', () => {
    expect(phase.get(2)).toContain('Pass every line `check-lane` printed, including the findings lines.');
  });

  it('has the lane check each anchor\'s last line against its file\'s length before it finishes', () => {
    expect(flat(lanePrompt)).toContain('Before you finish, check the last line of every anchor against the number of lines of its file (`awk \'END { print NR }\' <file>`): an anchor that ends past the last line fails the check.');
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

describe('excavator-prd-report skill: --project', () => {
  it('passes --project "$PROJECT_ROOT" to every prd.mjs command that reads $OUT', () => {
    const commands = skill.split('\n').map((line) => line.trim()).filter((line) => line.startsWith(`node ${PRD} `));
    const reading = commands.filter((line) => !line.startsWith(`node ${PRD} entrypoints `));
    expect(new Set(reading.map((line) => line.split(' ')[2]))).toEqual(new Set(['check-index', 'check-lane', 'check-priorities', 'mark', 'aggregate', 'assemble', 'page', 'reply']));
    for (const line of reading) expect(line, line).toMatch(/ --project "\$PROJECT_ROOT"$/);
  });
});

describe('excavator-prd-report skill: its recipes run', () => {
  const project = resolve(repoRoot, 'tests/fixtures/prd-report-pipeline/express-app');
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

  it('lists the lanes from the statuses aggregate recomputes, not from what index.json said', () => {
    const { out, check } = buildIndex(PLAN);
    try {
      expect(check.status, check.stdout).toBe(0);
      const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf-8'));
      Object.assign(index.features[0], { status: 'checked', attempts: 1 });
      writeFileSync(join(out, 'index.json'), JSON.stringify(index));
      const [refresh] = recipes(2, `node ${PRD} aggregate `, out, project);
      expect(refresh).toBeDefined();
      expect(sh(refresh).status).toBe(0);
      const [list] = recipes(2, 'jq -r ', out, project);
      expect(sh(list).stdout).toBe('F1\t1\tOrders\nF2\t0\tReminders\n');
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
});

describe('excavator-prd-report skill: verify and aggregate', () => {
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
    const conserved = verify.indexOf('`aggregate` exits 1 when a candidate or a status is not conserved');
    expect(conserved).toBeGreaterThan(-1);
    expect(conserved).toBeLessThan(verify.indexOf('`reply` (Phase 4) prints the reply from what `aggregate` recorded.'));
    expect(verify).not.toContain('It exits 1 when a candidate or a status is not conserved');
    const aggregate = verify.indexOf(`node ${PRD} aggregate "$OUT"`);
    const assemble = verify.indexOf(`node ${PRD} assemble "$OUT"`);
    expect(aggregate).toBeGreaterThan(-1);
    expect(assemble).toBeGreaterThan(aggregate);
  });
});

/** The report page step (openspec change prd-report-page, design D8): after assemble, before reply, a failure never stops the reply. */
const PAGE_COMMAND = `node ${PRD} page "$OUT" --project "$PROJECT_ROOT"`;
const PAGE_PROGRESS = 'Then tell the user `Page: <status>`, where `<status>` is `written` or `failed`, in `$LANGUAGE`.';
const PAGE_FAILURE = 'When `page` exits non-zero, tell the user the lines it printed as they are, do not build or edit any page or product file yourself, and go on to Phase 4: `reply` prints `Report page: not written`.';
const REPLY_ORDER = '`reply` prints, in this order: the path of `PRD.md`; the report page line, `Report page: <path>` or `Report page: not written`; the counts; the frameworks without patterns, when there are some; and the offer to save the PRD, when `$OUT` is the default.';

describe('excavator-prd-report skill: the report page', () => {
  it('writes report.html after assemble, in Phase 3, and before the reply of Phase 4', () => {
    const verify = phase.get(3);
    const assemble = verify.indexOf(`node ${PRD} assemble "$OUT"`);
    const page = verify.indexOf(PAGE_COMMAND);
    expect(assemble).toBeGreaterThan(-1);
    expect(page).toBeGreaterThan(assemble);
    expect(flat(skill).split(PAGE_COMMAND)).toHaveLength(2);
    expect(phase.get(4)).not.toContain(PAGE_COMMAND);
    expect(skill.indexOf(PAGE_COMMAND)).toBeLessThan(skill.indexOf(REPLY_COMMAND));
  });

  it('says what a failed page step means: tell the reason, make no page by hand, still reply', () => {
    const verify = phase.get(3);
    expect(verify).toContain(PAGE_FAILURE);
    expect(verify).toContain(PAGE_PROGRESS);
    expect(verify).toContain('a failed `page` removes the page an earlier run left.');
    expect(verify.indexOf(PAGE_FAILURE)).toBeGreaterThan(verify.indexOf(PAGE_COMMAND));
  });

  it('lists report.html in the product directory and the --out option', () => {
    expect(flat(before)).toContain('| `report.html` | `prd.mjs page` |');
    expect(before).toContain('`--out <dir>` — where the run\'s files, the PRD and the report page go');
  });

  it('lists the reply lines in order, the report page line second', () => {
    expect(flat(skill.slice(skill.indexOf('2. **Save and reply.**')))).toContain(REPLY_ORDER);
  });
});

describe('excavator-prd-report skill: the language of what it writes', () => {
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
const REPLY_COMMAND = 'node "$PLUGIN_ROOT/skills/excavator-prd-report/prd.mjs" reply "$OUT" --project "$PROJECT_ROOT"';
const REPLY_RULE = [
  'When it prints `PRD.md: missing`, run `assemble` (Phase 3) and then this command again; when it exits 1 with another line, show the lines and stop.',
  'Reply with exactly the lines it prints and nothing else: the same lines in the same order, none added and none left out.',
  'Write nothing before, between or after them, no word on the checks, the PRD or what was done, and no summary or notes.',
  'A project file\'s rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.',
  'When `$LANGUAGE` is not English, translate the words of those lines; the paths, the numbers and the framework names stay as they are.',
].join(' ');

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

describe('excavator-prd-report skill: the reply', () => {
  const save = skill.slice(skill.indexOf('2. **Save and reply.**'));

  it('keeps the PRD in $OUT and only offers to save it in the project', () => {
    expect(flat(save)).toContain(`2. **Save and reply.** ${SAVE}`);
    expect(skill).not.toContain('Offer to write the PRD to the project');
  });

  it('ends with the reply command, and the reply is exactly the lines it prints', () => {
    expect(skill.trimEnd().endsWith(`${REPLY_COMMAND}\n\`\`\`\n\n${REPLY_RULE}`)).toBe(true);
    expect(flat(save)).toContain(`${LANGUAGE_RULE} ${REPLY}: \`\`\`bash ${REPLY_COMMAND} \`\`\``);
  });

  it('holds no printf of the reply lines and no field for the model to fill in', () => {
    expect(phase.get(4)).not.toContain('printf');
    for (const words of ['features written', 'technical findings, anchors checked', 'No entrypoint patterns for', 'To save it in the project', '<prdPath>', '<uncovered>', '<outIsDefault>']) {
      expect(skill, words).not.toContain(words);
    }
  });
});

/** The ranking rubric of openspec change prd-report-finding-priority (design D3), as the skill hands it to every ranking subagent. */
const RUBRIC = [
  '- P0 — the defect lets someone do what they are not allowed to (pass an authentication or permission check meant to stop them, read or change another user\'s data, see a secret), loses or corrupts stored data, produces a wrong amount of money, or makes a main flow of the feature fail for every user.',
  '- P1 — the defect gives users a wrong, inconsistent or missing result in a flow they use, hides a failure from users or operators (an error swallowed, success reported after a failure), or fails on ordinary input.',
  '- P2 — any other defect: a value fixed in code, dead or duplicated code, inconsistent naming, gaps in logging or documentation.',
  'Give the highest level whose condition the evidence shows. When the evidence does not show it (for example, it is not evident that an outsider can reach the endpoint), give the lower level and say in the reason what is not evident.',
];
const NEVER_RANK = 'Never write or edit `priorities/<id>.json` yourself.';
/** The ranking subagent's prompt: the four-backtick text block of Phase 3. */
const rankPrompt = (rawPhase(3).match(/^````text\n([\s\S]*?)\n````$/m) ?? [])[1] ?? '';
/** Phase 3 from its "Rank the findings" step to the next numbered step. */
const rankStep = () => {
  const text = rawPhase(3);
  const start = text.indexOf('Rank the findings');
  const end = text.indexOf('Write `$OUT/overview.md`', start);
  return start < 0 ? '' : flat(text.slice(start, end < 0 ? undefined : end));
};

describe('excavator-prd-report skill: ranking the findings', () => {
  it('has the rank step after the verification of the chapters and before the overview', () => {
    const verify = phase.get(3);
    const verified = verify.indexOf('Verify each listed chapter yourself');
    const ranked = verify.indexOf('Rank the findings');
    const overview = verify.indexOf('Write `$OUT/overview.md`');
    expect(verified).toBeGreaterThan(-1);
    expect(ranked).toBeGreaterThan(verified);
    expect(ranked).toBeGreaterThan(verify.indexOf('`$OUT/verification/<id>.txt`'));
    expect(overview).toBeGreaterThan(ranked);
    expect(verify.indexOf(`node ${PRD} assemble "$OUT"`)).toBeGreaterThan(ranked);
  });

  it('runs aggregate and then check-priorities with --project, before any ranking subagent', () => {
    const step = rankStep();
    expect(step).not.toBe('');
    const aggregate = step.indexOf(`node ${PRD} aggregate "$OUT" --project "$PROJECT_ROOT"`);
    const check = step.indexOf(`node ${PRD} check-priorities "$OUT" --project "$PROJECT_ROOT"`);
    expect(aggregate).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(aggregate);
    expect(check).toBeLessThan(step.indexOf('batch N:'));
    expect(step).toContain('for each `batch N:` line it printed, dispatch one ranking subagent');
  });

  it('dispatches the ranking subagents in the foreground, at most $CONCURRENCY in one message, never in the background', () => {
    const step = rankStep();
    expect(step).toContain('at most `$CONCURRENCY` in one message');
    expect(step).toContain('in the foreground');
    expect(step).toContain('never in the background');
  });

  it('hands every ranking subagent the rubric verbatim', () => {
    expect(rankPrompt).not.toBe('');
    for (const line of RUBRIC) {
      expect(skill, line).toContain(line);
      expect(rankPrompt, line).toContain(line);
    }
  });

  it('confines the ranking subagent to the findings files and their evidence, and one output per feature in the D4 shape', () => {
    const prompt = flat(rankPrompt);
    for (const rule of [
      '$OUT/findings/<id>.json',
      'Read only these files',
      'a few dozen lines around',
      'Read code only; never run, build or change anything in the project.',
      '$OUT/priorities/<id>.json',
      '`{"priorities": [{"id": "<finding id>", "priority": "P0", "reason": "<one sentence>"}]}`',
      'one entry for each finding',
      'Write only',
      'one sentence in `$LANGUAGE`',
      'at most 300 characters',
      'which criterion the evidence meets and who is affected',
      'Reply with one line',
    ]) expect(prompt, rule).toContain(rule);
  });

  it('asks the ranker to name the code a P0 or P1 criterion needs, and to give the lower level without it', () => {
    const prompt = flat(rankPrompt);
    for (const rule of [
      'Before you give P0 or P1, find in the code what its criterion needs, and name it in the reason',
      'the check that is meant to stop this caller, and the route by which the caller reaches the code',
      'the route, page, client or job by which users reach the flow',
      'the result the user or operator gets',
      'so a route with no caller in the project is still reached.',
      'A failure that a recovery handler or error middleware turns into an error response still fails for the user.',
      'When that code is not there (no check exists to pass, no registered route or other entry reaches the code, the result the user gets is right), give the lower level.',
      'A reason that names no criterion of its level gives the lower level.',
      'search the project for the route, page, client or job that calls it',
    ]) expect(prompt, rule).toContain(rule);
  });

  it('names in the ranking prompt every English word the advice gate refuses', () => {
    const prompt = rankPrompt.toLowerCase();
    for (const word of ADVICE_WORDS.filter((w) => /^[\x00-\x7f]+$/.test(w))) expect(prompt, word).toContain(word);
  });

  it('keeps the lane prompt free of severity', () => {
    expect(flat(lanePrompt)).toContain('Give no severity and no confidence.');
  });

  it('never writes or edits a priorities file itself, and says so where the files are listed', () => {
    expect(rankStep()).toContain(NEVER_RANK);
    expect(flat(skill)).toContain('| `priorities/<id>.json` | the ranking subagent');
  });

  it('retries a feature that still fails once alone with its problem lines, then leaves it unranked and says so', () => {
    const step = rankStep();
    expect(step).toContain('rm -f "$OUT/priorities/<id>.json"');
    expect(step).toContain('alone');
    expect(step).toContain('Your previous attempt failed these checks; fix them and write the file again:');
    expect(step).toContain('`Rank <id>: unranked`');
    expect(step).toContain('`Rank: <n> features ranked, <m> unranked`');
    expect(step.indexOf('Run `check-priorities` a last time')).toBeGreaterThan(step.indexOf('`Rank <id>: unranked`'));
  });

  it('does not rank a feature again that already has a passing file, and gives an older output directory only the later steps', () => {
    const setup = phase.get(0);
    expect(setup).toContain('Features whose `priorities/<id>.json` passes `check-priorities` are not ranked again');
    expect(setup).toContain('an output directory with verified chapters and no `priorities/` only gets the ranking step and the steps after it');
    expect(rankStep()).toContain('not ranked again');
  });
});
