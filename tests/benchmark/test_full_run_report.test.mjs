import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CliUsageError,
  claudeArgs,
  isolatedName,
  parseArgs,
  parseRunRecord,
  prepareIsolatedCopy,
  readSample,
  runMeasured,
  summarizeRun,
} from '../../scripts/lib/full-run-report.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../scripts/benchmark-full-run.mjs');

const at = (second) => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();
const usage = (cacheRead, cacheCreation = 0, input = 1) => ({
  input_tokens: input,
  cache_creation_input_tokens: cacheCreation,
  cache_read_input_tokens: cacheRead,
  output_tokens: 1,
});

function assistant(id, second, { parent = null, use = usage(100), content = [] } = {}) {
  return { type: 'assistant', timestamp: at(second), parent_tool_use_id: parent, message: { id, usage: use, content } };
}
const bash = (id, command) => ({ type: 'tool_use', id, name: 'Bash', input: { command } });
const dispatch = (id, subagentType) => ({ type: 'tool_use', id, name: 'Agent', input: { subagent_type: subagentType } });
const toolResult = (second, toolUseId, parent = null) => ({
  type: 'user',
  timestamp: at(second),
  parent_tool_use_id: parent,
  message: { content: [{ type: 'tool_result', tool_use_id: toolUseId }] },
});
const notification = (toolUseId, status = 'completed') => ({
  type: 'system',
  subtype: 'task_notification',
  tool_use_id: toolUseId,
  status,
  usage: { total_tokens: 1000, tool_uses: 4, duration_ms: 60000 },
});
const init = { type: 'system', subtype: 'init', claude_code_version: '9.9.9', model: 'model-a' };
const result = (cost, turns, extra = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  total_cost_usd: cost,
  num_turns: turns,
  modelUsage: { 'model-a': { inputTokens: 10, outputTokens: 20, costUSD: cost } },
  usage: usage(500),
  ...extra,
});

/** A complete Full run: setup, F1–F5 markers, two file analyzers, one architecture analyzer, two wakes. */
function fullRun() {
  return [
    init,
    assistant('m1', 0, { content: [bash('b0', 'ls')] }),
    assistant('m2', 10, { content: [bash('b1', 'node "$SKILL/lazy-analyze.mjs" "$ROOT"')] }),
    assistant('m3', 20, { content: [bash('b2', 'node "$SKILL/select-stale-semantics.mjs" "$ROOT"')] }),
    assistant('m4', 30, { content: [dispatch('a1', 'excavator:excavator-file-analyzer'), dispatch('a2', 'excavator:excavator-file-analyzer')] }),
    assistant('s1', 31, { parent: 'a1', use: usage(40, 5) }),
    assistant('s2', 32, { parent: 'a2', use: usage(60, 5) }),
    notification('a1'),
    notification('a2'),
    notification('bg-shell'),
    result(1.5, 4),
    assistant('m5', 40, { content: [bash('b3', 'node "$SKILL/semantic-graph.mjs" check "$ROOT"')] }),
    assistant('m6', 45, { content: [bash('b4', 'node "$SKILL/select-stale-semantics.mjs" "$ROOT" --out architecture-semantics.json')] }),
    assistant('m7', 50, { content: [dispatch('a3', 'excavator:excavator-architecture-analyzer')] }),
    assistant('s3', 51, { parent: 'a3', use: usage(70) }),
    notification('a3'),
    assistant('m8', 60, { content: [bash('b5', 'node "$SKILL/apply-verification.mjs" "$ROOT" \\\n  skip-semantic')] }),
    toolResult(62, 'b5'),
    assistant('m9', 70),
    result(3.25, 3),
  ];
}

const summarize = (events, options) => summarizeRun({ events, malformedLines: 0 }, options);

describe('parseRunRecord', () => {
  it('counts lines that do not parse instead of failing', () => {
    const parsed = parseRunRecord(`${JSON.stringify(init)}\n{not json\n\n${JSON.stringify(result(1, 1))}\n`);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.malformedLines).toBe(1);
  });
});

