import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createProjectService } from '../../skills/excavator/project-service.mjs';
import { commitSemanticCacheEntry } from '../../skills/excavator/semantic-cache.mjs';
import { applySemanticPatches } from '../../skills/excavator/apply-semantic-patches.mjs';
import { selectStaleFiles } from '../../skills/excavator/select-stale-semantics.mjs';
import { resolveSourceSnapshot } from '../../skills/excavator/source-snapshot.mjs';
import { IDS, makeMcpFixture } from './fixture.mjs';

const cleanup = [];
afterEach(() => { while (cleanup.length) cleanup.pop()(); });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const CLI = resolve(process.cwd(), 'skills/excavator/semantic-cache-reuse.mjs');

function make() {
  const fixture = makeMcpFixture();
  cleanup.push(fixture.cleanup);
  const service = createProjectService(fixture.root);
  const filePath = 'src/missing.ts';
  const hash = fixture.manifest.entries.find((entry) => entry.path === filePath).contentHash;
  const fields = { summary: 'Loads a local value.', tags: ['load'], semanticSourceHash: hash,
    model: 'host-model', generatedAt: '2026-09-16T01:00:00.000Z' };
  return { fixture, service, filePath, hash, fields };
}

describe('one semantic cache across Lazy, Full and MCP', () => {
  it('Full Phase F and MCP return identical node-level reuse buckets on one snapshot', async () => {
    const { fixture, service } = make();
    const nodeIds = fixture.graph.nodes.map((node) => node.id);
    const full = selectStaleFiles({ knowledgeGraph: fixture.graph,
      semanticCache: fixture.cache, manifest: fixture.manifest });
    const mcp = await service.semanticPlan({ nodeIds });
    expect(full.plan.reuse).toEqual(mcp.data.reuse);
    expect(full.plan.generate).toEqual(mcp.data.generate.map(({ evidence, ...item }) => item));
    expect(full.plan.unavailable).toEqual(mcp.data.unavailable);
    expect(full.plan.counts).toEqual(mcp.data.counts);
  });
  it('Lazy writer -> MCP reuses; plan performs zero writes and preserves cache SHA/provenance', async () => {
    const { fixture, service, filePath, fields } = make();
    const write = await commitSemanticCacheEntry({ projectRoot: fixture.root, nodeId: IDS.missing,
      filePath, fields, verifyNodePath: true, onlyIfNotFresh: true });
    expect(write.status).toBe('committed');
    const before = fixture.readCacheBytes();
    const plan = await service.semanticPlan({ nodeIds: [IDS.missing, IDS.a] });
    expect(plan.data.counts).toMatchObject({ requested: 2, reuse: 2, generate: 0 });
    expect(fixture.readCacheBytes()).toEqual(before);
    expect(sha(fixture.readCacheBytes())).toBe(sha(before));
  });

  it('MCP commit -> Lazy CLI reuses exact same entry without a second cache', async () => {
    const { fixture, service, filePath, fields } = make();
    expect((await service.semanticCommit({ nodeId: IDS.missing, filePath, fields })).status).toBe('ok');
    const before = fixture.readCacheBytes();
    const raw = execFileSync(process.execPath, [CLI, fixture.root, '--node-id', IDS.missing], { encoding: 'utf-8' });
    const plan = JSON.parse(raw);
    expect(plan.counts).toMatchObject({ requested: 1, reuse: 1, generate: 0 });
    expect(plan.reuse[0].summary).toBe(fields.summary);
    expect(fixture.readCacheBytes()).toEqual(before);
  });

  it('Full patch writer -> MCP reuses', async () => {
    const { fixture, service, filePath, fields } = make();
    const result = await applySemanticPatches({ projectRoot: fixture.root,
      factNodeIds: fixture.graph.nodes.map((node) => node.id),
      patches: [{ nodeId: IDS.missing, filePath, ...fields }],
    });
    expect(result.committed).toBe(1);
    const before = fixture.readCacheBytes();
    const plan = await service.semanticPlan({ nodeIds: [IDS.missing] });
    expect(plan.data.counts).toMatchObject({ reuse: 1, generate: 0 });
    expect(fixture.readCacheBytes()).toEqual(before);
  });

  it('only a changed file becomes stale; same-content different path remains fresh', async () => {
    const { fixture, service } = make();
    const before = fixture.readCacheBytes();
    writeFileSync(join(fixture.root, 'src', 'same-a.ts'), 'export function save() { return 9; }\n');
    const snapshot = resolveSourceSnapshot(fixture.root);
    const manifest = { ...fixture.manifest, sourceRevision: snapshot.revision,
      selectionDigest: snapshot.selectionDigest, entries: snapshot.entries() };
    writeFileSync(join(fixture.root, '.excavator', 'source-manifest.json'), JSON.stringify(manifest));
    const plan = await service.semanticPlan({ nodeIds: [IDS.a, IDS.b] });
    expect(plan.data.generate.map((item) => [item.nodeId, item.reason])).toEqual([[IDS.a, 'stale']]);
    expect(plan.data.reuse.map((item) => item.nodeId)).toEqual([IDS.b]);
    expect(fixture.readCacheBytes()).toEqual(before);
  });

  it('shared lock rejects a forged node/path and preserves the first of two same-hash submissions', async () => {
    const { fixture, filePath, fields } = make();
    const graphBefore = sha(readFileSync(join(fixture.root, '.excavator', 'knowledge-graph.json')));
    const forged = await commitSemanticCacheEntry({ projectRoot: fixture.root, nodeId: IDS.ownerB,
      filePath: 'src/same-a.ts', fields: { ...fields,
        semanticSourceHash: fixture.manifest.entries.find((entry) => entry.path === 'src/same-a.ts').contentHash },
      verifyNodePath: true, onlyIfNotFresh: true });
    expect(forged.status).toBe('node-path-mismatch');
    const first = await commitSemanticCacheEntry({ projectRoot: fixture.root, nodeId: IDS.missing,
      filePath, fields, verifyNodePath: true, onlyIfNotFresh: true });
    expect(first.status).toBe('committed');
    const bytes = fixture.readCacheBytes();
    const second = await commitSemanticCacheEntry({ projectRoot: fixture.root, nodeId: IDS.missing,
      filePath, fields: { ...fields, summary: 'Reworded after another host already committed.' },
      verifyNodePath: true, onlyIfNotFresh: true });
    expect(second.status).toBe('already-fresh');
    expect(fixture.readCacheBytes()).toEqual(bytes);
    expect(sha(readFileSync(join(fixture.root, '.excavator', 'knowledge-graph.json')))).toBe(graphBefore);
  });
});
