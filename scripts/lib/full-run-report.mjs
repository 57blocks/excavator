/**
 * Fixed-basis report of one headless Full run, read from its
 * `claude -p --output-format stream-json --verbose` record.
 *
 * Every cost and token figure is a value the record reports itself; nothing
 * is priced from tokens. Ratios per file or node are labelled derived. Input
 * the record does not carry is listed under `missing`, never read as zero.
 *
 * Contract: openspec/changes/full-run-measurement/specs/full-run-measurement/spec.md
 */

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

export const REPORT_SCHEMA = 'excavator-full-run-report/1';

/** Phase start markers, in pipeline order (design D2). */
const PHASE_MARKERS = [
  { phase: 'F1', pattern: /lazy-analyze\.mjs/ },
  { phase: 'F2', pattern: /select-stale-semantics\.mjs/ },
  { phase: 'F3', pattern: /semantic-graph\.mjs/ },
  { phase: 'F4', pattern: /apply-verification\.mjs[\s\S]*?\b(?:prepare-semantic|skip-semantic)\b/ },
];
/** F5 starts when the last command that closes F4 returns. */
const F4_CLOSE = /apply-verification\.mjs[\s\S]*?\b(?:apply-semantic|skip-semantic)\b/;
const PHASES = ['setup', 'F1', 'F2', 'F3', 'F4', 'F5'];
const DISPATCH_TOOLS = new Set(['Agent', 'Task']);

/** One JSON event per line; a line that does not parse is counted, not fatal. */
export function parseRunRecord(text) {
  const events = [];
  let malformedLines = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      malformedLines++;
    }
  }
  return { events, malformedLines };
}

function toolUses(event) {
  const content = event?.message?.content;
  return Array.isArray(content) ? content.filter((block) => block?.type === 'tool_use') : [];
}

function toolResultIds(event) {
  const content = event?.message?.content;
  return Array.isArray(content)
    ? content.filter((block) => block?.type === 'tool_result').map((block) => block.tool_use_id)
    : [];
}

function inputSide(usage) {
  return {
    input: usage?.input_tokens ?? 0,
    cacheCreation: usage?.cache_creation_input_tokens ?? 0,
    cacheRead: usage?.cache_read_input_tokens ?? 0,
  };
}

function addInto(target, source) {
  for (const key of Object.keys(source)) target[key] = (target[key] ?? 0) + source[key];
  return target;
}

/** Model calls, one per message id: a message split into content blocks repeats its usage on every block. */
function modelCalls(events) {
  const calls = new Map();
  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const id = event.message?.id ?? event.uuid;
    if (calls.has(id)) continue;
    calls.set(id, { parent: event.parent_tool_use_id ?? null, ...inputSide(event.message?.usage) });
  }
  return [...calls.values()];
}

function summarizeTotals(events, missing) {
  const results = events.filter((event) => event.type === 'result');
  const stamps = events.map((event) => Date.parse(event.timestamp)).filter(Number.isFinite);
  const init = events.find((event) => event.type === 'system' && event.subtype === 'init');
  const totals = {
    cliVersion: init?.claude_code_version ?? null,
    initModel: init?.model ?? null,
    resultEvents: results.length,
    costUsd: null,
    models: null,
    numTurns: null,
    anyError: null,
    resultSubtypes: [...new Set(results.map((result) => result.subtype))],
    firstTimestamp: stamps.length ? new Date(Math.min(...stamps)).toISOString() : null,
    lastTimestamp: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
    wallMs: stamps.length ? Math.max(...stamps) - Math.min(...stamps) : null,
  };
  if (!init) missing.push('init');
  if (!stamps.length) missing.push('timestamps');
  if (!results.length) {
    missing.push('result');
    return totals;
  }
  // Cost and modelUsage accumulate across results; turns are counted per result.
  const last = results.at(-1);
  totals.costUsd = typeof last.total_cost_usd === 'number' ? last.total_cost_usd : null;
  if (totals.costUsd === null) missing.push('result:total_cost_usd');
  totals.models = last.modelUsage ?? null;
  if (totals.models === null) missing.push('result:modelUsage');
  totals.numTurns = results.reduce((sum, result) => sum + (result.num_turns ?? 0), 0);
  totals.anyError = results.some((result) => result.is_error === true);
  return totals;
}

