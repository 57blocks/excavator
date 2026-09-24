#!/usr/bin/env node
/**
 * run-excavator.mjs
 *
 * Runner-image entrypoint (openspec: changes/runner-image, capability
 * `runner-image`, design.md D3/D4). One container processes one mounted
 * repository and performs one run: `lazy` calls the zero-model Lazy driver
 * directly and never starts Claude Code; `full` starts Claude Code once,
 * under a fixed isolation and budget contract, then judges the run with
 * deterministic checks instead of trusting the model's own report.
 *
 * Every decision is a pure function of plain data (stream-json events,
 * JSON products, env values) so the checking logic itself can be proven
 * against synthetic samples before it is ever pointed at a real run (design
 * "验收 Oracle" O3). The only impure pieces are: reading env/files, spawning
 * `git`/`lazy-analyze.mjs`/`validate-graph.mjs`/`claude`, and writing
 * `summary.json`. `main()` is a thin wrapper around those pure functions.
 *
 * Exit codes (design D4): 0 success or skipped, 2 config error, 3 run
 * failure, 4 load or product/structural-integrity failure, 5 fabrication
 * over threshold. Config errors write nothing and print only to stderr.
 * Every other run writes `<out>/summary.json`.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PIPELINE_VERSION } from '../skills/excavator/annotate-graph.mjs';

export { PIPELINE_VERSION };

// ---------------------------------------------------------------------------
// Runtime parameters (design D4). This is the exact operator-facing surface
// documented in docs/deploy.md — group 4's test asserts the two sets are
// equal, so this list is the single source of truth for what an operator is
// allowed to set.
// ---------------------------------------------------------------------------

export const RUNTIME_PARAMS = Object.freeze([
  'EXCAVATOR_MODE',
  'EXCAVATOR_MAX_BUDGET_USD',
  'EXCAVATOR_FORCE',
  'EXCAVATOR_MAX_CONTRADICTED',
  'EXCAVATOR_TIMEOUT_MINUTES',
  'AWS_REGION',
  'ANTHROPIC_MODEL',
]);

/**
 * Test/advanced seams: override the fixed mount points and binary name so
 * tests and deploy/selftest.sh can point the runner at fixtures instead of
 * the real `/work/repo`, `/work/out`, `/opt/excavator` and `claude`. These
 * are NOT part of the operator-facing contract in docs/deploy.md — an
 * operator running the real image never sets them.
 */
export const ADVANCED_ENV_VARS = Object.freeze({
  repoRoot: 'EXCAVATOR_REPO_ROOT_OVERRIDE',
  outDir: 'EXCAVATOR_OUT_DIR_OVERRIDE',
  pluginDir: 'EXCAVATOR_PLUGIN_DIR_OVERRIDE',
  claudeBin: 'EXCAVATOR_CLAUDE_BIN_OVERRIDE',
  timeoutGraceSeconds: 'EXCAVATOR_TIMEOUT_GRACE_SECONDS_OVERRIDE',
});

export const DEFAULTS = Object.freeze({
  repoRoot: '/work/repo',
  outDir: '/work/out',
  pluginDir: '/opt/excavator',
  claudeBin: 'claude',
  maxContradicted: 0,
  timeoutMinutes: 180,
  // Grace period between SIGINT and SIGTERM when the wall-clock timeout
  // fires (design D4: "先发 SIGINT，宽限后再发 SIGTERM"). Design does not
  // pin a number; 30s gives an orderly shutdown a real chance while staying
  // short enough not to matter next to a 180-minute default timeout.
  timeoutGraceSeconds: 30,
});

export const EXIT_CODES = Object.freeze({
  OK: 0,
  CONFIG_ERROR: 2,
  RUN_FAILURE: 3,
  LOAD_OR_PRODUCT_FAILURE: 4,
  FABRICATION: 5,
});

// ---------------------------------------------------------------------------
// Config parsing (task 2.1). Pure: takes an env-like object, returns either
// `{ ok: true, config }` or `{ ok: false, errors: string[] }`. Every error
// names the offending parameter, per the "运行参数不全时先失败" requirement.
// ---------------------------------------------------------------------------

