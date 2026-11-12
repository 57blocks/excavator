#!/usr/bin/env node
/**
 * fake-claude-skopo.mjs
 *
 * A stand-in for `claude` in the runner's skopo modes, used only by tests/deploy/skopo-mode.test.mjs.
 * It replays an init and a result event and writes a finished skopo run into the `--out` its
 * prompt names, recorded at the target's current source revision, so the runner's real
 * `skopo.mjs verdict` judges it. The mode in the prompt picks the stage it writes: a plan for
 * skopo-plan, a finished run for skopo-create, and that plus the assembled report for
 * skopo-report. FAKE_SKOPO_SCENARIO picks the products: `valid` (a lint-clean skopository) or
 * `lint-error` (one broken anchor). FAKE_SKOPO_PROMPT_FILE, when set, receives the prompt.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveFreshness } from '../../../skills/excavator/consumer-freshness.mjs';
import { assembleReport, writeReportPage } from '../../../skills/skopo-create/lib/report.mjs';
import { QUESTIONS, runRecord, SUMMARY, writeSkopo } from '../../skill/skopo/helpers.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i < 0 ? null : argv[i + 1];
};
const prompt = flag('-p') ?? '';
const pluginDir = flag('--plugin-dir');
const words = prompt.split(' ');
const repoPath = words[1];
const out = words[words.indexOf('--out') + 1];
const mode = words[0].replace('/excavator:', '');
const scenario = process.env.FAKE_SKOPO_SCENARIO ?? 'valid';
if (process.env.FAKE_SKOPO_PROMPT_FILE) writeFileSync(process.env.FAKE_SKOPO_PROMPT_FILE, prompt);

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const agents = readdirSync(join(pluginDir, 'agents')).filter((f) => f.endsWith('.md')).map((f) => `excavator:${f.slice(0, -3)}`);
emit({
  type: 'system', subtype: 'init', session_id: 'fake-skopo', tools: ['Task', 'Bash', 'Read'],
  mcp_servers: [{ name: 'plugin:excavator:excavator', status: 'connected' }],
  plugins: [{ name: 'excavator', path: pluginDir }], plugin_errors: [], agents,
});

const { currentSourceRevision } = await resolveFreshness(repoPath);
const write = (path, text) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};
write(join(out, 'run', 'run.json'), JSON.stringify(runRecord({
  sourceRevision: currentSourceRevision, projectRoot: repoPath, decisions: { plan: 'auto' },
  endedAt: mode === 'skopo-plan' ? null : '2026-10-27T01:00:00.000Z',
})));
write(join(out, 'run', 'plan.md'), '# Plan\n\nOne domain.\n');
write(join(out, 'run', 'research', 'world.md'), '# world\n');
if (mode !== 'skopo-plan') {
  write(join(out, 'run', 'questions.md'), QUESTIONS);
  writeSkopo(join(out, 'skopo'));
  if (scenario === 'lint-error') {
    const file = join(out, 'skopo', 'spec', 'permits.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('^R-cxsjfa', '^R-cx'));
  }
}
if (mode === 'skopo-report') {
  write(join(out, 'report', 'summary.md'), SUMMARY);
  assembleReport(out);
  writeReportPage(out);
}

emit({
  type: 'result', subtype: 'success', is_error: false, num_turns: 3, permission_denials: [],
  subagent_stats: { total: 1, failed: 0 }, total_cost_usd: 0.01,
  modelUsage: { 'fake-model': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2, cacheCreationInputTokens: 1, costUSD: 0.01 } },
});