const MODEL_USAGE_FIELDS = { input: 'inputTokens', cacheCreation: 'cacheCreationInputTokens', cacheRead: 'cacheReadInputTokens' };

/**
 * Input-side tokens the self-reported totals count but no streamed call carries.
 * The record can hold fewer calls than were billed; that remainder belongs to no
 * role, so it is its own row rather than spread over the others or dropped.
 */
function notInRecord(models, roles, missing) {
  if (!models) return null;
  const row = { role: 'not in record', calls: null };
  let differs = false;
  for (const [key, field] of Object.entries(MODEL_USAGE_FIELDS)) {
    const reported = Object.values(models).map((usage) => usage?.[field]);
    if (!reported.every((value) => typeof value === 'number')) {
      row[key] = null;
      continue;
    }
    row[key] = reported.reduce((sum, value) => sum + value, 0) - roles.reduce((sum, role) => sum + role[key], 0);
    if (row[key] !== 0) differs = true;
  }
  if (!differs) return null;
  missing.push('roles:model-calls-not-in-record');
  return row;
}

function summarizeRoles(events, missing) {
  const dispatchType = new Map();
  for (const event of events) {
    for (const use of toolUses(event)) {
      if (DISPATCH_TOOLS.has(use.name)) dispatchType.set(use.id, use.input?.subagent_type ?? 'unknown');
    }
  }

  const orchestrator = { role: 'orchestrator', calls: 0, context: null, ...inputSide(null) };
  const contexts = [];
  const agents = new Map();
  const agentRow = (type) => {
    if (!agents.has(type)) {
      agents.set(type, {
        role: type,
        dispatches: 0,
        completed: 0,
        calls: 0,
        endings: {},
        selfReported: { totalTokens: 0, toolUses: 0, durationMs: 0 },
        ...inputSide(null),
      });
    }
    return agents.get(type);
  };
  for (const type of dispatchType.values()) agentRow(type).dispatches++;

  for (const call of modelCalls(events)) {
    const { parent, ...tokens } = call;
    if (parent === null) {
      orchestrator.calls++;
      addInto(orchestrator, tokens);
      contexts.push(tokens.input + tokens.cacheCreation + tokens.cacheRead);
    } else {
      const row = agentRow(dispatchType.get(parent) ?? 'unknown');
      row.calls++;
      addInto(row, tokens);
    }
  }
  if (contexts.length) {
    orchestrator.context = { calls: contexts.length, first: contexts[0], max: Math.max(...contexts), last: contexts.at(-1) };
  }

  for (const event of events) {
    if (event.type !== 'system' || event.subtype !== 'task_notification' || !event.usage) continue;
    if (!dispatchType.has(event.tool_use_id)) continue;
    const row = agentRow(dispatchType.get(event.tool_use_id));
    const status = event.status ?? 'unknown';
    row.endings[status] = (row.endings[status] ?? 0) + 1;
    if (status === 'completed') row.completed++;
    addInto(row.selfReported, {
      totalTokens: event.usage.total_tokens ?? 0,
      toolUses: event.usage.tool_uses ?? 0,
      durationMs: event.usage.duration_ms ?? 0,
    });
  }
  for (const row of agents.values()) {
    const ended = Object.values(row.endings).reduce((sum, count) => sum + count, 0);
    if (ended < row.dispatches) missing.push(`agent:${row.role}:notification`);
    if (ended === 0) row.selfReported = null;
  }
  return [orchestrator, ...[...agents.values()].sort((a, b) => a.role.localeCompare(b.role))];
}

