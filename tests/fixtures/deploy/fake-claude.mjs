#!/usr/bin/env node
/**
 * fake-claude.mjs
 *
 * A stand-in for the real `claude` binary, used only by
 * tests/deploy/e2e.test.mjs (task 2.5). It replays a synthetic stream-json
 * event sequence on stdout and writes synthetic `.excavator/` products into
 * the repo path it is given, selected by the `FAKE_CLAUDE_SCENARIO` env var.
 *
 * This proves run-excavator.mjs's wiring (argument parsing, stdout capture,
 * timeout handling, post-run checks) end to end. It does NOT prove a real
 * `claude`/Bedrock run behaves this way — that is what deploy/selftest.sh's
 * zero-credential load probe and O6's real corpus run are for.
 *
 * Reads the real PIPELINE_VERSION from this checkout so the "success"
 * scenario's product genuinely satisfies the skip rule / product check the
 * same way a real run would.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PIPELINE_VERSION } from '../../../skills/excavator/annotate-graph.mjs';

function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };
  const prompt = get('-p');
  const pluginDir = get('--plugin-dir');
  const model = get('--model');
  // Prompt shape: "/excavator:excavator <repoPath> --mode=full" or "--full".
  const repoPath = prompt ? prompt.split(' ')[1] : null;
  return { prompt, pluginDir, model, repoPath };
}

function expectedAgentIds(pluginDir) {
  let filenames = [];
  try {
    filenames = readdirSync(join(pluginDir, 'agents'));
  } catch {
    filenames = [];
  }
  return filenames.filter((f) => f.endsWith('.md')).map((f) => `excavator:${f.slice(0, -3)}`).sort();
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function writeProducts(repoPath, { gitCommitHash, model, verification = 'verified' }) {
  const dataDir = join(repoPath, '.excavator');
  mkdirSync(dataDir, { recursive: true });
  const graph = {
    project: { pipelineVersion: PIPELINE_VERSION, gitCommitHash, model, verification },
    nodes: [], edges: [], layers: [], coverage: {}, gaps: [],
  };
  writeFileSync(join(dataDir, 'knowledge-graph.json'), JSON.stringify(graph, null, 2));
  writeFileSync(join(dataDir, 'meta.json'), JSON.stringify({
    lastAnalyzedAt: '2026-09-24T00:00:00.000Z', gitCommitHash, version: '1', analyzedFiles: 0,
  }, null, 2));
}

async function main() {
  const { pluginDir, model, repoPath } = parseArgs(process.argv.slice(2));
  const scenario = process.env.FAKE_CLAUDE_SCENARIO ?? 'success';
  const headSha = process.env.FAKE_CLAUDE_HEAD_SHA ?? '0000000000000000000000000000000000000000';

  const agents = scenario === 'load-failure'
    ? expectedAgentIds(pluginDir).slice(1) // drop one agent on purpose
    : expectedAgentIds(pluginDir);

  const initEvent = {
    type: 'system', subtype: 'init', session_id: 'fake-session', cwd: process.cwd(),
    tools: ['Task', 'Bash', 'Read', 'Edit'],
    mcp_servers: scenario === 'load-failure'
      ? []
      : [{ name: 'plugin:excavator:excavator', status: 'connected', source: 'plugin' }],
    model, claude_code_version: '2.1.281', apiKeySource: 'bedrock', permissionMode: 'bypassPermissions',
    agents,
    plugins: [{ name: 'excavator', path: pluginDir, source: 'excavator@inline', version: 'fake' }],
  };
  emit(initEvent);

  if (scenario === 'timeout') {
    // Survive SIGINT (as a real hung process might briefly), only die on
    // SIGTERM (Node's default). Never emits a result event.
    //
    // A bare `await new Promise(() => {})` is NOT a reliable hang here:
    // with no other pending timer/handle, Node's "unsettled top-level
    // await" idle detector force-exits the process (exit code 13) as soon
    // as the loop is otherwise idle, often before any signal even arrives.
    // A live interval gives the event loop genuine pending work, so the
    // process only ends when a real signal (SIGTERM) terminates it.
    process.on('SIGINT', () => process.stderr.write('fake-claude: ignoring SIGINT\n'));
    setInterval(() => {}, 1000);
    return;
  }

  const modelUsage = { [model]: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 50, costUSD: 0.01 } };
  const baseResult = {
    type: 'result', subtype: 'success', session_id: 'fake-session',
    is_error: false, terminal_reason: 'completed', permission_denials: [],
    subagent_stats: { spawned: 1, requested: { background: 0, foreground: 1, unset: 0 }, started_in_background: 0, max_depth: 1, spawned_by_subagents: 0, completed: 1, failed: 0, killed: { parent: 0, user: 0, system: 0 }, refused: { depth_limit: 0, concurrency_limit: 0, budget: 0 }, by_type: {} },
    modelUsage, total_cost_usd: 0.01, num_turns: 3, result: 'ok',
  };

  if (scenario === 'load-failure') {
    // Plugin never fully loaded; nothing gets produced. Emit a result event
    // (it may still look clean) so the load check is what fails this run.
    emit(baseResult);
    process.exit(0);
  }

  if (scenario === 'run-failure') {
    emit({ ...baseResult, is_error: true, terminal_reason: 'api_error', result: 'boom' });
    process.exit(0);
  }

  if (scenario === 'fabrication-skipped') {
    writeProducts(repoPath, { gitCommitHash: headSha, model, verification: 'skipped' });
    emit(baseResult);
    process.exit(0);
  }

  // 'success'
  writeProducts(repoPath, { gitCommitHash: headSha, model, verification: 'verified' });
  emit(baseResult);
  process.exit(0);
}

await main();