describe('totals', () => {
  it('takes cost and model usage from the last result and sums turns over all results', () => {
    const report = summarize(fullRun());
    expect(report.totals.costUsd).toBe(3.25);
    expect(report.totals.models['model-a'].costUSD).toBe(3.25);
    expect(report.totals.numTurns).toBe(7);
    expect(report.totals.resultEvents).toBe(2);
    expect(report.totals.anyError).toBe(false);
    expect(report.totals.cliVersion).toBe('9.9.9');
    expect(report.totals.wallMs).toBe(70000);
  });

  it('reports an error when any result carries one', () => {
    const events = fullRun();
    events[10] = result(1.5, 4, { is_error: true, subtype: 'error_max_budget_usd' });
    const report = summarize(events);
    expect(report.totals.anyError).toBe(true);
    expect(report.totals.resultSubtypes).toEqual(['error_max_budget_usd', 'success']);
  });
});

describe('roles', () => {
  it('counts a message split over several content blocks once', () => {
    const repeated = usage(1000, 200, 3);
    const report = summarize([
      assistant('same', 0, { use: repeated }),
      assistant('same', 1, { use: repeated }),
      assistant('same', 2, { use: repeated }),
    ]);
    const orchestrator = report.roles[0];
    expect(orchestrator.calls).toBe(1);
    expect(orchestrator.cacheRead).toBe(1000);
    expect(orchestrator.cacheCreation).toBe(200);
    expect(orchestrator.input).toBe(3);
  });

  it('groups subagents by the type they were dispatched as and sums their own reports', () => {
    const [orchestrator, architecture, files] = summarize(fullRun()).roles;
    expect(orchestrator.role).toBe('orchestrator');
    expect(orchestrator.calls).toBe(9);
    expect(orchestrator.context).toEqual({ calls: 9, first: 101, max: 101, last: 101 });
    expect(orchestrator).not.toHaveProperty('selfReported');

    expect(files.role).toBe('excavator:excavator-file-analyzer');
    expect(files).toMatchObject({ dispatches: 2, completed: 2, calls: 2, cacheRead: 100, cacheCreation: 10 });
    expect(files.selfReported).toEqual({ totalTokens: 2000, toolUses: 8, durationMs: 120000 });
    expect(architecture).toMatchObject({ role: 'excavator:excavator-architecture-analyzer', dispatches: 1, completed: 1 });
  });

  it('attributes nested dispatches and ignores notifications of non-agent tasks', () => {
    const report = summarize([
      assistant('m1', 0, { content: [dispatch('outer', 'reviewer')] }),
      assistant('s1', 1, { parent: 'outer', content: [dispatch('inner', 'helper')] }),
      assistant('s2', 2, { parent: 'inner', use: usage(7) }),
      notification('inner'),
      notification('outer', 'failed'),
      notification('bg-shell'),
    ]);
    const helper = report.roles.find((row) => row.role === 'helper');
    const reviewer = report.roles.find((row) => row.role === 'reviewer');
    expect(helper).toMatchObject({ dispatches: 1, completed: 1, cacheRead: 7 });
    expect(reviewer).toMatchObject({ dispatches: 1, completed: 0, endings: { failed: 1 } });
    expect(report.missing.filter((item) => item.startsWith('agent:'))).toEqual([]);
  });
});

describe('phases', () => {
  it('splits the run at the first marker of each phase and starts F5 when F4 closes', () => {
    const report = summarize(fullRun());
    expect(report.phases.map(({ phase, ms }) => [phase, ms])).toEqual([
      ['setup', 10000],
      ['F1', 10000],
      ['F2', 20000],
      ['F3', 20000],
      ['F4', 2000],
      ['F5', 8000],
    ]);
    expect(report.missing).toEqual(['sample']);
  });

  it('keeps a missing phase inside the segment before it and lists it', () => {
    const events = fullRun().filter((event) => event.message?.id !== 'm5' && event.message?.id !== 'm6');
    const report = summarize(events);
    const f2 = report.phases.find((row) => row.phase === 'F2');
    expect(report.phases.map((row) => row.phase)).toEqual(['setup', 'F1', 'F2', 'F4', 'F5']);
    expect(f2).toMatchObject({ ms: 40000, includesMissing: ['F3'] });
    expect(report.missing).toContain('phase:F3');
  });
});

describe('a run that did not finish', () => {
  it('lists cost, turns and the later phases as missing and keeps what it saw', () => {
    const truncated = fullRun().slice(0, 7);
    const report = summarize(truncated);
    expect(report.totals.costUsd).toBeNull();
    expect(report.totals.numTurns).toBeNull();
    expect(report.missing).toEqual(
      expect.arrayContaining([
        'result',
        'phase:F3',
        'phase:F4',
        'phase:F5',
        'agent:excavator:excavator-file-analyzer:notification',
      ]),
    );
    expect(report.phases.map((row) => row.phase)).toEqual(['setup', 'F1', 'F2']);
    expect(report.roles.find((row) => row.role === 'excavator:excavator-file-analyzer')).toMatchObject({
      dispatches: 2,
      calls: 2,
      selfReported: null,
    });
  });
});