function summarizePhases(events, missing) {
  const main = events.filter((event) => (event.parent_tool_use_id ?? null) === null);
  const starts = new Map();
  const closers = new Set();
  for (const event of main) {
    const at = Date.parse(event.timestamp);
    if (!Number.isFinite(at)) continue;
    for (const use of toolUses(event)) {
      const command = use.name === 'Bash' ? String(use.input?.command ?? '') : '';
      for (const { phase, pattern } of PHASE_MARKERS) {
        if (!starts.has(phase) && pattern.test(command)) starts.set(phase, at);
      }
      if (F4_CLOSE.test(command)) closers.add(use.id);
    }
  }
  let f5 = null;
  for (const event of main) {
    const at = Date.parse(event.timestamp);
    if (Number.isFinite(at) && toolResultIds(event).some((id) => closers.has(id))) f5 = at;
  }
  if (f5 !== null) starts.set('F5', f5);

  const stamps = events.map((event) => Date.parse(event.timestamp)).filter(Number.isFinite);
  if (!stamps.length) return [];
  const first = Math.min(...stamps);
  const last = Math.max(...stamps);
  starts.set('setup', first);
  for (const phase of PHASES) if (!starts.has(phase)) missing.push(`phase:${phase}`);

  const present = PHASES.filter((phase) => starts.has(phase)).sort((a, b) => starts.get(a) - starts.get(b));
  return present.map((phase, index) => {
    const start = starts.get(phase);
    const end = index + 1 < present.length ? starts.get(present[index + 1]) : last;
    // A missing phase's time stays in the segment before it.
    const absorbs = PHASES.slice(PHASES.indexOf(phase) + 1).filter(
      (later) => !starts.has(later) && (index + 1 >= present.length || PHASES.indexOf(later) < PHASES.indexOf(present[index + 1])),
    );
    return {
      phase,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      ms: end - start,
      ...(absorbs.length ? { includesMissing: absorbs } : {}),
    };
  });
}

