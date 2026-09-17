#!/usr/bin/env node
/** One local project, stdio-only, deterministic tools. stdout is MCP-only. */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

import { createProjectService } from './project-service.mjs';

const revision = z.string().min(1).max(180).optional();
const nodeId = z.string().min(1).max(300);
const sourcePath = z.string().min(1).max(600);
const terms = z.array(z.string().min(1).max(80)).max(12);
const ids = z.array(nodeId).max(20);

function toolResult(result, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
    ...(isError ? { isError: true } : {}),
  };
}

export function createMcpServer(projectRoot) {
  const service = createProjectService(projectRoot);
  const server = new McpServer({ name: 'excavator', version: '2.9.6' });

  function register(name, description, inputSchema, handler) {
    server.registerTool(name, { description, inputSchema }, async (args) => {
      try {
        const result = await handler(args);
        return toolResult(result, ['error', 'containment'].includes(result.status));
      } catch (error) {
        // A request rejected for invalid input or path containment did no
        // project work, so it has no snapshot to report. Never resolve the
        // source snapshot on the error path: on a large repo that makes a
        // rejected call as expensive as a real one (resolve is O(files)).
        const code = error.code === 'containment' ? 'containment' : 'invalid-request';
        return toolResult({ status: error.code === 'containment' ? 'containment' : 'error',
          snapshot: null, data: null, coverage: { gapsCount: 1 },
          gaps: [{ kind: code }], budget: null, boundary: null,
          error: { code, message: error.message } }, true);
      }
    });
  }

  register('project_status', 'Report the bound project snapshot, fact products, freshness and gaps; no model calls.',
    z.object({ expectedRevision: revision }).strict(), (args) => service.projectStatus(args));
  register('sync_facts', 'Refresh deterministic facts and index only; does not generate semantic text.',
    z.object({}).strict(), () => service.syncFacts());
  register('recall', 'Rank bounded candidates from explicit caller-supplied terms, identities and paths; refine or page if truncated.',
    z.object({ terms: terms.optional(), exactIds: ids.optional(), paths: z.array(sourcePath).max(20).optional(),
      limit: z.number().int().min(1).max(50).optional(), offset: z.number().int().min(0).max(500).optional(),
      expectedRevision: revision }).strict(), (args) => service.recall(args));
  register('traverse', 'Traverse deterministic fact edges from explicit node ids with a visible budget and continuation boundary.',
    z.object({ seedIds: z.array(nodeId).min(1).max(10), targetIds: z.array(nodeId).max(10).optional(),
      mode: z.enum(['one-hop', 'bfs', 'shortest-path']).optional(),
      maxHops: z.number().int().min(1).max(8).optional(), maxNodes: z.number().int().min(1).max(500).optional(),
      maxEdges: z.number().int().min(1).max(1000).optional(), expectedRevision: revision }).strict(),
    (args) => service.traverse(args));
  register('read_evidence', 'Read a bounded current source range by canonical project-relative path or exact fact node id.',
    z.object({ path: sourcePath.optional(), nodeId: nodeId.optional(),
      startLine: z.number().int().min(1).optional(), startColumn: z.number().int().min(1).optional(),
      endLine: z.number().int().min(1).optional(),
      maxChars: z.number().int().min(1).max(20_000).optional(), expectedRevision: revision }).strict(),
    (args) => service.readEvidence(args));
  register('semantic_plan', 'Reuse fresh node-local English semantics; return bounded source evidence only for missing or stale nodes.',
    z.object({ nodeIds: z.array(nodeId).min(1).max(20),
      maxEvidenceChars: z.number().int().min(1).max(4_000).optional(), expectedRevision: revision }).strict(),
    (args) => service.semanticPlan(args));
  register('semantic_commit', 'Conditionally commit caller-written English node-local summary/tags through the shared locked CAS writer.',
    z.object({ nodeId, filePath: sourcePath, expectedRevision: revision,
      fields: z.object({ summary: z.string().min(1).max(4_000), tags: z.array(z.string().min(1).max(80)).max(20).optional(),
        semanticSourceHash: z.string().min(1).max(128), model: z.string().min(1).max(160).optional(),
        generatedAt: z.string().datetime().optional(),
        verification: z.enum(['verified', 'unverified', 'dirty', 'contradicted']).optional(),
      }).strict() }).strict(), (args) => service.semanticCommit(args));

  return server;
}

function parseProjectRoot(argv) {
  if (argv.length !== 2 || argv[0] !== '--project-root' || !argv[1]) {
    throw new Error('Usage: node mcp-server.mjs --project-root <absolute-or-relative-project-root>');
  }
  return argv[1];
}

function isCliEntry() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isCliEntry()) {
  try {
    const root = parseProjectRoot(process.argv.slice(2));
    void serveStdio(() => createMcpServer(root));
  } catch (error) {
    process.stderr.write(`excavator MCP startup failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