function requireNonEmpty(value, name, errors) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${name} is required`);
    return null;
  }
  return value;
}

function parsePositiveNumber(value, defaultValue, name, errors, { required = false } = {}) {
  if (value === undefined || value === '') {
    if (required) {
      errors.push(`${name} is required`);
      return null;
    }
    return defaultValue;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    errors.push(`${name} must be a positive number, got ${JSON.stringify(value)}`);
    return null;
  }
  return n;
}

function parseNonNegativeInteger(value, defaultValue, name, errors) {
  if (value === undefined || value === '') return defaultValue;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    errors.push(`${name} must be a non-negative integer, got ${JSON.stringify(value)}`);
    return null;
  }
  return n;
}

function parseBooleanFlag(value, defaultValue, name, errors) {
  if (value === undefined || value === '') return defaultValue;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(v)) return true;
  if (['0', 'false', 'no'].includes(v)) return false;
  errors.push(`${name} must be a boolean-like value (1/0/true/false), got ${JSON.stringify(value)}`);
  return null;
}

/**
 * @param {Record<string, string|undefined>} env
 * @returns {{ ok: true, config: object } | { ok: false, errors: string[] }}
 */
export function parseConfig(env = {}) {
  const errors = [];

  const mode = env.EXCAVATOR_MODE;
  if (mode !== 'lazy' && mode !== 'full') {
    errors.push(
      `EXCAVATOR_MODE must be "lazy" or "full", got ${mode === undefined ? 'unset' : JSON.stringify(mode)}`,
    );
  }

  const force = parseBooleanFlag(env.EXCAVATOR_FORCE, false, 'EXCAVATOR_FORCE', errors);
  const maxContradicted = parseNonNegativeInteger(
    env.EXCAVATOR_MAX_CONTRADICTED, DEFAULTS.maxContradicted, 'EXCAVATOR_MAX_CONTRADICTED', errors,
  );
  const timeoutMinutes = parsePositiveNumber(
    env.EXCAVATOR_TIMEOUT_MINUTES, DEFAULTS.timeoutMinutes, 'EXCAVATOR_TIMEOUT_MINUTES', errors,
  );

  let region = null;
  let model = null;
  let maxBudgetUsd = null;
  if (mode === 'full') {
    region = requireNonEmpty(env.AWS_REGION, 'AWS_REGION', errors);
    model = requireNonEmpty(env.ANTHROPIC_MODEL, 'ANTHROPIC_MODEL', errors);
    maxBudgetUsd = parsePositiveNumber(
      env.EXCAVATOR_MAX_BUDGET_USD, undefined, 'EXCAVATOR_MAX_BUDGET_USD', errors, { required: true },
    );
  }

  const repoRoot = env[ADVANCED_ENV_VARS.repoRoot] || DEFAULTS.repoRoot;
  const outDir = env[ADVANCED_ENV_VARS.outDir] || DEFAULTS.outDir;
  const pluginDir = env[ADVANCED_ENV_VARS.pluginDir] || DEFAULTS.pluginDir;
  const claudeBin = env[ADVANCED_ENV_VARS.claudeBin] || DEFAULTS.claudeBin;
  const timeoutGraceSeconds = parsePositiveNumber(
    env[ADVANCED_ENV_VARS.timeoutGraceSeconds], DEFAULTS.timeoutGraceSeconds,
    ADVANCED_ENV_VARS.timeoutGraceSeconds, errors,
  );

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    config: {
      mode, force, maxContradicted, timeoutMinutes, region, model, maxBudgetUsd,
      repoRoot, outDir, pluginDir, claudeBin, timeoutGraceSeconds,
    },
  };
}

// ---------------------------------------------------------------------------
// Expected agent set (task 2.2). The agent list is read from the checkout at
// runtime, never hardcoded (design D4: "期望集合在运行时从
// /opt/excavator/agents/*.md 的文件名读出").
// ---------------------------------------------------------------------------

/** @param {string[]} filenames @returns {string[]} sorted `excavator:<stem>` ids */
export function resolveExpectedAgentIds(filenames) {
  return filenames
    .filter((name) => name.endsWith('.md'))
    .map((name) => `excavator:${name.slice(0, -'.md'.length)}`)
    .sort();
}

/** Impure wrapper: reads `<pluginDir>/agents/*.md` off disk. */
export function readExpectedAgentIds(pluginDir, { readdirSyncFn = readdirSync } = {}) {
  let filenames;
  try {
    filenames = readdirSyncFn(join(pluginDir, 'agents'));
  } catch {
    filenames = [];
  }
  return resolveExpectedAgentIds(filenames);
}

// ---------------------------------------------------------------------------
// stream-json event parsing (task 2.2). Pure: splits raw run.jsonl content
// into events and picks out the one `system`/`init` event and the terminal
// `result` event.
// ---------------------------------------------------------------------------