function readJsonIfPresent(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function graphNodeCount(path) {
  if (!existsSync(path)) return null;
  const firstLine = readFileSync(path, 'utf-8').split('\n', 1)[0];
  try {
    const header = JSON.parse(firstLine);
    return typeof header?.counts?.nodes === 'number' ? header.counts.nodes : null;
  } catch {
    return null;
  }
}

/** Sample size from the run's own products (design D4); an unreadable figure is missing, not zero. */
export function readSample(projectDir, missing = []) {
  const sample = { files: null, batches: null, nodes: null };
  if (!projectDir) {
    missing.push('sample');
    return sample;
  }
  const dataDir = join(projectDir, '.excavator');
  const staleFiles = readJsonIfPresent(join(dataDir, 'intermediate', 'stale-files.json'));
  if (Array.isArray(staleFiles)) sample.files = staleFiles.length;
  const batches = readJsonIfPresent(join(dataDir, 'intermediate', 'batches.json'));
  const batchList = Array.isArray(batches) ? batches : batches?.batches;
  if (Array.isArray(batchList)) sample.batches = batchList.length;
  sample.nodes = graphNodeCount(join(dataDir, 'knowledge-graph.jsonl'));
  for (const [key, value] of Object.entries(sample)) if (value === null) missing.push(`sample:${key}`);
  return sample;
}

function derive(totals, sample) {
  const per = (value, by) => (typeof value === 'number' && typeof by === 'number' && by > 0 ? value / by : null);
  return {
    costPerFileUsd: per(totals.costUsd, sample.files),
    costPerNodeUsd: per(totals.costUsd, sample.nodes),
    wallMsPerFile: per(totals.wallMs, sample.files),
  };
}

export function summarizeRun({ events, malformedLines = 0 }, { sample = null } = {}) {
  const missing = [];
  const totals = summarizeTotals(events, missing);
  const roles = summarizeRoles(events, missing);
  const unattributed = notInRecord(totals.models, roles, missing);
  if (unattributed) roles.push(unattributed);
  const phases = summarizePhases(events, missing);
  const sampleSize = sample ?? { files: null, batches: null, nodes: null };
  if (!sample) missing.push('sample');
  return {
    schema: REPORT_SCHEMA,
    totals,
    roles,
    phases,
    sample: sampleSize,
    derived: derive(totals, sampleSize),
    malformedLines,
    missing,
  };
}

const fmt = (value) => (value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString('en-US') : String(value));
const minutes = (ms) => (typeof ms === 'number' ? `${(ms / 60000).toFixed(1)} min` : '—');

export function renderMarkdown(report, { title = 'Full run report' } = {}) {
  const { totals, roles, phases, sample, derived, missing } = report;
  const lines = [
    `# ${title}`,
    '',
    `- Cost (self-reported): ${totals.costUsd === null ? '—' : `$${totals.costUsd.toFixed(4)}`}`,
    `- Wall time: ${minutes(totals.wallMs)} (${fmt(totals.firstTimestamp)} → ${fmt(totals.lastTimestamp)})`,
    `- Result events: ${fmt(totals.resultEvents)} (${totals.resultSubtypes.join(', ') || '—'}), turns: ${fmt(totals.numTurns)}, any error: ${fmt(totals.anyError)}`,
    `- CLI ${fmt(totals.cliVersion)}, model ${fmt(totals.initModel)}`,
    `- Sample: ${fmt(sample.files)} files, ${fmt(sample.nodes)} nodes, ${fmt(sample.batches)} F2 batches`,
    `- Derived: $${derived.costPerFileUsd === null ? '—' : derived.costPerFileUsd.toFixed(4)} per file, ${minutes(derived.wallMsPerFile)} per file`,
    ...(report.run
      ? [
          `- Run: ${report.run.model}, budget $${report.run.maxBudgetUsd}${report.run.noVerify ? ', --no-verify' : ''}, exit ${fmt(report.run.exitCode)}, process wall ${minutes(report.run.processWallMs)}`,
          `- Sample ${report.run.sampleSource} at ${fmt(report.run.sampleCommit)}, copied to ${report.run.copy}`,
          `- Plugin ${report.run.pluginDir} at ${fmt(report.run.pluginCommit)}${report.run.pluginDirty ? ' (uncommitted changes)' : ''}`,
        ]
      : []),
    '',
    '## Models',
    '',
    '| Model | Input | Output | Cache read | Cache write | Cost |',
    '|---|---|---|---|---|---|',
    ...Object.entries(totals.models ?? {}).map(([model, usage]) =>
      `| ${model} | ${fmt(usage.inputTokens)} | ${fmt(usage.outputTokens)} | ${fmt(usage.cacheReadInputTokens)} | ${fmt(usage.cacheCreationInputTokens)} | ${usage.costUSD === undefined ? '—' : `$${usage.costUSD.toFixed(4)}`} |`),
    '',
    '## Roles',
    '',
    '| Role | Dispatches | Model calls | Cache read | Cache write | Self-reported tokens | Self-reported time |',
    '|---|---|---|---|---|---|---|',
    ...roles.map((row) =>
      `| ${row.role} | ${fmt(row.dispatches ?? null)} | ${fmt(row.calls)} | ${fmt(row.cacheRead)} | ${fmt(row.cacheCreation)} | ${fmt(row.selfReported?.totalTokens)} | ${minutes(row.selfReported?.durationMs)} |`),
    '',
  ];
  const orchestrator = roles[0];
  if (orchestrator.context) {
    lines.push(`Orchestrator context per call: first ${fmt(orchestrator.context.first)}, max ${fmt(orchestrator.context.max)}, last ${fmt(orchestrator.context.last)} tokens over ${fmt(orchestrator.context.calls)} calls.`, '');
  }
  if (roles.some((row) => row.role === 'not in record')) {
    lines.push('"not in record": input-side tokens in the self-reported model usage that no call in the record carries; they belong to no role above.', '');
  }
  lines.push('## Phases', '', '| Phase | Start | Duration | Includes missing |', '|---|---|---|---|');
  for (const row of phases) lines.push(`| ${row.phase} | ${row.start} | ${minutes(row.ms)} | ${row.includesMissing?.join(', ') ?? ''} |`);
  lines.push('', '## Missing', '', ...(missing.length ? missing.map((item) => `- ${item}`) : ['- none']), '');
  return lines.join('\n');
}

export class CliUsageError extends Error {}

export function helpText() {
  return [
    'Usage:',
    '  node scripts/benchmark-full-run.mjs report <run.jsonl> [--project <dir>] [--out <dir>]',
    '  node scripts/benchmark-full-run.mjs run <sample-dir> --model <model> --max-budget-usd <usd> --out <dir> [--no-verify]',
    '',
    'report  Read the stream-json record of one headless Full run and write',
    '        <name>.report.json and <name>.report.md (default: next to the record).',
    '        --project names the analysed project, whose .excavator/ products give',
    '        the sample size; without it the sample size is reported as missing.',
    '',
    'run     Copy the sample into a new temporary directory, run one headless Full',
    '        on the copy with the plugin loaded from this checkout, and write',
    '        run.jsonl, run.stderr and the report into --out. --model and',
    '        --max-budget-usd are required; nothing is spent without them.',
    '',
  ].join('\n');
}

const VALUE_OPTIONS = {
  report: ['--project', '--out'],
  run: ['--model', '--max-budget-usd', '--out'],
};
const FLAG_OPTIONS = { report: [], run: ['--no-verify'] };

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') return { help: true };
  if (!Object.hasOwn(VALUE_OPTIONS, command)) throw new CliUsageError(`unknown command "${command}"`);
  const values = {};
  const flags = new Set();
  let target = null;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (VALUE_OPTIONS[command].includes(arg)) {
      const value = rest[++index];
      if (value === undefined || value.startsWith('--')) throw new CliUsageError(`${arg} needs a value`);
      values[arg] = value;
    } else if (FLAG_OPTIONS[command].includes(arg)) {
      flags.add(arg);
    } else if (arg.startsWith('--')) {
      throw new CliUsageError(`unknown option "${arg}" for ${command}`);
    } else if (target === null) {
      target = arg;
    } else {
      throw new CliUsageError(`unexpected argument "${arg}"`);
    }
  }
  if (command === 'report') {
    if (target === null) throw new CliUsageError('report needs the path of a run record');
    return { command, record: target, project: values['--project'] ?? null, out: values['--out'] ?? null };
  }
  if (target === null) throw new CliUsageError('run needs the sample directory');
  for (const required of VALUE_OPTIONS.run) {
    if (values[required] === undefined) throw new CliUsageError(`run needs ${required}`);
  }
  const budget = Number(values['--max-budget-usd']);
  if (!Number.isFinite(budget) || budget <= 0) throw new CliUsageError('--max-budget-usd must be a positive number of dollars');
  return {
    command,
    sample: target,
    model: values['--model'],
    maxBudgetUsd: budget,
    out: values['--out'],
    noVerify: flags.has('--no-verify'),
  };
}

