#!/usr/bin/env node
/**
 * mcp-smoke.mjs
 *
 * O6's MCP half (openspec: changes/runner-image, design.md D4/D5): calls
 * each of the seven Excavator MCP tools once, over the real stdio protocol,
 * against a project root that already has facts (a prior `lazy` or `full`
 * run). Prints one PASS/FAIL line per tool and exits non-zero on any
 * failure. This proves the MCP server actually answers inside the runner
 * image; it does not replace docs/mcp.md's fuller host-workflow guidance.
 *
 * `semantic_commit` writes one real entry into `.excavator/semantic-cache.json`
 * on whatever project root it is given, clearly marked as a smoke value
 * (see SMOKE_TAG below). Only ever run this against a throwaway copy of a
 * repository, never a working copy someone cares about.
 *
 * Usage: node mcp-smoke.mjs --project-root <path>
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '../skills/excavator/mcp-server.mjs');

export const SMOKE_TAG = '[excavator-runner-image mcp-smoke]';

/** The seven tools, in the same order mcp-server.mjs registers them. */
export const TOOLS_IN_ORDER = Object.freeze([
  'project_status', 'sync_facts', 'recall', 'traverse', 'read_evidence', 'semantic_plan', 'semantic_commit',
]);

function parseArgs(argv) {
  const i = argv.indexOf('--project-root');
  if (i === -1 || !argv[i + 1]) {
    throw new Error('Usage: node mcp-smoke.mjs --project-root <path>');
  }
  return { projectRoot: argv[i + 1] };
}

/** Pick a representative node to drive recall/traverse/read_evidence/semantic_plan with a real id. */
export function pickSmokeNode(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  if (nodes.length === 0) return null;
  return nodes.find((n) => n?.type === 'file' && typeof n.filePath === 'string')
    ?? nodes.find((n) => typeof n?.filePath === 'string')
    ?? nodes[0];
}

async function connect(root) {
  const client = new Client({ name: 'excavator-runner-image-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [SERVER_PATH, '--project-root', root],
    stderr: 'pipe',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
  });
  await client.connect(transport);
  return client;
}

async function main() {
  const { projectRoot } = parseArgs(process.argv.slice(2));
  // The server canonicalises the root with realpath (project-paths.mjs
  // bindProjectRoot); compare against the same canonical form so this
  // assertion is not thrown off by e.g. macOS's /tmp -> /private/tmp symlink.
  const expectedProjectRoot = realpathSync(resolve(projectRoot));

  const graphPath = join(expectedProjectRoot, '.excavator', 'knowledge-graph.json');
  if (!existsSync(graphPath)) {
    process.stderr.write(`mcp-smoke: no .excavator/knowledge-graph.json under ${expectedProjectRoot} — run lazy or full first\n`);
    process.exitCode = 1;
    return;
  }
  const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
  const smokeNode = pickSmokeNode(graph);
  if (!smokeNode) {
    process.stderr.write('mcp-smoke: knowledge graph has no nodes to exercise recall/traverse/read_evidence with\n');
    process.exitCode = 1;
    return;
  }

  const client = await connect(projectRoot);
  let failed = false;
  const pass = (tool) => process.stdout.write(`PASS ${tool}\n`);
  const fail = (tool, reason) => { failed = true; process.stdout.write(`FAIL ${tool}: ${reason}\n`); };

  try {
    // 1. project_status
    try {
      const result = await client.callTool({ name: 'project_status', arguments: {} });
      const actualRoot = result.structuredContent?.data?.projectRoot;
      if (actualRoot === expectedProjectRoot) pass('project_status');
      else fail('project_status', `data.projectRoot was ${JSON.stringify(actualRoot)}, expected ${JSON.stringify(expectedProjectRoot)}`);
    } catch (err) { fail('project_status', err.message); }

    // 2. sync_facts
    try {
      const result = await client.callTool({ name: 'sync_facts', arguments: {} });
      if (result.structuredContent?.status === 'ok') pass('sync_facts');
      else fail('sync_facts', `status was ${JSON.stringify(result.structuredContent?.status)}`);
    } catch (err) { fail('sync_facts', err.message); }

    // 3. recall (exact-id match on the smoke node, so it succeeds regardless of index freshness)
    try {
      const result = await client.callTool({ name: 'recall', arguments: { exactIds: [smokeNode.id] } });
      if (result.structuredContent?.status === 'ok') pass('recall');
      else fail('recall', `status was ${JSON.stringify(result.structuredContent?.status)}`);
    } catch (err) { fail('recall', err.message); }

    // 4. traverse
    try {
      const result = await client.callTool({ name: 'traverse', arguments: { seedIds: [smokeNode.id], mode: 'one-hop' } });
      if (result.structuredContent?.status === 'ok') pass('traverse');
      else fail('traverse', `status was ${JSON.stringify(result.structuredContent?.status)}`);
    } catch (err) { fail('traverse', err.message); }

    // 5. read_evidence
    try {
      const result = await client.callTool({ name: 'read_evidence', arguments: { nodeId: smokeNode.id } });
      if (result.structuredContent?.status === 'ok') pass('read_evidence');
      else fail('read_evidence', `status was ${JSON.stringify(result.structuredContent?.status)}`);
    } catch (err) { fail('read_evidence', err.message); }

    // 6. semantic_plan — also the source of the hash semantic_commit needs.
    let commitCandidate = null;
    try {
      const result = await client.callTool({ name: 'semantic_plan', arguments: { nodeIds: [smokeNode.id] } });
      if (result.structuredContent?.status === 'ok') {
        pass('semantic_plan');
        const generateItem = result.structuredContent.data?.generate?.[0];
        const reuseItem = result.structuredContent.data?.reuse?.[0];
        if (generateItem) commitCandidate = { nodeId: generateItem.nodeId, filePath: generateItem.filePath, semanticSourceHash: generateItem.currentContentHash };
        else if (reuseItem) commitCandidate = null; // already fresh; nothing to (re)commit — see semantic_commit below.
      } else {
        fail('semantic_plan', `status was ${JSON.stringify(result.structuredContent?.status)}`);
      }
    } catch (err) { fail('semantic_plan', err.message); }

    // 7. semantic_commit — writes one smoke-tagged entry, or is a documented
    // no-op when semantic_plan found the node already fresh (nothing to
    // commit is not a tool failure).
    try {
      if (!commitCandidate) {
        pass('semantic_commit (skipped: node already has a fresh cache entry, nothing to commit)');
      } else {
        const result = await client.callTool({
          name: 'semantic_commit',
          arguments: {
            nodeId: commitCandidate.nodeId,
            filePath: commitCandidate.filePath,
            fields: {
              summary: `${SMOKE_TAG} runner-image mcp-smoke wrote this entry; safe to ignore or delete.`,
              tags: ['smoke-test'],
              semanticSourceHash: commitCandidate.semanticSourceHash,
              model: 'excavator-runner-image-smoke',
            },
          },
        });
        if (result.structuredContent?.status === 'ok') pass('semantic_commit');
        else fail('semantic_commit', `status was ${JSON.stringify(result.structuredContent?.status)}: ${JSON.stringify(result.structuredContent?.error)}`);
      }
    } catch (err) { fail('semantic_commit', err.message); }
  } finally {
    await client.close();
  }

  process.exitCode = failed ? 1 : 0;
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
  try {
    await main();
  } catch (err) {
    process.stderr.write(`mcp-smoke.mjs failed: ${err.message}\n`);
    process.exitCode = 1;
  }
}

export default { TOOLS_IN_ORDER, SMOKE_TAG, pickSmokeNode };