describe('readSample', () => {
  function project({ staleFiles, batches, graphHeader }) {
    const root = mkdtempSync(join(tmpdir(), 'full-run-sample-'));
    const intermediate = join(root, '.excavator', 'intermediate');
    mkdirSync(intermediate, { recursive: true });
    if (staleFiles) writeFileSync(join(intermediate, 'stale-files.json'), JSON.stringify(staleFiles));
    if (batches) writeFileSync(join(intermediate, 'batches.json'), JSON.stringify(batches));
    if (graphHeader) {
      writeFileSync(join(root, '.excavator', 'knowledge-graph.jsonl'), `${JSON.stringify(graphHeader)}\n{"record":"node"}\n`);
    }
    return root;
  }

  it('reads files, batches and nodes from the run products', () => {
    const missing = [];
    const sample = readSample(
      project({
        staleFiles: ['a.java', 'b.java', 'c.xhtml'],
        batches: { batches: [{}, {}], neighborMap: {} },
        graphHeader: { record: 'header', counts: { nodes: 12, edges: 30 } },
      }),
      missing,
    );
    expect(sample).toEqual({ files: 3, batches: 2, nodes: 12 });
    expect(missing).toEqual([]);
  });

  it('lists each unreadable figure as missing rather than zero', () => {
    const missing = [];
    const sample = readSample(project({ staleFiles: [] }), missing);
    expect(sample).toEqual({ files: 0, batches: null, nodes: null });
    expect(missing).toEqual(['sample:batches', 'sample:nodes']);
  });

  it('derives per-file ratios only from figures it has', () => {
    const report = summarize(fullRun(), { sample: { files: 10, batches: 2, nodes: null } });
    expect(report.derived.costPerFileUsd).toBeCloseTo(0.325);
    expect(report.derived.costPerNodeUsd).toBeNull();
    expect(report.missing).not.toContain('sample');
  });
});

describe('command line', () => {
  it('rejects a report without a record, an unknown command and an option without a value', () => {
    expect(() => parseArgs(['report'])).toThrow(CliUsageError);
    expect(() => parseArgs(['estimate', 'run.jsonl'])).toThrow(CliUsageError);
    expect(() => parseArgs(['report', 'run.jsonl', '--project'])).toThrow(CliUsageError);
    expect(parseArgs(['report', 'run.jsonl', '--project', 'app'])).toMatchObject({ record: 'run.jsonl', project: 'app' });
  });

  it('writes the JSON and Markdown reports into the output directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'full-run-cli-'));
    const record = join(dir, 'run.jsonl');
    writeFileSync(record, fullRun().map((event) => JSON.stringify(event)).join('\n'));
    const out = join(dir, 'out');
    const child = spawnSync(process.execPath, [SCRIPT, 'report', record, '--out', out], { encoding: 'utf-8' });
    expect(child.status, child.stderr).toBe(0);
    const written = JSON.parse(readFileSync(join(out, 'run.report.json'), 'utf-8'));
    expect(written.schema).toBe('excavator-full-run-report/1');
    expect(written.totals.costUsd).toBe(3.25);
    expect(existsSync(join(out, 'run.report.md'))).toBe(true);
  });

  it('exits with a usage error for a record that does not exist', () => {
    const child = spawnSync(process.execPath, [SCRIPT, 'report', join(tmpdir(), 'no-such-run.jsonl')], { encoding: 'utf-8' });
    expect(child.status).toBe(2);
    expect(child.stderr).toContain('no run record');
  });
});