export function parseStreamEvents(rawText) {
  const events = [];
  for (const line of (rawText ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // A partially-written or corrupted line is data loss, not a crash —
      // it just does not contribute an event.
    }
  }
  const initEvent = events.find((e) => e?.type === 'system' && e?.subtype === 'init') ?? null;
  // Claude Code emits exactly one terminal `result` per `-p` turn; take the
  // last one defensively rather than assuming there is exactly one.
  const resultEvents = events.filter((e) => e?.type === 'result');
  const resultEvent = resultEvents.length > 0 ? resultEvents[resultEvents.length - 1] : null;
  return { events, initEvent, resultEvent };
}

// ---------------------------------------------------------------------------
// Load check (task 2.2). Reads the `system/init` event and judges whether
// the Excavator plugin, its MCP server, its full agent roster and the
// subagent-dispatch tool are all present (design D4 "加载").
// ---------------------------------------------------------------------------

export function checkLoad({ initEvent, expectedAgentIds, expectedPluginPath }) {
  const reasons = [];
  const safeExpectedAgentIds = Array.isArray(expectedAgentIds) ? expectedAgentIds : [];

  // No fourth state: an empty expected set (agents/ missing, unreadable, or
  // no *.md at all) is a checkout-completeness failure on its own — it must
  // never pass vacuously just because there was nothing left to be missing.
  if (safeExpectedAgentIds.length === 0) {
    reasons.push('checkout defines no agents (agents/*.md is missing, unreadable, or empty)');
  }

  if (!initEvent || typeof initEvent !== 'object') {
    reasons.push('no system/init event was observed in the run');
    return { ok: false, reasons, missingAgents: [...safeExpectedAgentIds] };
  }

  const plugins = Array.isArray(initEvent.plugins) ? initEvent.plugins : [];
  const excavatorPlugin = plugins.find((p) => p && p.name === 'excavator') ?? null;
  if (!excavatorPlugin) {
    reasons.push('excavator plugin is not present in system/init plugins[]');
  } else if (excavatorPlugin.path !== expectedPluginPath) {
    reasons.push(`excavator plugin path is ${JSON.stringify(excavatorPlugin.path)}, expected ${JSON.stringify(expectedPluginPath)}`);
  }

  const pluginErrors = Array.isArray(initEvent.plugin_errors) ? initEvent.plugin_errors : [];
  if (pluginErrors.length > 0) {
    reasons.push(`plugin_errors is non-empty: ${JSON.stringify(pluginErrors)}`);
  }

  const mcpServers = Array.isArray(initEvent.mcp_servers) ? initEvent.mcp_servers : [];
  const excavatorMcp = mcpServers.find((s) => s && s.name === 'plugin:excavator:excavator') ?? null;
  if (!excavatorMcp) {
    reasons.push('excavator MCP server (plugin:excavator:excavator) is not present in system/init mcp_servers[]');
  } else if (excavatorMcp.status !== 'connected') {
    reasons.push(`excavator MCP server status is ${JSON.stringify(excavatorMcp.status)}, expected "connected"`);
  }

  const agents = new Set(Array.isArray(initEvent.agents) ? initEvent.agents : []);
  const missingAgents = safeExpectedAgentIds.filter((id) => !agents.has(id));
  if (missingAgents.length > 0) {
    reasons.push(`missing agent(s): ${missingAgents.join(', ')}`);
  }

  const tools = new Set(Array.isArray(initEvent.tools) ? initEvent.tools : []);
  const dispatchToolAvailable = tools.has('Task') || tools.has('Agent');
  if (!dispatchToolAvailable) {
    reasons.push('neither "Task" nor "Agent" tool is available (subagent dispatch is unavailable)');
  }

  return { ok: reasons.length === 0, reasons, missingAgents };
}

// ---------------------------------------------------------------------------
// Run check (task 2.3). Reads the terminal `result` event plus the claude
// process's own exit status (design D4 "运行").
// ---------------------------------------------------------------------------