/** A name that suggests a test makes the orchestrator look for expectations, so such a copy is called `app`. */
const SUGGESTIVE_NAME = /test|fixture/i;

export function isolatedName(sampleDir) {
  const name = basename(resolve(sampleDir));
  return SUGGESTIVE_NAME.test(name) ? 'app' : name;
}

const isInside = (child, parent) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

function git(cwd, args) {
  const child = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
  return child.status === 0 ? child.stdout.trim() : null;
}

/**
 * Copy the sample into `<new temp dir>/<name>` next to an empty `cwd/`, and
 * nothing else. A git sample is exported at HEAD, so the copy has no history,
 * no untracked files and no `.git`; anything else is copied whole.
 */
export function prepareIsolatedCopy(sampleDir, { tmpRoot = tmpdir() } = {}) {
  const source = resolve(sampleDir);
  if (!existsSync(source) || !statSync(source).isDirectory()) throw new CliUsageError(`no sample directory at ${source}`);
  const root = mkdtempSync(join(tmpRoot, 'work-'));
  if (SUGGESTIVE_NAME.test(root)) throw new CliUsageError(`the temporary directory ${root} has a test-like name; set TMPDIR elsewhere`);
  const project = join(root, isolatedName(source));
  const cwd = join(root, 'cwd');
  mkdirSync(project);
  mkdirSync(cwd);
  const commit = git(source, ['rev-parse', '--show-toplevel']) === realpathSync(source) ? git(source, ['rev-parse', 'HEAD']) : null;
  if (commit) {
    const archive = spawnSync('sh', ['-c', 'git -C "$1" archive --format=tar HEAD | tar -x -C "$2"', 'sh', source, project]);
    if (archive.status !== 0) throw new Error(`git archive of ${source} failed: ${archive.stderr}`);
  } else {
    cpSync(source, project, { recursive: true });
  }
  return { root, project, cwd, source, commit };
}