describe('run', () => {
  const runArgs = ['run', 'sample', '--model', 'sonnet', '--max-budget-usd', '40', '--out', 'out'];

  it('requires a model, a positive budget and an output directory', () => {
    expect(parseArgs(runArgs)).toMatchObject({ sample: 'sample', model: 'sonnet', maxBudgetUsd: 40, out: 'out', noVerify: false });
    expect(parseArgs([...runArgs, '--no-verify']).noVerify).toBe(true);
    const without = (option) => {
      const index = runArgs.indexOf(option);
      return runArgs.filter((_, i) => i !== index && i !== index + 1);
    };
    expect(() => parseArgs(without('--model'))).toThrow('run needs --model');
    expect(() => parseArgs(without('--max-budget-usd'))).toThrow('run needs --max-budget-usd');
    expect(() => parseArgs(without('--out'))).toThrow('run needs --out');
    expect(() => parseArgs(['run', 'sample', '--model', 'sonnet', '--max-budget-usd', '0', '--out', 'out'])).toThrow(CliUsageError);
    expect(() => parseArgs(['run', 'sample', '--model', 'sonnet', '--max-budget-usd', 'lots', '--out', 'out'])).toThrow(CliUsageError);
    expect(() => parseArgs(['report', 'run.jsonl', '--no-verify'])).toThrow(CliUsageError);
  });

  it('exits with a usage error and writes nothing when the budget is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'full-run-nobudget-'));
    const out = join(dir, 'out');
    const child = spawnSync(process.execPath, [SCRIPT, 'run', dir, '--model', 'sonnet', '--out', out], { encoding: 'utf-8' });
    expect(child.status).toBe(2);
    expect(child.stderr).toContain('run needs --max-budget-usd');
    expect(existsSync(out)).toBe(false);
  });

  it('refuses an output directory inside the sample before any preflight', async () => {
    const sample = mkdtempSync(join(tmpdir(), 'full-run-sample-'));
    const options = parseArgs(['run', sample, '--model', 'sonnet', '--max-budget-usd', '1', '--out', join(sample, 'out')]);
    await expect(runMeasured(options, { repoRoot: '/nonexistent' })).rejects.toThrow('--out must be outside the sample directory');
  });

  it('renames a sample whose name suggests a test', () => {
    expect(isolatedName('/x/cargotracker')).toBe('cargotracker');
    expect(isolatedName('/x/orders-fixture')).toBe('app');
    expect(isolatedName('/x/TestApp/')).toBe('app');
  });

  it('copies only the sample, next to an empty working directory', () => {
    const parent = mkdtempSync(join(tmpdir(), 'full-run-src-'));
    const source = join(parent, 'orders-fixture');
    mkdirSync(join(source, 'src'), { recursive: true });
    writeFileSync(join(source, 'src', 'Order.java'), 'class Order {}\n');
    writeFileSync(join(parent, 'pre-registration.md'), 'expected layers\n');
    const copy = prepareIsolatedCopy(source, { tmpRoot: mkdtempSync(join(tmpdir(), 'iso-')) });
    expect(readdirSync(copy.root).sort()).toEqual(['app', 'cwd']);
    expect(readdirSync(copy.cwd)).toEqual([]);
    expect(readdirSync(join(copy.project, 'src'))).toEqual(['Order.java']);
    expect(copy.commit).toBeNull();
  });

  it('exports a git sample at HEAD without history or untracked files', () => {
    const source = join(mkdtempSync(join(tmpdir(), 'full-run-git-')), 'shop');
    mkdirSync(source);
    const git = (...args) => spawnSync('git', ['-C', source, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf-8' });
    git('init', '-q');
    writeFileSync(join(source, 'App.java'), 'class App {}\n');
    git('add', 'App.java');
    git('commit', '-q', '-m', 'init');
    writeFileSync(join(source, 'notes.md'), 'not committed\n');
    const copy = prepareIsolatedCopy(source, { tmpRoot: mkdtempSync(join(tmpdir(), 'iso-')) });
    expect(readdirSync(copy.project)).toEqual(['App.java']);
    expect(copy.commit).toBe(git('rev-parse', 'HEAD').stdout.trim());
  });

  it('pins the model and budget, loads the plugin from the checkout and turns hooks off', () => {
    const args = claudeArgs({ project: '/w/app', model: 'sonnet', maxBudgetUsd: 40, noVerify: true, pluginDir: '/repo' });
    const value = (flag) => args[args.indexOf(flag) + 1];
    expect(args[1]).toBe('/excavator:excavator /w/app --full --no-verify');
    expect(value('--model')).toBe('sonnet');
    expect(value('--max-budget-usd')).toBe('40');
    expect(value('--plugin-dir')).toBe('/repo');
    expect(value('--setting-sources')).toBe('user');
    expect(JSON.parse(value('--settings'))).toEqual({ disableAllHooks: true });
    expect(value('--output-format')).toBe('stream-json');
    expect(claudeArgs({ project: '/w/app', model: 'sonnet', maxBudgetUsd: 40, noVerify: false, pluginDir: '/repo' })[1]).toBe(
      '/excavator:excavator /w/app --full',
    );
  });
});
