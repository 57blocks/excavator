import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CliUsageError,
  claudeArgs,
  continuedCopy,
  copyProducts,
  isolatedName,
  parseArgs,
  parseRunRecord,
  prepareIsolatedCopy,
  readSample,
  runChild,
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
  modelUsage: { 'model-a': { outputTokens: 20, costUSD: cost } },
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

describe('model calls missing from the record', () => {
  const billed = (cacheRead) => ({ inputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: cacheRead, outputTokens: 5, costUSD: 1 });
  const events = (cacheRead) => [
    assistant('m1', 0, { use: usage(300) }),
    assistant('s1', 1, { parent: 'a1', use: usage(200) }),
    { ...result(1, 1), modelUsage: { 'model-a': billed(cacheRead) } },
  ];

  it('adds no row when the streamed calls account for the reported usage', () => {
    const report = summarize(events(500));
    expect(report.roles.map((row) => row.role)).toEqual(['orchestrator', 'unknown']);
    expect(report.missing).not.toContain('roles:model-calls-not-in-record');
  });

  it('shows usage the record does not carry as its own row and lists it as missing', () => {
    const report = summarize(events(1500));
    expect(report.roles.at(-1)).toEqual({ role: 'not in record', calls: null, input: 0, cacheCreation: 0, cacheRead: 1000 });
    expect(report.missing).toContain('roles:model-calls-not-in-record');
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

describe('run: continue, time out, pass skill arguments', () => {
  const base = ['--model', 'sonnet', '--max-budget-usd', '5', '--out', 'out'];

  it('takes a sample or --continue, a positive timeout, and skill arguments that are options themselves', () => {
    expect(parseArgs(['run', '--continue', '/w', ...base])).toMatchObject({ sample: null, continueDir: '/w' });
    expect(() => parseArgs(['run', 'sample', '--continue', '/w', ...base])).toThrow('not both');
    expect(() => parseArgs(['run', ...base])).toThrow('run needs the sample directory or --continue');
    expect(parseArgs(['run', 'sample', ...base, '--timeout-minutes', '7.5']).timeoutMinutes).toBe(7.5);
    expect(() => parseArgs(['run', 'sample', ...base, '--timeout-minutes', '0'])).toThrow('--timeout-minutes must be a positive number');
    expect(parseArgs(['run', 'sample', ...base, '--skill-args', '--estimate']).skillArgs).toBe('--estimate');
    expect(parseArgs(['run', 'sample', ...base, '--skill-args', '--scope src/a']).skillArgs).toBe('--scope src/a');
    expect(() => parseArgs(['run', 'sample', ...base, '--skill-args'])).toThrow('--skill-args needs a value');
    expect(parseArgs(['run', 'sample', ...base])).toMatchObject({ continueDir: null, timeoutMinutes: null, skillArgs: null });
  });

  it('appends the skill arguments to the /excavator command as they are', () => {
    const args = claudeArgs({ project: '/w/app', model: 'sonnet', maxBudgetUsd: 5, noVerify: false, pluginDir: '/repo', skillArgs: '--estimate --scope src/a' });
    expect(args[1]).toBe('/excavator:excavator /w/app --full --estimate --scope src/a');
  });

  it('reuses a work directory from run with its .excavator/ untouched, and refuses anything else', () => {
    const copy = prepareIsolatedCopy(mkdtempSync(join(tmpdir(), 'full-run-cont-src-')), { tmpRoot: mkdtempSync(join(tmpdir(), 'iso-')) });
    mkdirSync(join(copy.project, '.excavator'));
    writeFileSync(join(copy.project, '.excavator', 'semantic-cache.json'), '{"entries":{}}');
    const reused = continuedCopy(copy.root);
    expect(reused).toMatchObject({ root: copy.root, project: copy.project, cwd: copy.cwd });
    expect(readFileSync(join(reused.project, '.excavator', 'semantic-cache.json'), 'utf-8')).toBe('{"entries":{}}');

    writeFileSync(join(copy.cwd, 'stray.txt'), 'x');
    expect(() => continuedCopy(copy.root)).toThrow('is not empty');
    const extra = mkdtempSync(join(tmpdir(), 'full-run-cont-'));
    mkdirSync(join(extra, 'cwd'));
    mkdirSync(join(extra, 'a'));
    mkdirSync(join(extra, 'b'));
    expect(() => continuedCopy(extra)).toThrow('exactly one sample copy and cwd/');
    expect(() => continuedCopy(join(extra, 'nope'))).toThrow('no work directory');
  });

  it('refuses an output directory inside the work directory it continues', async () => {
    const work = mkdtempSync(join(tmpdir(), 'full-run-cont-out-'));
    const options = parseArgs(['run', '--continue', work, '--model', 'sonnet', '--max-budget-usd', '1', '--out', join(work, 'out')]);
    await expect(runMeasured(options, { repoRoot: '/nonexistent' })).rejects.toThrow('--out must be outside the work directory');
  });

  it('copies the products present and lists the absent ones as missing', () => {
    const project = mkdtempSync(join(tmpdir(), 'full-run-products-'));
    mkdirSync(join(project, '.excavator', 'intermediate'), { recursive: true });
    writeFileSync(join(project, '.excavator', 'intermediate', 'stale-semantics.json'), '{}');
    writeFileSync(join(project, '.excavator', 'semantic-cache.json'), '{}');
    const out = mkdtempSync(join(tmpdir(), 'full-run-products-out-'));
    const missing = [];
    expect(copyProducts(project, out, missing)).toEqual(['intermediate/stale-semantics.json', 'semantic-cache.json']);
    expect(readdirSync(join(out, 'products')).sort()).toEqual(['semantic-cache.json', 'stale-semantics.json']);
    expect(missing).toEqual(['products:intermediate/batches.json', 'products:intermediate/semantic-verify-manifest.json']);
  });

  it('stops a child that runs past the timeout, and kills one that ignores SIGTERM', async () => {
    const sleeper = await runChild(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 200, stdio: 'ignore' });
    expect(sleeper).toEqual({ code: null, signal: 'SIGTERM', timedOut: true });
    const stubborn = await runChild(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('ready')"],
      { timeoutMs: 300, graceMs: 300, stdio: 'ignore' },
    );
    expect(stubborn).toEqual({ code: null, signal: 'SIGKILL', timedOut: true });
    const quick = await runChild(process.execPath, ['-e', 'process.exit(3)'], { timeoutMs: 5000, stdio: 'ignore' });
    expect(quick).toEqual({ code: 3, signal: null, timedOut: false });
  });

  it('continues in the earlier copy, passes the skill arguments and reports a timeout (stand-in claude)', async () => {
    // A stand-in `claude` on PATH: passes preflight, logs its -p prompt, then
    // hangs so that only --timeout-minutes can end it.
    const bin = mkdtempSync(join(tmpdir(), 'full-run-fake-bin-'));
    const log = join(bin, 'prompt.log');
    writeFileSync(join(bin, 'claude'), [
      '#!/bin/sh',
      'case "$1" in',
      '  auth) echo \'{"loggedIn":true}\' ;;',
      '  plugin) exit 0 ;;',
      `  -p) printf '%s' "$2" > '${log}'; exec sleep 30 ;;`,
      'esac',
    ].join('\n'));
    chmodSync(join(bin, 'claude'), 0o755);
    const repoRoot = mkdtempSync(join(tmpdir(), 'full-run-fake-repo-'));
    mkdirSync(join(repoRoot, 'packages', 'core', 'dist'), { recursive: true });
    writeFileSync(join(repoRoot, 'packages', 'core', 'dist', 'index.js'), '');

    const copy = prepareIsolatedCopy(mkdtempSync(join(tmpdir(), 'full-run-fake-src-')), { tmpRoot: mkdtempSync(join(tmpdir(), 'iso-')) });
    mkdirSync(join(copy.project, '.excavator', 'intermediate'), { recursive: true });
    writeFileSync(join(copy.project, '.excavator', 'semantic-cache.json'), '{"entries":{"n":{}}}');
    const out = join(mkdtempSync(join(tmpdir(), 'full-run-fake-out-')), 'run2');
    const options = parseArgs(['run', '--continue', copy.root, '--model', 'sonnet', '--max-budget-usd', '1', '--out', out,
      '--timeout-minutes', '0.005', '--skill-args', '--estimate']);

    const savedPath = process.env.PATH;
    process.env.PATH = `${bin}:${savedPath}`;
    let report;
    try {
      report = await runMeasured(options, { repoRoot });
    } finally {
      process.env.PATH = savedPath;
    }
    expect(readFileSync(log, 'utf-8')).toBe(`/excavator:excavator ${copy.project} --full --estimate`);
    expect(report.run).toMatchObject({ continued: true, copy: copy.project, timedOut: true, signal: 'SIGTERM', skillArgs: '--estimate' });
    expect(readFileSync(join(out, 'products', 'semantic-cache.json'), 'utf-8')).toBe('{"entries":{"n":{}}}');
    expect(report.missing).toContain('products:intermediate/batches.json');
  });
});
