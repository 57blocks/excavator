import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkLoad, resolveExpectedAgentIds, readExpectedAgentIds } from '../../deploy/run-excavator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const fixturesDir = resolve(__dirname, '../fixtures/deploy');

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));
}

// The expected agent set is derived from the repo's own agents/*.md, exactly
// the way readExpectedAgentIds does at runtime, so this stays in sync with
// the real checkout instead of hand-copying the list.
const REAL_AGENT_FILENAMES = readdirSync(join(repoRoot, 'agents'));
const EXPECTED_AGENT_IDS = resolveExpectedAgentIds(REAL_AGENT_FILENAMES);
const EXPECTED_PLUGIN_PATH = '/opt/excavator';

function check(fixtureName) {
  const initEvent = loadFixture(fixtureName);
  return checkLoad({ initEvent, expectedAgentIds: EXPECTED_AGENT_IDS, expectedPluginPath: EXPECTED_PLUGIN_PATH });
}

describe('resolveExpectedAgentIds (task 2.2)', () => {
  it('derives excavator:<stem> ids only from .md files, sorted', () => {
    const ids = resolveExpectedAgentIds(['b-agent.md', 'a-agent.md', 'README.txt']);
    expect(ids).toEqual(['excavator:a-agent', 'excavator:b-agent']);
  });

  it('readExpectedAgentIds reads the real checkout and finds all ten agents', () => {
    const ids = readExpectedAgentIds(repoRoot);
    expect(ids).toEqual(EXPECTED_AGENT_IDS);
    expect(ids.length).toBe(10);
  });

  it('readExpectedAgentIds returns an empty list for a missing agents/ dir, not a throw', () => {
    expect(readExpectedAgentIds('/no/such/plugin/dir')).toEqual([]);
  });
});

describe('checkLoad (task 2.2, design D4 "加载" / O3)', () => {
  it('passes the positive sample (real neutral-cwd probe shape, sanitized)', () => {
    const result = check('init-good.json');
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('the missing-agent fixture differs from the good one in exactly one field', () => {
    const good = loadFixture('init-good.json');
    const missing = loadFixture('init-missing-agent.json');
    const goodWithoutSessionAndAgents = { ...good, session_id: null, agents: null };
    const missingWithoutSessionAndAgents = { ...missing, session_id: null, agents: null };
    // Every field except session_id (a fixture bookkeeping id) and agents is identical.
    expect(missingWithoutSessionAndAgents).toEqual(goodWithoutSessionAndAgents);
    // agents differs by exactly one entry.
    const removed = good.agents.filter((a) => !missing.agents.includes(a));
    expect(removed).toEqual(['excavator:excavator-summary-verifier']);
    expect(missing.agents.length).toBe(good.agents.length - 1);
  });

  it('fails when exactly one agent is missing, and names it', () => {
    const result = check('init-missing-agent.json');
    expect(result.ok).toBe(false);
    expect(result.missingAgents).toEqual(['excavator:excavator-summary-verifier']);
    expect(result.reasons.some((r) => r.includes('excavator:excavator-summary-verifier'))).toBe(true);
  });

  it('fails the bare-mode shape: no MCP server, no excavator agents, still lists the plugin', () => {
    const result = check('init-bare.json');
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('MCP'))).toBe(true);
    expect(result.missingAgents).toEqual(EXPECTED_AGENT_IDS);
  });

  it('fails when plugin_errors is non-empty', () => {
    const result = check('init-plugin-error.json');
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('plugin_errors'))).toBe(true);
  });

  it('fails when the excavator MCP server is present but not connected', () => {
    const result = check('init-mcp-not-connected.json');
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('status'))).toBe(true);
  });

  it('fails when the excavator MCP server entry is entirely absent', () => {
    const result = check('init-no-mcp-entry.json');
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('MCP'))).toBe(true);
  });

  it('fails when the plugin path does not match the expected checkout', () => {
    const result = check('init-wrong-plugin-path.json');
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('plugin path'))).toBe(true);
  });

  it('fails when neither Task nor Agent tool is available', () => {
    const result = check('init-no-task-tool.json');
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('task'))).toBe(true);
  });

  it('accepts "Agent" as an alternate name for the dispatch tool', () => {
    const initEvent = { ...loadFixture('init-good.json'), tools: ['Agent', 'Bash', 'Read', 'Edit'] };
    const result = checkLoad({ initEvent, expectedAgentIds: EXPECTED_AGENT_IDS, expectedPluginPath: EXPECTED_PLUGIN_PATH });
    expect(result.ok).toBe(true);
  });

  it('fails outright with no system/init event observed at all', () => {
    const result = checkLoad({ initEvent: null, expectedAgentIds: EXPECTED_AGENT_IDS, expectedPluginPath: EXPECTED_PLUGIN_PATH });
    expect(result.ok).toBe(false);
    expect(result.missingAgents).toEqual(EXPECTED_AGENT_IDS);
  });

  // No fourth state: an empty expected-agent set (agents/ missing, unreadable,
  // or containing no *.md) must not pass vacuously just because there was
  // nothing to be missing. It is a checkout-completeness failure on its own,
  // even against an otherwise-perfect init event.
  it('fails when the expected agent set is empty, even with an otherwise-perfect init event', () => {
    const initEvent = loadFixture('init-good.json');
    const result = checkLoad({ initEvent, expectedAgentIds: [], expectedPluginPath: EXPECTED_PLUGIN_PATH });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('no agents'))).toBe(true);
  });
});