function preflight(repoRoot) {
  const problems = [];
  const auth = spawnSync('claude', ['auth', 'status'], { encoding: 'utf-8' });
  let loggedIn = false;
  try {
    loggedIn = JSON.parse(auth.stdout).loggedIn === true;
  } catch {
    // Not JSON: treated as not logged in.
  }
  if (!loggedIn) problems.push('the claude CLI is not logged in (claude auth login)');
  const validate = spawnSync('claude', ['plugin', 'validate', repoRoot], { encoding: 'utf-8' });
  if (validate.status !== 0) problems.push(`claude plugin validate ${repoRoot} failed`);
  if (!existsSync(join(repoRoot, 'packages', 'core', 'dist', 'index.js'))) problems.push('packages/core/dist is not built');
  return problems;
}

export function claudeArgs({ project, model, maxBudgetUsd, noVerify, pluginDir }) {
  return [
    '-p',
    `/excavator:excavator ${project} --full${noVerify ? ' --no-verify' : ''}`,
    '--model', model,
    '--max-budget-usd', String(maxBudgetUsd),
    '--plugin-dir', pluginDir,
    '--setting-sources', 'user',
    '--settings', JSON.stringify({ disableAllHooks: true }),
    '--permission-mode', 'auto',
    '--no-session-persistence',
    '--output-format', 'stream-json',
    '--verbose',
  ];
}

/** One measured Full run. Returns the report; the temporary directory is kept and named in it. */
export async function runMeasured(options, { repoRoot, onProgress = () => {} }) {
  const out = resolve(options.out);
  if (isInside(out, resolve(options.sample))) throw new CliUsageError('--out must be outside the sample directory');
  const recordPath = join(out, 'run.jsonl');
  if (existsSync(recordPath)) throw new CliUsageError(`${recordPath} already exists; give a new --out`);
  const problems = preflight(repoRoot);
  if (problems.length) throw new CliUsageError(`preflight failed:\n  - ${problems.join('\n  - ')}`);

  const copy = prepareIsolatedCopy(options.sample);
  mkdirSync(out, { recursive: true });
  onProgress(`sample copied to ${copy.project}`);
  const started = Date.now();
  const exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn('claude', claudeArgs({ ...options, project: copy.project, pluginDir: repoRoot }), {
      cwd: copy.cwd,
      env: { ...process.env, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' },
      stdio: ['ignore', openSync(recordPath, 'w'), openSync(join(out, 'run.stderr'), 'w')],
    });
    child.on('error', reject);
    child.on('exit', (code) => resolveExit(code));
  });
  const ended = Date.now();

  const missing = [];
  const sample = readSample(copy.project, missing);
  const report = summarizeRun(parseRunRecord(readFileSync(recordPath, 'utf-8')), { sample });
  report.missing.push(...missing);
  report.record = recordPath;
  report.run = {
    sampleSource: copy.source,
    sampleCommit: copy.commit,
    copy: copy.project,
    workDir: copy.root,
    model: options.model,
    maxBudgetUsd: options.maxBudgetUsd,
    noVerify: options.noVerify,
    pluginDir: repoRoot,
    pluginCommit: git(repoRoot, ['rev-parse', 'HEAD']),
    pluginDirty: (git(repoRoot, ['status', '--porcelain']) ?? '') !== '',
    exitCode,
    processWallMs: ended - started,
  };
  return report;
}
