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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function summarizeRoles(events, missing) {
  const dispatchType = new Map();
  for (const event of events) {
    for (const use of toolUses(event)) {
      if (DISPATCH_TOOLS.has(use.name)) dispatchType.set(use.id, use.input?.subagent_type ?? 'unknown');
    }
  }

  const orchestrator = { role: 'orchestrator', calls: 0, context: null, selfReported: null, ...inputSide(null) };
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

  // The orchestrator's own usage, self-reported per result segment (final output tokens included).
  const results = events.filter((event) => event.type === 'result' && event.usage);
  if (results.length) {
    orchestrator.selfReported = results.reduce(
      (sum, result) => addInto(sum, { ...inputSide(result.usage), output: result.usage.output_tokens ?? 0 }),
      { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 },
    );
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
    `- Result events: ${fmt(totals.resultEvents)}, turns: ${fmt(totals.numTurns)}, any error: ${fmt(totals.anyError)}`,
    `- CLI ${fmt(totals.cliVersion)}, model ${fmt(totals.initModel)}`,
    `- Sample: ${fmt(sample.files)} files, ${fmt(sample.nodes)} nodes, ${fmt(sample.batches)} F2 batches`,
    `- Derived: $${derived.costPerFileUsd === null ? '—' : derived.costPerFileUsd.toFixed(4)} per file, ${minutes(derived.wallMsPerFile)} per file`,
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
      `| ${row.role} | ${fmt(row.dispatches ?? null)} | ${fmt(row.calls)} | ${fmt(row.cacheRead)} | ${fmt(row.cacheCreation)} | ${fmt(row.role === 'orchestrator' ? null : row.selfReported.totalTokens)} | ${row.role === 'orchestrator' ? '—' : minutes(row.selfReported.durationMs)} |`),
    '',
  ];
  const orchestrator = roles[0];
  if (orchestrator.context) {
    lines.push(`Orchestrator context per call: first ${fmt(orchestrator.context.first)}, max ${fmt(orchestrator.context.max)}, last ${fmt(orchestrator.context.last)} tokens over ${fmt(orchestrator.context.calls)} calls.`, '');
  }
  if (orchestrator.selfReported) {
    lines.push(`Orchestrator self-reported: output ${fmt(orchestrator.selfReported.output)}, cache read ${fmt(orchestrator.selfReported.cacheRead)}, cache write ${fmt(orchestrator.selfReported.cacheCreation)} tokens.`, '');
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
    '',
    'report  Read the stream-json record of one headless Full run and write',
    '        <name>.report.json and <name>.report.md (default: next to the record).',
    '        --project names the analysed project, whose .excavator/ products give',
    '        the sample size; without it the sample size is reported as missing.',
    '',
  ].join('\n');
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') return { help: true };
  if (command !== 'report') throw new CliUsageError(`unknown command "${command}"`);
  const options = { command, record: null, project: null, out: null };
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--project' || arg === '--out') {
      const value = rest[++index];
      if (value === undefined || value.startsWith('--')) throw new CliUsageError(`${arg} needs a directory`);
      options[arg.slice(2)] = value;
    } else if (arg.startsWith('--')) {
      throw new CliUsageError(`unknown option "${arg}"`);
    } else if (options.record === null) {
      options.record = arg;
    } else {
      throw new CliUsageError(`unexpected argument "${arg}"`);
    }
  }
  if (options.record === null) throw new CliUsageError('report needs the path of a run record');
  return options;
}
