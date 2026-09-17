import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { EXPECTED_TOOLS } from './contract-oracle.test.mjs';
import { IDS, makeMcpFixture } from './fixture.mjs';
import { createProjectService } from '../../skills/excavator/project-service.mjs';

const SERVER_PATH = resolve(process.cwd(), 'skills/excavator/mcp-server.mjs');
const cleanup = [];
afterEach(() => { while (cleanup.length) cleanup.pop()(); });

async function connect(root) {
  const client = new Client({ name: 'excavator-acceptance', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [SERVER_PATH, '--project-root', root],
    cwd: process.cwd(), stderr: 'pipe',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
  });
  await client.connect(transport);
  cleanup.push(() => client.close());
  return client;
}

describe('real stdio MCP protocol', () => {
  it('handshakes without model keys, lists exactly seven tools, and calls bounded read tools', async () => {
    const fixture = makeMcpFixture();
    cleanup.push(fixture.cleanup);
    const client = await connect(fixture.root);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    for (const tool of tools) expect(tool.inputSchema.type).toBe('object');

    const status = await client.callTool({ name: 'project_status', arguments: {} });
    expect(status.structuredContent).toMatchObject({ status: 'ok',
      snapshot: { revision: fixture.snapshot.revision, freshness: 'fresh' } });
    const sync = await client.callTool({ name: 'sync_facts', arguments: {} });
    expect(sync.structuredContent).toMatchObject({ status: 'ok', data: { kind: 'skipped' } });
    const plan = await client.callTool({ name: 'semantic_plan', arguments: { nodeIds: [IDS.a, IDS.missing] } });
    expect(plan.structuredContent.data.counts).toMatchObject({ requested: 2, reuse: 1, generate: 1 });
    const evidence = await client.callTool({ name: 'read_evidence', arguments: { nodeId: IDS.missing } });
    expect(evidence.structuredContent.data.text).toContain('load');
    const tooLarge = await client.callTool({ name: 'read_evidence', arguments: { path: 'src/owners.ts',
      startLine: 1, endLine: 1000 } });
    expect(tooLarge.isError).toBe(true);
    expect(tooLarge.structuredContent.error.code).toBe('invalid-request');
    const recall = await client.callTool({ name: 'recall', arguments: { terms: ['save'], limit: 1 } });
    expect(recall.structuredContent.budget.used).toBe(1);
    const traverse = await client.callTool({ name: 'traverse', arguments: { seedIds: [IDS.a], maxNodes: 2 } });
    expect(traverse.structuredContent.boundary.truncated).toBe(true);
    const service = createProjectService(fixture.root);
    expect(recall.structuredContent).toEqual(await service.recall({ terms: ['save'], limit: 1 }));
    expect(traverse.structuredContent).toEqual(service.traverse({ seedIds: [IDS.a], maxNodes: 2 }));
    expect(evidence.structuredContent).toEqual(service.readEvidence({ nodeId: IDS.missing }));
    await expect(client.callTool({ name: 'answer_question', arguments: { question: 'anything' } })).rejects.toThrow();
  }, 30_000);

  it('returns a structured containment error for an external source path', async () => {
    const fixture = makeMcpFixture();
    cleanup.push(fixture.cleanup);
    const client = await connect(fixture.root);
    const result = await client.callTool({ name: 'read_evidence', arguments: { path: '../secret.ts' } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: 'containment', error: { code: 'containment' } });
  }, 30_000);
});