export function checkRun({ resultEvent, processExitCode, timedOut, spawnError }) {
  const reasons = [];

  if (spawnError) {
    reasons.push(`failed to start the claude process: ${spawnError}`);
  }

  if (timedOut) {
    reasons.push('wall-clock timeout exceeded; the process was signalled and terminated');
  }

  if (!resultEvent || typeof resultEvent !== 'object') {
    reasons.push('no terminal result event was observed in the run');
  } else {
    if (resultEvent.is_error) {
      reasons.push(`result event reports is_error=true (terminal_reason=${JSON.stringify(resultEvent.terminal_reason ?? null)})`);
    }
    // A terminal result can stop for a reason that never sets is_error —
    // e.g. hitting --max-budget-usd or a max-turns cap — so subtype must be
    // checked on its own, not inferred from is_error being false.
    if (resultEvent.subtype !== 'success') {
      reasons.push(`result subtype is ${JSON.stringify(resultEvent.subtype ?? null)}`);
    }
    // Claude Code is version-pinned (design D2), so a missing field here
    // means the pinned version's own contract changed under us. No fourth
    // state: that must fail loudly, never be silently read as "zero
    // denials"/"zero failures".
    if (!Array.isArray(resultEvent.permission_denials)) {
      reasons.push('result event is missing a permission_denials array (unexpected Claude Code contract)');
    } else if (resultEvent.permission_denials.length > 0) {
      reasons.push(`${resultEvent.permission_denials.length} permission denial(s) were recorded`);
    }
    const failed = resultEvent.subagent_stats?.failed;
    if (typeof failed !== 'number') {
      reasons.push('result event is missing subagent_stats.failed (unexpected Claude Code contract)');
    } else if (failed > 0) {
      reasons.push(`${failed} subagent(s) failed`);
    }
  }

  if (!timedOut && typeof processExitCode === 'number' && processExitCode !== 0) {
    reasons.push(`claude process exited with code ${processExitCode}`);
  }

  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Product check (task 2.3). Compares the produced meta.json/knowledge-graph
// against the HEAD recorded before the run and the requested model (design
// D4 "产物").
// ---------------------------------------------------------------------------

export function checkProduct({ graph, meta, expectedHead, expectedModel }) {
  const reasons = [];

  const actualHead = meta?.gitCommitHash ?? null;
  if (actualHead !== expectedHead) {
    reasons.push(`meta.json gitCommitHash is ${JSON.stringify(actualHead)}, expected HEAD ${JSON.stringify(expectedHead)}`);
  }

  const actualModel = graph?.project?.model ?? null;
  if (actualModel === 'unknown' || actualModel === null || actualModel === undefined) {
    reasons.push(`graph project.model is ${JSON.stringify(actualModel)}, expected ${JSON.stringify(expectedModel)}`);
  } else if (actualModel !== expectedModel) {
    reasons.push(`graph project.model is ${JSON.stringify(actualModel)}, expected ${JSON.stringify(expectedModel)}`);
  }

  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Skip rule (task 2.3/2.5). Decides whether a full run is skipped, and when
// not, whether to force a full rebuild (`--full`) or an incremental one
// (`--mode=full`) — design D3's three-case table.
// ---------------------------------------------------------------------------

export function planFullRun({ graph, meta, headSha, force, pipelineVersion }) {
  const hasFullProduct = graph?.project?.pipelineVersion === pipelineVersion;
  const commitMatches = hasFullProduct && meta?.gitCommitHash === headSha;

  if (hasFullProduct && commitMatches && !force) {
    return { action: 'skip', reason: 'existing full product already matches HEAD' };
  }
  if (force) {
    return { action: 'run', flag: '--full', reason: 'EXCAVATOR_FORCE is set' };
  }
  if (hasFullProduct) {
    return { action: 'run', flag: '--mode=full', reason: 'existing full product but HEAD changed' };
  }
  return { action: 'run', flag: '--full', reason: 'no existing full product (none, or Lazy-only)' };
}

// ---------------------------------------------------------------------------
// Claude argument builder (task 2.5). Produces EXACTLY the argument list
// design D3 specifies, never `--bare`.
// ---------------------------------------------------------------------------

export function buildClaudeArgs({ repoPath, pluginDir, fullFlagArg, model, maxBudgetUsd }) {
  return [
    '-p', `/excavator:excavator ${repoPath} ${fullFlagArg}`,
    '--plugin-dir', pluginDir,
    '--setting-sources', 'user',
    '--settings', '{"disableAllHooks": true}',
    '--model', model,
    '--permission-mode', 'bypassPermissions',
    '--permission-prompts', 'none',
    '--max-budget-usd', String(maxBudgetUsd),
    '--no-session-persistence',
    '--output-format', 'stream-json',
    '--verbose',
  ];
}

// ---------------------------------------------------------------------------
// Independent re-validation / fabrication check (task 2.4). Consumes
// validate-graph.mjs's own outputs; never re-implements its logic.
// ---------------------------------------------------------------------------

export function countByVerification(items, status) {
  return (Array.isArray(items) ? items : []).filter((item) => item && item.verification === status).length;
}

/**
 * @param {{
 *   validationReport: object|null, validatedGraph: object|null, maxContradicted: number,
 *   scriptFailure?: { status: number, stderrTail: string } | null,
 * }} args
 *
 * No fourth state: a missing/unreadable input is never read as "nothing
 * wrong" — it fails visibly, with a reason, same as a real finding would.
 */
export function checkFabrication({ validationReport, validatedGraph, maxContradicted, scriptFailure = null }) {
  const reasons = [];

  // validate-graph.mjs itself failing to run is authoritative: we cannot
  // trust whatever (if anything) is on disk, so both stages fail outright.
  if (scriptFailure) {
    reasons.push(`validate-graph.mjs exited with status ${scriptFailure.status}: ${scriptFailure.stderrTail || '(no stderr output)'}`);
    return {
      integrityOk: false, issuesCount: null,
      fabricationOk: false, contradictedCount: null, unverifiedCount: null, verificationSkipped: null,
      maxContradicted, reasons,
    };
  }

  const reportOk = !!validationReport && Array.isArray(validationReport.issues);
  if (!reportOk) reasons.push('validation report is missing or unreadable (validation.json)');
  const issuesCount = reportOk ? validationReport.issues.length : null;
  const integrityOk = reportOk && issuesCount === 0;
  if (reportOk && issuesCount > 0) reasons.push(`${issuesCount} structural integrity issue(s) found`);

  const graphOk = !!validatedGraph && Array.isArray(validatedGraph.nodes);
  if (!graphOk) reasons.push('validated graph is missing or unreadable (validated-graph.json)');
  const contradictedCount = graphOk
    ? countByVerification(validatedGraph.nodes, 'contradicted') + countByVerification(validatedGraph.edges, 'contradicted')
    : null;
  const unverifiedCount = graphOk
    ? countByVerification(validatedGraph.nodes, 'unverified') + countByVerification(validatedGraph.edges, 'unverified')
    : null;
  const verificationSkipped = graphOk ? validatedGraph.project?.verification === 'skipped' : null;

  let fabricationOk = false;
  if (graphOk) {
    // A skipped summary-verification pass MUST NOT be counted as zero
    // fabrication (spec: "核验被跳过" scenario).
    fabricationOk = contradictedCount <= maxContradicted && !verificationSkipped;
    if (contradictedCount > maxContradicted) {
      reasons.push(`${contradictedCount} contradicted node/edge(s) exceed the threshold of ${maxContradicted}`);
    }
    if (verificationSkipped) reasons.push('project.verification is "skipped"; not counted as zero fabrication');
  }

  return { integrityOk, issuesCount, fabricationOk, contradictedCount, unverifiedCount, verificationSkipped, maxContradicted, reasons };
}

// ---------------------------------------------------------------------------
// Exit code resolution (task 2.5). First failing stage wins, in the fixed
// order config(2) -> load(4) -> run(3) -> product/integrity(4) ->
// fabrication(5); skip is always 0.
// ---------------------------------------------------------------------------

export function resolveExitCode({ skipped, loadOk, runOk, productOk, fabricationOk }) {
  if (skipped) return EXIT_CODES.OK;
  if (!loadOk) return EXIT_CODES.LOAD_OR_PRODUCT_FAILURE;
  if (!runOk) return EXIT_CODES.RUN_FAILURE;
  if (!productOk) return EXIT_CODES.LOAD_OR_PRODUCT_FAILURE;
  if (!fabricationOk) return EXIT_CODES.FABRICATION;
  return EXIT_CODES.OK;
}

// ---------------------------------------------------------------------------
// Token/cost aggregation and summary builder (task 2.5). `modelUsage` is the
// `result` event's own field, keyed by model name.
// ---------------------------------------------------------------------------

export function aggregateModelUsage(modelUsage = {}) {
  const totals = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0 };
  for (const usage of Object.values(modelUsage ?? {})) {
    totals.inputTokens += Number(usage?.inputTokens) || 0;
    totals.outputTokens += Number(usage?.outputTokens) || 0;
    totals.cacheCreationInputTokens += Number(usage?.cacheCreationInputTokens) || 0;
    totals.cacheReadInputTokens += Number(usage?.cacheReadInputTokens) || 0;
    totals.costUsd += Number(usage?.costUSD) || 0;
  }
  return totals;
}

function checkSummary(check, okKey, extra = () => ({})) {
  if (!check) return { status: 'not-applicable', reasons: [], ...extra(null) };
  return { status: check[okKey] ? 'passed' : 'failed', reasons: check.reasons ?? [], ...extra(check) };
}

/**
 * Assemble `summary.json`'s content. Every field the spec's "每次运行恰好
 * 落入一个可见结果" requirement lists is present for every non-config-error
 * run: image identity, repo HEAD, mode, model, one verdict+reason per check,
 * the four token kinds, estimated cost, fabrication/unverified counts, and
 * a cache-read warning.
 */
export function buildSummary({
  imageCommit, imageClaudeCodeVersion, repoHead, mode, model,
  skipped, skipReason,
  loadCheck, runCheck, productCheck, fabricationCheck,
  modelUsage, exitCode,
}) {
  const tokens = aggregateModelUsage(modelUsage);
  const hasModelUsage = !!modelUsage && Object.keys(modelUsage).length > 0;

  return {
    imageCommit: imageCommit ?? null,
    imageClaudeCodeVersion: imageClaudeCodeVersion ?? null,
    repoHead: repoHead ?? null,
    mode,
    model: model ?? null,
    skipped: !!skipped,
    skipReason: skipped ? (skipReason ?? null) : null,
    exitCode,
    checks: {
      load: checkSummary(loadCheck, 'ok'),
      run: checkSummary(runCheck, 'ok'),
      product: checkSummary(productCheck, 'ok'),
      integrity: fabricationCheck
        ? { status: fabricationCheck.integrityOk ? 'passed' : 'failed', issuesCount: fabricationCheck.issuesCount, reasons: fabricationCheck.reasons ?? [] }
        : { status: 'not-applicable', issuesCount: null, reasons: [] },
      fabrication: fabricationCheck
        ? {
          status: fabricationCheck.fabricationOk ? 'passed' : 'failed',
          contradictedCount: fabricationCheck.contradictedCount,
          maxContradicted: fabricationCheck.maxContradicted,
          verificationSkipped: fabricationCheck.verificationSkipped,
          reasons: fabricationCheck.reasons ?? [],
        }
        : { status: 'not-applicable', contradictedCount: null, maxContradicted: null, verificationSkipped: null, reasons: [] },
    },
    tokens: {
      inputTokens: tokens.inputTokens,
      cacheCreationInputTokens: tokens.cacheCreationInputTokens,
      cacheReadInputTokens: tokens.cacheReadInputTokens,
      outputTokens: tokens.outputTokens,
    },
    estimatedCostUsd: tokens.costUsd,
    contradictedCount: fabricationCheck?.contradictedCount ?? null,
    unverifiedCount: fabricationCheck?.unverifiedCount ?? null,
    cacheWarning: hasModelUsage && tokens.cacheReadInputTokens === 0,
  };
}

// ---------------------------------------------------------------------------
// I/O helpers (impure). Kept tiny and separate from the decision logic above
// so every function that matters to correctness stays pure and unit-tested
// without touching a filesystem or a process.
// ---------------------------------------------------------------------------

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeSummary(outDir, summary) {
  ensureDir(outDir);
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
}

export function resolveHead(repoRoot, { spawnSyncFn = spawnSync } = {}) {
  const result = spawnSyncFn('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`git rev-parse HEAD failed in ${repoRoot}: ${(result.stderr || result.error?.message || 'unknown error').trim()}`);
  }
  return result.stdout.trim();
}

function safeResolveHead(repoRoot) {
  try {
    return resolveHead(repoRoot);
  } catch {
    return null; // A non-git target is legitimate for Lazy (source-snapshot supports it).
  }
}

export function runLazyAnalyzeScript({ pluginDir, repoRoot, spawnSyncFn = spawnSync }) {
  const scriptPath = join(pluginDir, 'skills/excavator/lazy-analyze.mjs');
  const result = spawnSyncFn(process.execPath, [scriptPath, repoRoot], { encoding: 'utf-8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function runValidateGraphScript({ pluginDir, repoRoot, graphPath, outDir, spawnSyncFn = spawnSync }) {
  const scriptPath = join(pluginDir, 'skills/excavator/validate-graph.mjs');
  const outPath = join(outDir, 'validated-graph.json');
  const reportPath = join(outDir, 'validation.json');
  const result = spawnSyncFn(process.execPath, [
    scriptPath, repoRoot, '--graph', graphPath, '--out', outPath, '--report', reportPath,
  ], { encoding: 'utf-8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', outPath, reportPath };
}

/** Last `maxChars` of `text`, trimmed — enough to see the error without dumping a whole log into summary.json. */
export function stderrTail(text, maxChars = 4000) {
  const s = (text ?? '').trim();
  if (s.length <= maxChars) return s;
  return `…${s.slice(-maxChars)}`;
}

/**
 * Runs the independent re-validation with no fourth state: `/work/out` can
 * be reused across runs, so any validation.json/validated-graph.json already
 * there is deleted BEFORE invoking validate-graph.mjs — a stale file from a
 * previous run must never be read as this run's verdict. A non-zero exit
 * from the script is reported as `scriptFailure` (with a stderr tail) rather
 * than silently falling through to whatever (if anything) got written.
 */
export function runIndependentValidation({ pluginDir, repoRoot, graphPath, outDir, spawnSyncFn = spawnSync }) {
  const outPath = join(outDir, 'validated-graph.json');
  const reportPath = join(outDir, 'validation.json');
  for (const stale of [outPath, reportPath]) {
    if (existsSync(stale)) rmSync(stale);
  }

  const result = runValidateGraphScript({ pluginDir, repoRoot, graphPath, outDir, spawnSyncFn });

  if (result.status !== 0) {
    return {
      scriptFailure: { status: result.status, stderrTail: stderrTail(result.stderr) },
      validationReport: null,
      validatedGraph: null,
    };
  }

  return {
    scriptFailure: null,
    validationReport: readJsonIfExists(reportPath),
    validatedGraph: readJsonIfExists(outPath),
  };
}

/**
 * Spawn `claude` from a fresh empty cwd, stream its stdout to
 * `<outDir>/run.jsonl`, and enforce the wall-clock timeout with a
 * SIGINT-then-SIGTERM escalation (design D4).
 */
export function spawnClaude({ claudeBin, args, cwd, env, outDir, timeoutMinutes, graceSeconds, spawnFn = spawn }) {
  return new Promise((resolvePromise) => {
    ensureDir(outDir);
    const outStream = createWriteStream(join(outDir, 'run.jsonl'));
    // stdin is explicitly closed (not just unset): a `claude -p` session with
    // an open-but-silent stdin waits ~3s for input, then prints "no stdin
    // data received" to stderr. There is never anything to pipe in here —
    // this is a one-shot, non-interactive run — so stdin is ignored outright
    // rather than left to inherit the parent's.
    const child = spawnFn(claudeBin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

    let timedOut = false;
    let settled = false;
    let sigtermTimer = null;
    const sigintTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGINT');
      sigtermTimer = setTimeout(() => child.kill('SIGTERM'), graceSeconds * 1000);
    }, timeoutMinutes * 60_000);

    child.stdout.pipe(outStream);
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));

    // A spawn failure (e.g. claudeBin does not exist) never emits 'close';
    // without this the run would hang until the outer wall-clock timeout.
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(sigintTimer);
      if (sigtermTimer) clearTimeout(sigtermTimer);
      outStream.end(() => resolvePromise({ processExitCode: null, timedOut: false, spawnError: err.message }));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(sigintTimer);
      if (sigtermTimer) clearTimeout(sigtermTimer);
      outStream.end(() => resolvePromise({ processExitCode: code, timedOut }));
    });
  });
}

