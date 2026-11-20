// node-display-name: a fresh entry's displayName is retrieval text, like its
// summary and tags, for MCP recall and for chat's semantic-cache hits.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createProjectService } from '../../skills/excavator/project-service.mjs';
import { IDS, makeMcpFixture } from './fixture.mjs';

const cleanup = [];
afterEach(() => { while (cleanup.length) cleanup.pop()(); });

describe('displayName as retrieval text', () => {
  it('recall finds a node by a term only its displayName holds', async () => {
    const fixture = makeMcpFixture();
    cleanup.push(fixture.cleanup);
    const service = createProjectService(fixture.root);
    const hash = fixture.manifest.entries.find((e) => e.path === 'src/missing.ts').contentHash;
    const commit = await service.semanticCommit({ nodeId: IDS.missing, filePath: 'src/missing.ts', fields: {
      summary: 'Loads a local value.', displayName: 'Approve refund request', tags: ['load'],
      semanticSourceHash: hash, model: 'caller', generatedAt: '2026-09-16T01:00:00.000Z',
    } });
    expect(commit.status).toBe('ok');

    const recall = await service.recall({ terms: ['refund'] });
    expect(recall.status).toBe('ok');
    const hit = recall.data.candidates.find((c) => c.nodeId === IDS.missing);
    expect(hit?.sources).toContain('semantic-cache');
  });

  it('chat lets a fresh entry\'s displayName feed retrieval', () => {
    const chat = readFileSync(join(process.cwd(), 'skills/excavator-chat/SKILL.md'), 'utf-8');
    expect(chat).toContain("Only a hash-fresh entry's `summary`/`displayName`/`tags` text may feed retrieval");
  });
});
