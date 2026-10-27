/**
 * The excavator-prd-report skill is a prompt; its rules only hold if each one sits in
 * the phase where the model acts on it. These tests pin the target state of
 * the openspec change prd-feature-pipeline (design O2): five phases, the
 * language of everything the skill writes to the user, the defaults, the
 * resume rule, the scripts that check the index before any lane and each lane
 * after it returns, and a reply printed from the fields `aggregate` prints.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TABLE_FILES, reportPath, verificationPath } from '../../skills/excavator-prd-report/lib/aggregate.mjs';
import { INDEX_FORMAT, PREVIOUS_INDEX_FORMAT } from '../../skills/excavator-prd-report/lib/index-check.mjs';
import { ADVICE_WORDS, chapterPath, findingsPath } from '../../skills/excavator-prd-report/lib/lane-check.mjs';
import { makeLaneRun, makeSkeletonRun, runPrd } from './excavator-prd-report/helpers.mjs';

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
/** The line check-index prints for an index without a proper list of actors (design D12). */
const ACTORS_LINE = 'index: actors must list each actor of the project once';
const VERIFY = 'follow the procedure in `$PLUGIN_ROOT/skills/excavator-verify/SKILL.md` on it with `--fix --no-summary`, `--language` set to `$LANGUAGE` and `PROJECT_ROOT` as the project path';

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
    expect(lanes).toContain('leave the feature `failed` at `check-lane`');
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
    expect(phase.get(2)).toContain('Pass every line `check-lane` printed, including the findings lines, except the `Next:` line.');
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
    expect(new Set(reading.map((line) => line.split(' ')[2]))).toEqual(new Set(['check-index', 'check-lane', 'check-priorities', 'check-open-items', 'mark', 'aggregate', 'assemble', 'page', 'reply']));
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
    actors: ['customer', 'Payment service'],
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
      expect(index.actors).toEqual(['customer', 'Payment service']);
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

  it('lets check-index refuse a plan that lists no actors, with the line the skill quotes', () => {
    const { actors, ...withoutActors } = PLAN;
    expect(actors).toHaveLength(2);
    for (const plan of [withoutActors, { ...PLAN, actors: [] }, { ...PLAN, actors: ['customer', 'customer'] }]) {
      const { out, check } = buildIndex(plan);
      try {
        expect(check.status).toBe(1);
        expect(check.stdout.split('\n').filter(Boolean)).toEqual([ACTORS_LINE]);
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
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

  it('writes the overview and counts the scope by command', () => {
    const verify = phase.get(3);
    expect(verify).toContain('`$OUT/overview.md`');
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
const REPLY_ORDER = '`reply` prints, in this order: the path of `PRD.md`; the report page line, `Report page: <path>` or `Report page: not written`; the counts; the `Retry:` line, when a feature failed after one attempt, `Retry: <ids> failed after one attempt; running the command again without --fresh retries them`; the frameworks without patterns, when there are some; and the offer to save the PRD, when `$OUT` is the default.';

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
  const end = text.indexOf('Merge the open items', start);
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

/** The merge subagent's prompt: the second four-backtick text block of Phase 3 (the first is the ranking prompt). */
const mergePrompt = () => [...rawPhase(3).matchAll(/^````text\n([\s\S]*?)\n````$/gm)].map((m) => m[1])[1] ?? '';
/** Phase 3 from its "Merge the open items" step to the overview step. */
const mergeStep = () => {
  const text = rawPhase(3);
  const start = text.indexOf('Merge the open items');
  const end = text.indexOf('Write `$OUT/overview.md`', start);
  return start < 0 ? '' : flat(text.slice(start, end < 0 ? undefined : end));
};
const NEVER_MERGE = 'In this step you never group, merge or write an item, and never write or edit `open-items/merged.json`';
const withOpenItemsSection = (text, rows) => text.replace(/^chapter: (\d+)$/m, 'openItems: Open items\nchapter: $1')
  .concat(`\n### Open items\n\n| Item | What is known | What was searched |\n|---|---|---|\n${rows.join('\n')}\n`);

/** A lane run whose two chapters each have an open items table; F1.1 and F2.1 ask the same question. */
function openItemsRun() {
  const run = laneRun();
  run.writeText('features/F1.md', withOpenItemsSection(run.readText('features/F1.md'), [
    '| Whether refunds are paid | Not in the order code | the whole project |',
    '| Retention period | Not evident | `src/orders/service.js` |',
  ]));
  run.writeText('features/F2.md', withOpenItemsSection(run.readText('features/F2.md'), [
    '| Are refunds paid | A comment mentions them | `src/orders/service.js` |',
  ]));
  expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
  return run;
}
const checkOpenItems = (run) => runPrd(['check-open-items', run.out, '--project', run.project]);
/** A line the script printed, as the skill writes it: the counts of the status lines are `<n>` and `<m>`. */
const asQuoted = (line) => line.replace(/^(Open items: )\d+( written in the chapters)/, '$1<n>$2').replace(/, \d+ after merging$/, ', <m> after merging');

describe('excavator-prd-report skill: merging the open items (prd-report-dedupe, D6)', () => {
  it('numbers the steps of Phase 3 from 1 to 7, with the merge step after the ranking step and before the overview', () => {
    const numbers = [...rawPhase(3).matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const text = rawPhase(3);
    const rank = text.indexOf('4. Rank the findings.');
    const merge = text.indexOf('5. Merge the open items.');
    const overview = text.indexOf('6. Write `$OUT/overview.md`');
    const assemble = text.indexOf('7. Aggregate the lanes, assemble the PRD and write the report page');
    expect(rank).toBeGreaterThan(-1);
    expect(merge).toBeGreaterThan(text.indexOf('Reply with one line: `<ids of your features>: ranked`'));
    expect(overview).toBeGreaterThan(merge);
    expect(assemble).toBeGreaterThan(overview);
    expect(text.indexOf(`node ${PRD} assemble "$OUT"`)).toBeGreaterThan(merge);
  });

  it('explains the merge in a few sentences and says the orchestrator never groups, merges or writes anything', () => {
    const step = mergeStep();
    expect(step).not.toBe('');
    for (const rule of [
      'The same open question is often asked in several chapters',
      'one merge subagent groups the items that ask the same question, and the scripts check the groups and write one row per group in the Open items section',
      NEVER_MERGE,
      'Only the merge subagent writes it, the same rule as the lane files.',
    ]) expect(step, rule).toContain(rule);
  });

  it('runs aggregate and then check-open-items with --project, before any merge subagent', () => {
    const step = mergeStep();
    const aggregate = step.indexOf(`node ${PRD} aggregate "$OUT" --project "$PROJECT_ROOT"`);
    const check = step.indexOf(`node ${PRD} check-open-items "$OUT" --project "$PROJECT_ROOT"`);
    expect(aggregate).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(aggregate);
    expect(check).toBeLessThan(step.indexOf('dispatch one merge subagent'));
  });

  it('quotes the status lines and a problem line exactly as check-open-items prints them', () => {
    const run = openItemsRun();
    const unmerged = checkOpenItems(run);
    expect(unmerged.status).toBe(1);
    const [problem, notMerged] = lines(unmerged);
    expect(problem).toBe('open-items/merged.json is missing');
    expect(notMerged).toBe('Open items: 3 written in the chapters, not merged');
    run.writeJson('open-items/merged.json', { digest: run.readJson('open-items/sources.json').digest, groups: [{ keep: 'F1.1', also: ['F2.1'] }] });
    const merged = checkOpenItems(run);
    expect(merged.status).toBe(0);
    expect(lines(merged)).toEqual(['Open items: 3 written in the chapters, 2 after merging']);
    const bare = laneRun();
    const none = checkOpenItems(bare);
    expect(none.status).toBe(0);
    expect(lines(none)).toEqual(['Open items: none written in the chapters']);
    const step = mergeStep();
    for (const line of [asQuoted(merged.stdout.trim()), asQuoted(notMerged), none.stdout.trim()]) expect(step, line).toContain(`\`${line}\``);
    expect(step).toContain(`\`${problem}\``);
    expect(step).toContain('`Open items: <n> written in the chapters, <m> after merging`');
    expect(step).toContain('It exits 0 when the merge passes or there are fewer than two items');
    expect(step).toContain('then skip to telling the user the line');
  });

  it('dispatches one merge subagent when it exits 1, in the foreground, never in the background', () => {
    const step = mergeStep();
    expect(step).toContain('When it exits 1, dispatch one merge subagent with the prompt below');
    expect(step).toContain('in the foreground');
    expect(step).toContain('never in the background');
    expect(step).toContain('Write `$OUT` and `$LANGUAGE` in the prompt as their values.');
  });

  it('retries once with the problem lines under a fixed heading, deletes the file, and leaves the items unmerged without failing the run', () => {
    const step = mergeStep();
    expect(step).toContain('rm -f "$OUT/open-items/merged.json"');
    expect(step).toContain('Your previous attempt failed these checks; fix them and write the file again:');
    expect(step).toContain('each problem line it printed (not the status line)');
    expect(step.indexOf('Run `check-open-items` again')).toBeGreaterThan(step.indexOf('dispatch one merge subagent'));
    expect(step).toContain('each on its own row, and the coverage section says so');
    expect(step).toContain('This is not a failure of the run.');
    expect(step.indexOf('rm -f "$OUT/open-items/merged.json"')).toBeLessThan(step.indexOf('Your previous attempt failed these checks'));
  });

  it('tells the user the last line as printed, translated with the numbers unchanged', () => {
    const step = mergeStep();
    expect(step).toContain('Tell the user its last line as printed, translated into `$LANGUAGE` with the numbers unchanged.');
    expect(step.indexOf('Tell the user its last line')).toBeGreaterThan(step.indexOf('Your previous attempt failed these checks'));
  });

  it('keeps a passing merge on a resumed run and merges again only after a chapter changed', () => {
    expect(mergeStep()).toContain('`check-open-items` checks the digest, so after a chapter changed the merge is done again; a passing file is kept.');
    expect(phase.get(0)).toContain('A passing `open-items/merged.json` is kept; the merge is done again only when the open items changed.');
  });

  it('gives the merge subagent only sources.json to read, and the merged.json shape and rules', () => {
    const prompt = flat(mergePrompt());
    expect(prompt).not.toBe('');
    for (const rule of [
      'You merge the open items of an As-Is PRD.',
      'Read only `$OUT/open-items/sources.json`; read no other file and no code.',
      'an `id`, the `feature` that asked it, and `item`, `known`, `searched`',
      'Group the items that ask the same question: answering one answers the others.',
      'Items about the same subject that ask different things are not grouped.',
      'Items that share only a missing piece of evidence, such as nothing found in the code or a gateway or deployment that is not visible, ask different questions.',
      "When in doubt, leave the items apart: a missed merge costs one row, a wrong merge puts a question under another question's answer.",
      'Items in the same chapter can be grouped too.',
      'An item that matches no other is in no group.',
      'the item whose text says the most',
      'Its text is shown for the whole group, and the items of the others are listed under it.',
      'Write only `$OUT/open-items/merged.json`',
      '`{"digest": "<the digest of sources.json, copied>", "groups": [{"keep": "<id>", "also": ["<id>", ...]}]}`',
      'each id in at most one group, `also` non-empty, `keep` not in `also`, no other key',
      'Write no text of your own: no item, summary or reason.',
      '`"groups": []`',
      'Reply with one line: `Open items: merged`, and nothing else.',
    ]) expect(prompt, rule).toContain(rule);
    expect(prompt.match(/\$OUT\/[\w./<>-]+/g)).toEqual(['$OUT/open-items/sources.json', '$OUT/open-items/merged.json']);
  });

  it('keeps the shape the prompt names the one check-open-items accepts', () => {
    const run = openItemsRun();
    expect(checkOpenItems(run).status).toBe(1);
    const { digest } = run.readJson('open-items/sources.json');
    const prompt = mergePrompt();
    const shape = JSON.parse(prompt.match(/`(\{"digest": [^`]*\})`/)[1].replace('"<the digest of sources.json, copied>"', JSON.stringify(digest)).replace('"<id>", ...', '"F2.1"').replace(/"<id>"/, '"F1.1"'));
    run.writeJson('open-items/merged.json', shape);
    const out = checkOpenItems(run);
    expect(out.status, out.stdout).toBe(0);
  });

  it('lists open-items/ with its two files and who writes each', () => {
    const table = flat(before.slice(before.indexOf('| File | Written by |')));
    expect(table).toContain('| `open-items/sources.json` | `prd.mjs check-open-items` |');
    expect(table).toContain('| `open-items/merged.json` | the merge subagent |');
  });
});

// The wiring of openspec change prd-report-prd-shape (design D2 to D9): the skill asks the model for what the scripts now
// require. Where a pin quotes a string a script prints, the test gets the string by running the script on a synthetic run
// (or from the module that holds it), so the skill and the script cannot drift apart.
const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
const track = (run) => {
  cleanups.push(run.cleanup);
  return run;
};
const laneRun = () => track(makeLaneRun());
const checkLane = (run, id) => runPrd(['check-lane', run.out, '--project', run.project, id]);
const lines = (out) => out.stdout.split('\n').filter(Boolean);
const editChapter = (run, id, change) => run.writeText(`features/${id}.md`, change(run.readText(`features/${id}.md`)));
const asIndex = (run) => run.readIndex();

describe('excavator-prd-report skill: the structure a chapter declares (D3, D8)', () => {
  /** The front-matter the lane prompt asks for. */
  const template = (lanePrompt.match(/^ *```markdown\n([\s\S]*?\n *---)\n *```/m) ?? [])[1]?.replace(/^ +/gm, '') ?? '';
  const KEYS = ['id', 'name', 'kind', 'actors', 'permissionRoles', 'triggers', 'flows', 'openItems', 'chapter'];

  it('asks for actors, permissionRoles, flows and openItems, and no longer for roles', () => {
    expect(template).not.toBe('');
    expect([...template.matchAll(/^([A-Za-z]+):/gm)].map((m) => m[1])).toEqual(KEYS);
    expect(lanePrompt).not.toMatch(/(^|[^A-Za-z])roles:/);
    const prompt = flat(lanePrompt);
    for (const rule of [
      '`actors` and `permissionRoles` are two lists with no name in common',
      '`flows` holds the exact text of the `###` heading of each flow',
      'at least one flow for a `flow` or `automated` feature, none (`flows: []`) for a `reference` feature',
      '`openItems` is the text of the last `###` heading of the chapter, which holds its open items; leave the key out when the chapter has none',
    ]) expect(prompt, rule).toContain(rule);
  });

  it('is a front-matter check-lane accepts, and the script refuses the old roles key', () => {
    const run = laneRun();
    const value = {
      id: 'F1', name: 'Order placement', kind: 'flow', actors: '[customer]', permissionRoles: '[]',
      triggers: '\n  - A customer submits the order form', flows: '\n  - "Flow 1: Place an order"', openItems: 'Open items', chapter: '1',
    };
    expect(Object.keys(value)).toEqual(KEYS);
    const front = KEYS.map((key) => `${key}:${value[key].startsWith('\n') ? '' : ' '}${value[key]}`).join('\n');
    const body = run.readText('features/F1.md').split('\n---\n')[1];
    run.writeText('features/F1.md', `---\n${front}\n---\n${body}\n### Open items\n\n| Item | What is known | What was searched |\n|---|---|---|\n| x | y | the whole project |\n`);
    expect(lines(checkLane(run, 'F1'))).toEqual(['F1: ok']);
    editChapter(run, 'F1', (text) => text.replace('chapter: 1', 'roles: [customer]\nchapter: 1'));
    const refused = checkLane(run, 'F1');
    expect(refused.status).toBe(1);
    expect(lines(refused)).toContain('F1: front-matter roles is no longer read; write actors and permissionRoles');
  });

  it('says the chapter has one ## heading, the first one, which the script enforces', () => {
    expect(flat(lanePrompt)).toContain('The chapter has exactly one `##` heading, the first one: `## <name>`');
    const run = laneRun();
    editChapter(run, 'F1', (text) => `${text}\n## A second chapter\n`);
    const out = checkLane(run, 'F1');
    expect(out.status).toBe(1);
    expect(lines(out)).toContain('F1: the chapter has 2 ## headings; it has one, ## Order placement, as its first heading');
  });

  // Change prd-report-dedupe, design D2, D3: the prompt quotes the two lines check-lane prints, and no longer asks for a permissions table per feature.
  it('quotes the two check lines of the new chapter shape exactly as check-lane prints them', () => {
    const run = laneRun();
    editChapter(run, 'F1', (text) => text
      .replace('chapter: 1', 'openItems: Open items\nchapter: 1')
      .replace('<details>', '### Permissions\n\nWho may place an order.\n\n<details>')
      .concat('\n### Open items\n\n- Refund rule: unknown.\n'));
    const out = checkLane(run, 'F1');
    expect(out.status).toBe(1);
    const printed = lines(out).filter((line) => line.startsWith('F1: ')).map((line) => line.slice('F1: '.length));
    expect(printed).toHaveLength(2);
    const prompt = flat(lanePrompt);
    for (const line of printed) expect(prompt, line).toContain(line);
    expect(printed[0]).toBe('### "Permissions" is neither a listed flow nor the open items heading; a flow chapter holds only its flows and its open items');
    expect(printed[1]).toBe('the open items section is not one table of three columns (item, what is known, what was searched)');
  });

  it('puts the role matrix, the dictionaries and shared settings in the reference chapter, and asks each flow only for who starts it and what each role sees', () => {
    const prompt = flat(lanePrompt);
    expect(prompt).not.toContain('a role-by-capability table for the feature');
    for (const rule of [
      'in each flow, which roles may start it and what each sees',
      'the role × capability matrix, the dictionary tables and the settings several flows share belong to the `reference` chapter of this PRD (a feature of kind `reference` in the list of other features); a flow chapter names that chapter instead of repeating them',
      'In a `flow` or `automated` chapter every `###` section is one flow listed in `flows`, except the last one, the open items section',
      'The text under `## <name>` before the first `###` is the chapter\'s introduction: the feature\'s flowchart, a short overview and the hand-overs to other features',
      'A section that is not a flow (overview, permissions, dictionary, configuration) fails the check',
      'an overview, a configuration, a permissions or a findings section is not a flow',
      'The open items section holds one table of three columns — the item, what is known, what was searched — with its header in `$LANGUAGE` and nothing else',
    ]) expect(prompt, rule).toContain(rule);
  });

  it('says what a reference chapter holds and that flow chapters refer to it', () => {
    const prompt = flat(lanePrompt);
    for (const rule of [
      'A `reference` chapter holds the dictionary tables (value | meaning), a role × capability matrix, the decision procedure and one diagram',
      'A flow chapter refers to a `reference` chapter by name instead of repeating it',
      'The other features of this PRD, which other lanes write: <id, name and kind of every other feature, one per line>',
    ]) expect(prompt, rule).toContain(rule);
  });

  it('writes the Frontend and hand-over parts from the callers outside the scope that the seed files hold', () => {
    expect(flat(lanePrompt)).toContain('When your seed files hold callers outside the scope (pages and clients that send the request, other services that call it), write the Frontend and hand-over parts from them');
  });

  it('cites only files inside the project root, and the script refuses a dependency directory', () => {
    const prompt = flat(lanePrompt);
    for (const rule of [
      'Cite only files inside the project root.',
      'Code outside the project (dependency caches, the standard library, installed packages) is never evidence',
      'describe a dependency\'s behaviour from the project\'s own code and config, or write it as an open item',
      'A path under `node_modules`, `vendor` or another dependency or build directory fails the check.',
    ]) expect(prompt, rule).toContain(rule);
    const run = laneRun();
    editChapter(run, 'F1', (text) => text.replace('- Order route —', '- Dependency — `node_modules/pkg/index.js:1`\n- Order route —'));
    const out = checkLane(run, 'F1');
    expect(out.status).toBe(1);
    expect(lines(out).some((line) => line.startsWith('F1: anchor node_modules/pkg/index.js:1: the path is under node_modules, a directory name the entrypoint scan skips as dependencies'))).toBe(true);
  });
});

describe('excavator-prd-report skill: the shared models and the callers outside the scope (D2, D7)', () => {
  it('has a reference feature for the permission model, named Roles and permissions, with the lowest chapter numbers', () => {
    const index = phase.get(1);
    for (const rule of [
      'When the scope has a permission model (roles, policies, guards), make a feature with `kind: "reference"` named `Roles and permissions`, translated into `$LANGUAGE`.',
      'Its `seedFiles` are the files that define the roles, statuses, policies and guards; its `entrypoints` may be empty, and `seedFiles` is required.',
      'Treat any other model that several flows share (a token or session model, a shared status dictionary) the same way.',
      'Reference features take the lowest chapter numbers',
    ]) expect(index, rule).toContain(rule);
  });

  it('agrees with check-index: a reference feature has no entrypoints, and comes before every flow chapter', () => {
    const run = track(makeSkeletonRun());
    const ok = runPrd(['check-index', run.out, '--project', run.project]);
    expect(ok.status, ok.stdout).toBe(0);
    const index = asIndex(run);
    index.features.find((f) => f.id === 'F3').chapter = 5;
    run.writeIndex(index);
    const late = runPrd(['check-index', run.out, '--project', run.project]);
    expect(late.status).toBe(1);
    expect(lines(late).some((line) => /^F3: reference chapter 5 comes after flow chapter \d$/.test(line))).toBe(true);
    expect(phase.get(1)).toContain('`check-index` refuses a `reference` chapter that comes after a `flow` or `automated` chapter');
  });

  it('searches outside a subdirectory scope for the callers of every entrypoint and adds their files to the seed files', () => {
    const index = phase.get(1);
    for (const rule of [
      'When `--scope` names a subdirectory, search outside the scope for the callers of every entrypoint in scope: the pages and clients that send the request, and the other services that call it.',
      'Add the files that hold them to that feature\'s `seedFiles`; only those files, not what they import.',
      'Their own flows stay out of scope: they get no feature and no candidate.',
    ]) expect(index, rule).toContain(rule);
  });

  it('agrees with the scripts: such a seed file passes check-index and shows in the coverage count', () => {
    const run = laneRun();
    const index = asIndex(run);
    index.scope = 'src/orders';
    index.features[0].seedFiles = ['src/orders/routes.js', 'web/src/OrderForm.tsx'];
    run.writeIndex(index);
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
    expect(run.readText('tables/coverage.md')).toContain('Seed files read outside the scope: web 1.');
  });
});

describe('excavator-prd-report skill: a lane that is dispatched again, and the Next line (D6)', () => {
  it('deletes all four files of the earlier attempt before it dispatches a lane again', () => {
    const paths = [chapterPath('<id>'), findingsPath('<id>'), verificationPath('<id>'), reportPath('<id>')];
    expect(paths).toEqual(['features/<id>.md', 'findings/<id>.json', 'verification/<id>.txt', 'verification/<id>.md']);
    const command = `rm -f ${paths.map((path) => `"$OUT/${path}"`).join(' ')}`;
    expect(phase.get(2)).toContain(`Before you dispatch a lane again, delete the files its earlier attempt left (\`${command}\`).`);
    expect(phase.get(2)).not.toContain('"$OUT/findings/<id>.json"`)');
  });

  /** The two Next lines as check-lane prints them, with the feature id written as <id>. */
  function nextLines() {
    const lineAt = (attempts) => {
      const run = laneRun();
      const index = asIndex(run);
      index.features[0].attempts = attempts;
      run.writeIndex(index);
      editChapter(run, 'F1', (text) => text.replace('```mermaid', '```text'));
      const out = checkLane(run, 'F1');
      expect(out.status).toBe(1);
      return lines(out).at(-1).replaceAll('F1', '<id>');
    };
    return { again: lineAt(1), stays: lineAt(2) };
  }

  it('quotes both Next lines as check-lane prints them, and has the orchestrator follow them', () => {
    const { again, stays } = nextLines();
    expect(again).toMatch(/^Next: delete <id>'s files, mark it dispatched and re-dispatch it once/);
    expect(stays).toMatch(/^Next: <id> stays failed/);
    const lanes = phase.get(2);
    const checked = lanes.indexOf(`node ${PRD} check-lane "$OUT" <id>`);
    expect(checked).toBeGreaterThan(-1);
    for (const line of [again, stays]) {
      expect(lanes, line).toContain(`\`${line}\``);
      expect(lanes.indexOf(`\`${line}\``)).toBeGreaterThan(checked);
    }
    expect(lanes).toContain('The last line it prints is a `Next:` line. Follow it:');
    expect(lanes).toContain(`\`${again}\`: delete the lane's files (as in step 1), mark the dispatch (as in step 2) and re-dispatch the lane once`);
    expect(lanes).toContain(`\`${stays}\`: leave the feature \`failed\``);
  });

  it('prints the Next line for a lane that wrote nothing as well, and the skill still records that failure with mark', () => {
    const run = laneRun();
    rmSync(join(run.out, 'findings/F1.json'));
    const out = checkLane(run, 'F1');
    expect(out.status).toBe(1);
    expect(lines(out)[0]).toMatch(/^F1: lane-wrote-nothing: /);
    expect(lines(out).at(-1)).toMatch(/^Next: /);
    const lanes = phase.get(2);
    expect(lanes).toContain('`lane-wrote-nothing`');
    expect(lanes).toContain(`node ${PRD} mark "$OUT" <id> failed lane lane-wrote-nothing`);
  });
});

describe('excavator-prd-report skill: verification, overview and reply (D4, D5, D6)', () => {
  it('verifies each chapter with --fix --no-summary, a flag excavator-verify documents', () => {
    expect(phase.get(3)).toContain(VERIFY);
    expect(phase.get(3)).toContain('The chapter keeps its one `##` heading and gets no verification summary; `aggregate` fails a feature whose verified chapter has another `##` heading.');
    const verifySkill = readFileSync(resolve(repoRoot, 'skills/excavator-verify/SKILL.md'), 'utf-8');
    expect(verifySkill).toContain('`--no-summary` — with `--fix`, do not append the verification summary to the document');
  });

  it('leaves the glossary, roles, flow list and open items out of the overview, because the scripts generate them', () => {
    const step = rawPhase(3).slice(rawPhase(3).indexOf('Write `$OUT/overview.md`'));
    const overview = flat(step.slice(0, step.indexOf('Scope size is counted by command')));
    for (const rule of [
      'a title (`# <project or product name>`) on its first line',
      'the purpose and the capability map: a short product summary, one table of the consumers of the product, and one mermaid capability diagram',
      'and an overview of the automated behavior',
      'It MUST NOT hold the glossary, the roles, a list of the flows or the open items: `aggregate` and `assemble` generate the Terminology, Flow index, Roles and Open items sections.',
    ]) expect(overview, rule).toContain(rule);
    expect(overview).not.toContain('and the glossary as a list');
    expect(overview).not.toContain('Put no table');
  });

  it('quotes the lines assemble prints for an overview without a # heading, without a mermaid block or ending in an open fence', () => {
    const refused = (overview) => {
      const run = laneRun();
      expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
      expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
      run.writeText('overview.md', overview);
      const out = runPrd(['assemble', run.out, '--project', run.project]);
      expect(out.status).toBe(1);
      return lines(out);
    };
    const [heading] = refused('No title.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');
    const [diagram] = refused('# Orders\n\nNo map.\n');
    const [fence] = refused('# Orders\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```text\nnever closed\n');
    expect(phase.get(3)).toContain(`\`${heading}\``);
    expect(phase.get(3)).toContain(`\`${diagram}\``);
    expect(phase.get(3)).toContain(`\`${fence}\``);
    expect(phase.get(3)).toContain('`assemble` exits 1 and prints one of these lines when the overview does not start with a `#` heading, has no mermaid block or ends inside an open code fence');
  });

  it('names the sections of PRD.md in the order assemble writes them, and the tables aggregate writes', () => {
    const run = track(makeSkeletonRun());
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
    const made = runPrd(['assemble', run.out, '--project', run.project]);
    expect(made.status, made.stdout).toBe(0);
    const generated = ['Terminology', 'Flow index', 'Roles', 'Open items', 'Appendix'];
    const headings = [...readFileSync(join(run.out, 'PRD.md'), 'utf-8').matchAll(/^## (.*)$/gm)].map((m) => m[1]);
    expect(headings.filter((h) => generated.includes(h))).toEqual(['Terminology', 'Flow index', 'Roles', 'Open items', 'Appendix']);
    const sections = flat(before.slice(before.indexOf('`PRD.md` holds')));
    expect(sections).toContain('`PRD.md` holds, in this order: the overview, `## Terminology`, `## Flow index`, `## Roles`, the `reference` chapters, the other chapters in chapter order, `## Open items` and `## Appendix`.');
    expect(TABLE_FILES).toEqual(['tables/terminology.md', 'tables/roles.md', 'tables/open-items.md', 'tables/coverage.md', 'tables/verification.md']);
    expect(before).toContain(`| \`findings.json\`, ${TABLE_FILES.map((table) => `\`${table}\``).join(', ')} | \`prd.mjs aggregate\` |`);
    expect(before).not.toContain('roles-by-feature');
    expect(before).not.toContain('`tables/*.md`');
  });

  it('prints the Retry line in the reply and describes it as the script prints it', () => {
    const run = laneRun();
    const findings = run.readJson('findings/F2.json');
    findings.findings[0].statement = 'The route should check the quantity.';
    run.writeJson('findings/F2.json', findings);
    expect(runPrd(['mark', run.out, 'F2', 'dispatched', '--project', run.project]).status).toBe(0);
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
    expect(runPrd(['assemble', run.out, '--project', run.project]).status).toBe(0);
    const reply = lines(runPrd(['reply', run.out, '--project', run.project]));
    const retry = reply.find((line) => line.startsWith('Retry:'));
    expect(retry).toBe('Retry: F2 failed after one attempt; running the command again without --fresh retries them');
    const quoted = retry.replace('F2', '<ids>');
    const save = flat(skill.slice(skill.indexOf('2. **Save and reply.**')));
    expect(save).toContain(`\`${quoted}\``);
    expect(save).toContain('`Retry:` line, when a feature failed after one attempt');
    expect(reply.indexOf(retry)).toBe(6);
  });
});

describe('excavator-prd-report skill: an index of the earlier format (D9)', () => {
  it('stops and tells the user to run again with --fresh when a command prints the earlier-format line', () => {
    const run = laneRun();
    const index = asIndex(run);
    index.format = PREVIOUS_INDEX_FORMAT;
    run.writeIndex(index);
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    const line = lines(out)[0];
    expect(line).toBe(`index: ${run.out} was written by an earlier version (${PREVIOUS_INDEX_FORMAT}); run again with --fresh`);
    const quoted = line.replace(run.out, '<out>');
    const setup = phase.get(0);
    expect(setup).toContain(`When a \`prd.mjs\` command prints \`${quoted}\`, tell the user to run again with \`--fresh\`, and stop; never repair that index; the next sentence is for every other failure.`);
    expect(setup.indexOf(quoted)).toBeLessThan(setup.indexOf('When `check-index` exits 1, fix the index'));
  });

  it('lets --fresh delete an output directory of either format', () => {
    expect(phase.get(0)).toContain(`holds an \`index.json\` with \`"format": "${PREVIOUS_INDEX_FORMAT}"\` or \`"format": "${INDEX_FORMAT}"\``);
  });
});

// Change prd-report-prd-shape, design D12: the actors of the PRD are named once, in the index.
describe('excavator-prd-report skill: the actors of the PRD (D12)', () => {
  it('has the orchestrator write each real actor once in Phase 1c, into the actors of plan.json', () => {
    const index = phase.get(1);
    for (const rule of [
      'Name the actors of the project: each real actor once',
      'the user categories, the external systems, the other services and the operators',
      'named as the product names them, with no name twice',
      'Write them as `actors` in `plan.json`',
      'every chapter takes its actors from this list',
    ]) expect(index, rule).toContain(rule);
    expect(index.indexOf('### 1d.')).toBeGreaterThan(index.indexOf('Name the actors of the project'));
  });

  it('shows actors in the plan.json example, and the jq that builds the index carries them over', () => {
    const plan = rawPhase(1).match(/Write `\$OUT\/plan\.json`:\n\n```json\n([\s\S]*?)```/)?.[1] ?? '';
    expect(plan).toContain('"actors": ["..."]');
    const [build] = recipes(1, 'jq -n ', '/out', '/project');
    expect(build).toContain('actors: $p.actors');
  });

  it('says check-index refuses a missing, empty or repeating list, with the line the script prints', () => {
    const run = laneRun();
    const index = asIndex(run);
    delete index.actors;
    run.writeIndex(index);
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    expect(lines(out)).toEqual([ACTORS_LINE]);
    expect(phase.get(1)).toContain(`\`check-index\` exits 1 and prints \`${ACTORS_LINE}\` when \`actors\` is missing, empty, holds an empty name or names an actor twice`);
  });

  it('gives each lane the list, and lets the front-matter actors take only names from it, spelled exactly', () => {
    const prompt = flat(lanePrompt);
    for (const rule of [
      'The actors of this PRD: <index actors, one per line>.',
      'actors: [<each actor of that list that starts or takes part in a flow>]',
      '`actors` takes only names from the list of the actors of this PRD, spelled exactly as listed',
    ]) expect(prompt, rule).toContain(rule);
    expect(prompt.indexOf('The actors of this PRD:')).toBeLessThan(prompt.indexOf('**As-Is only.**'));
  });

  it('agrees with check-lane: a name outside the list fails, one from it passes', () => {
    const run = laneRun();
    editChapter(run, 'F1', (text) => text.replace('actors: [customer]', 'actors: [customer, Auditor]'));
    const refused = checkLane(run, 'F1');
    expect(refused.status).toBe(1);
    expect(lines(refused)).toContain('F1: actor "Auditor" is not one of the index\'s actors');
    editChapter(run, 'F1', (text) => text.replace('actors: [customer, Auditor]', 'actors: [customer, support agent]'));
    expect(lines(checkLane(run, 'F1'))).toEqual(['F1: ok']);
  });

  it('lists in flows only flows, and keeps findings out of the chapter', () => {
    const prompt = flat(lanePrompt);
    for (const rule of [
      '`flows` lists only flows, each a path from one trigger to one outcome; an overview, a configuration, a permissions or a findings section is not a flow.',
      'The findings go only in the findings file: the chapter has no findings section and does not mention the findings file.',
    ]) expect(prompt, rule).toContain(rule);
  });
});