// ---------------------------------------------------------------------------
// Orchestration (task 2.5).
// ---------------------------------------------------------------------------

async function runLazy(config, env) {
  ensureDir(config.outDir);
  const result = runLazyAnalyzeScript({ pluginDir: config.pluginDir, repoRoot: config.repoRoot });
  if (result.stderr) process.stderr.write(result.stderr);
  const ok = result.status === 0;
  const exitCode = ok ? EXIT_CODES.OK : EXIT_CODES.RUN_FAILURE;

  const summary = buildSummary({
    imageCommit: env.EXCAVATOR_IMAGE_COMMIT,
    imageClaudeCodeVersion: env.EXCAVATOR_IMAGE_CLAUDE_CODE_VERSION,
    repoHead: safeResolveHead(config.repoRoot),
    mode: 'lazy',
    model: null,
    skipped: false,
    skipReason: null,
    loadCheck: null,
    runCheck: { ok, reasons: ok ? [] : [`lazy-analyze.mjs exited with status ${result.status}`] },
    productCheck: null,
    fabricationCheck: null,
    modelUsage: {},
    exitCode,
  });
  writeSummary(config.outDir, summary);
  return exitCode;
}

async function runFull(config, env) {
  ensureDir(config.outDir);
  const repoHead = resolveHead(config.repoRoot);
  const dataDir = join(config.repoRoot, '.excavator');
  const graphPath = join(dataDir, 'knowledge-graph.json');
  const metaPath = join(dataDir, 'meta.json');

  const existingGraph = readJsonIfExists(graphPath);
  const existingMeta = readJsonIfExists(metaPath);
  const plan = planFullRun({ graph: existingGraph, meta: existingMeta, headSha: repoHead, force: config.force, pipelineVersion: PIPELINE_VERSION });

  const baseSummaryFields = {
    imageCommit: env.EXCAVATOR_IMAGE_COMMIT,
    imageClaudeCodeVersion: env.EXCAVATOR_IMAGE_CLAUDE_CODE_VERSION,
    repoHead, mode: 'full', model: config.model,
  };

  if (plan.action === 'skip') {
    const summary = buildSummary({
      ...baseSummaryFields, skipped: true, skipReason: plan.reason,
      loadCheck: null, runCheck: null, productCheck: null, fabricationCheck: null,
      modelUsage: {}, exitCode: EXIT_CODES.OK,
    });
    writeSummary(config.outDir, summary);
    return EXIT_CODES.OK;
  }

  const args = buildClaudeArgs({
    repoPath: config.repoRoot, pluginDir: config.pluginDir, fullFlagArg: plan.flag,
    model: config.model, maxBudgetUsd: config.maxBudgetUsd,
  });
  const cwd = mkdtempSync(join(tmpdir(), 'excavator-run-'));
  const runResult = await spawnClaude({
    claudeBin: config.claudeBin, args, cwd,
    env: { ...env, ANTHROPIC_MODEL: config.model },
    outDir: config.outDir, timeoutMinutes: config.timeoutMinutes, graceSeconds: config.timeoutGraceSeconds,
  });

  const runJsonlPath = join(config.outDir, 'run.jsonl');
  const rawEvents = existsSync(runJsonlPath) ? readFileSync(runJsonlPath, 'utf-8') : '';
  const { initEvent, resultEvent } = parseStreamEvents(rawEvents);

  const expectedAgentIds = readExpectedAgentIds(config.pluginDir);
  const loadCheck = checkLoad({ initEvent, expectedAgentIds, expectedPluginPath: config.pluginDir });
  const runCheck = checkRun({
    resultEvent, processExitCode: runResult.processExitCode, timedOut: runResult.timedOut, spawnError: runResult.spawnError,
  });

  const postGraph = readJsonIfExists(graphPath);
  const postMeta = readJsonIfExists(metaPath);

  let productCheck = null;
  let fabricationCheck = null;
  if (postGraph !== null) {
    productCheck = checkProduct({ graph: postGraph, meta: postMeta, expectedHead: repoHead, expectedModel: config.model });
    const { scriptFailure, validationReport, validatedGraph } = runIndependentValidation({
      pluginDir: config.pluginDir, repoRoot: config.repoRoot, graphPath, outDir: config.outDir,
    });
    fabricationCheck = checkFabrication({ validationReport, validatedGraph, maxContradicted: config.maxContradicted, scriptFailure });
  }

  const productStageOk = !!(productCheck?.ok && fabricationCheck?.integrityOk);
  const exitCode = resolveExitCode({
    skipped: false, loadOk: loadCheck.ok, runOk: runCheck.ok,
    productOk: productStageOk, fabricationOk: !!fabricationCheck?.fabricationOk,
  });

  const summary = buildSummary({
    ...baseSummaryFields, skipped: false, skipReason: null,
    loadCheck, runCheck, productCheck, fabricationCheck,
    modelUsage: resultEvent?.modelUsage ?? {}, exitCode,
  });
  writeSummary(config.outDir, summary);
  return exitCode;
}

export async function main(env = process.env) {
  const parsed = parseConfig(env);
  if (!parsed.ok) {
    for (const error of parsed.errors) process.stderr.write(`config error: ${error}\n`);
    process.exit(EXIT_CODES.CONFIG_ERROR);
    return;
  }

  const { config } = parsed;
  try {
    const exitCode = config.mode === 'lazy' ? await runLazy(config, env) : await runFull(config, env);
    process.exit(exitCode);
  } catch (err) {
    process.stderr.write(`run-excavator.mjs failed: ${err.message}\n`);
    process.exit(EXIT_CODES.RUN_FAILURE);
  }
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  await main();
}

export default {
  RUNTIME_PARAMS, ADVANCED_ENV_VARS, DEFAULTS, EXIT_CODES, PIPELINE_VERSION,
  parseConfig, resolveExpectedAgentIds, readExpectedAgentIds, parseStreamEvents,
  checkLoad, checkRun, checkProduct, planFullRun, buildClaudeArgs,
  countByVerification, checkFabrication, resolveExitCode, aggregateModelUsage, buildSummary,
  resolveHead, runLazyAnalyzeScript, runValidateGraphScript, runIndependentValidation, stderrTail, spawnClaude,
};
