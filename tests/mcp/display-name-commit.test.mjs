// displayName oracle 6 (node-display-name): semantic_commit over real stdio
// accepts a commit carrying displayName and rejects one without it.
import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { IDS, makeMcpFixture } from './fixture.mjs';

const SERVER_PATH = resolve(process.cwd(), 'skills/excavator/mcp-server.mjs');
const cleanup = [];
afterEach(() => { while (cleanup.length) cleanup.pop()(); });

async function setup() {
  const fixture = makeMcpFixture();
  cleanup.push(fixture.cleanup);
  const client = new Client({ name: 'excavator-display-name', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [SERVER_PATH, '--project-root', fixture.root],
    cwd: process.cwd(), stderr: 'pipe',
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
  });
  await client.connect(transport);
  cleanup.push(() => client.close());
  const hash = fixture.manifest.entries.find((e) => e.path === 'src/missing.ts').contentHash;
  const fields = {
    summary: 'Loads a local value.', tags: ['load'], semanticSourceHash: hash,
    model: 'caller', generatedAt: '2026-09-16T01:00:00.000Z',
  };
  return { client, fields };
}

describe('semantic_commit displayName', () => {
  it('accepts a commit carrying displayName', async () => {
    const { client, fields } = await setup();
    const result = await client.callTool({ name: 'semantic_commit', arguments: {
      nodeId: IDS.missing, filePath: 'src/missing.ts', fields: { ...fields, displayName: 'Load local value' },
    } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.status).toBe('ok');
  }, 30_000);

  it('rejects a commit without displayName', async () => {
    const { client, fields } = await setup();
    let rejected = false;
    try {
      const result = await client.callTool({ name: 'semantic_commit', arguments: {
        nodeId: IDS.missing, filePath: 'src/missing.ts', fields,
      } });
      rejected = result.isError === true;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  }, 30_000);
});
