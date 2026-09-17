import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createProjectService } from '../../skills/excavator/project-service.mjs';
import { resolveSourceSnapshot } from '../../skills/excavator/source-snapshot.mjs';
import { IDS, makeMcpFixture } from './fixture.mjs';

const cleanup = [];
afterEach(() => { while (cleanup.length) cleanup.pop()(); });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixtureService() {
  const fixture = makeMcpFixture();
  cleanup.push(fixture.cleanup);
  return { fixture, service: createProjectService(fixture.root) };
}

describe('shared deterministic project service', () => {
  it('reports a comparable snapshot, current products, and missing products visibly', () => {
    const { fixture, service } = fixtureService();
    const fresh = service.projectStatus();
    expect(fresh.status).toBe('ok');
    expect(fresh.snapshot).toMatchObject({ revision: fixture.snapshot.revision, freshness: 'fresh' });
    expect(fresh.data.indexAvailable).toBe(true);

    unlinkSync(join(fixture.root, '.excavator', 'source-index.json'));
    const missing = service.projectStatus();
    expect(missing.data.indexAvailable).toBe(false);
    expect(missing.gaps).toContainEqual({ kind: 'missing-product', product: 'source-index.json' });
  });

  it('plans distinct identities, only generate nodes have bounded evidence, and plan is read-only', async () => {
    const { fixture, service } = fixtureService();
    const before = fixture.readCacheBytes();
    const plan = await service.semanticPlan({ nodeIds: [IDS.a, IDS.b, IDS.ownerA, IDS.missing, IDS.orphan] });
    expect(plan.status).toBe('ok');
    expect(plan.data.reuse.map((x) => x.nodeId)).toEqual([IDS.a, IDS.b]);
    expect(plan.data.generate.map((x) => [x.nodeId, x.reason])).toEqual([
      [IDS.ownerA, 'stale'], [IDS.missing, 'missing'],
    ]);
    expect(plan.data.generate[0].evidence).toMatchObject({ path: 'src/owners.ts', complete: true });
    expect(plan.data.unavailable).toContainEqual({ nodeId: IDS.orphan, filePath: 'src/orphan.ts', reason: 'path-not-in-manifest' });
    expect(fixture.readCacheBytes()).toEqual(before);
    const tiny = await service.semanticPlan({ nodeIds: [IDS.missing], maxEvidenceChars: 1 });
    expect(tiny.boundary).toMatchObject({ truncated: true, nodeIdsNeedingMoreEvidence: [IDS.missing] });
    expect(tiny.gaps).toContainEqual({ kind: 'evidence-truncated', nodeId: IDS.missing });
  });

  it('reads current line evidence and rejects stale client revisions or path escape', () => {
    const { service } = fixtureService();
    const read = service.readEvidence({ nodeId: IDS.ownerB });
    expect(read.status).toBe('ok');
    expect(read.data).toMatchObject({ path: 'src/owners.ts', startLine: 2, endLine: 2 });
    expect(read.data.text).toContain('OwnerB');
    const firstChunk = service.readEvidence({ nodeId: IDS.ownerB, maxChars: 7 });
    expect(firstChunk.boundary).toMatchObject({ truncated: true, nextStartLine: 2, nextStartColumn: 8 });
    const nextChunk = service.readEvidence({ nodeId: IDS.ownerB, startLine: firstChunk.boundary.nextStartLine,
      startColumn: firstChunk.boundary.nextStartColumn, maxChars: 100 });
    expect(firstChunk.data.text + nextChunk.data.text).toBe(read.data.text);
    expect(service.readEvidence({ nodeId: IDS.ownerB, expectedRevision: 'old' }).status).toBe('stale-snapshot');
    expect(() => service.readEvidence({ path: '../secret.ts' })).toThrow(/canonical/);
    expect(() => service.readEvidence({ path: '/etc/passwd' })).toThrow(/canonical/);
    expect(() => service.readEvidence({ path: 'src/escape.ts' })).toThrow(/snapshot/);
  });

  it('uses existing recall/traversal primitives with explicit budgets and boundary', async () => {
    const { service } = fixtureService();
    const recall = await service.recall({ terms: ['save'], limit: 1 });
    expect(recall.status).toBe('ok');
    expect(recall.data.candidates).toHaveLength(1);
    expect(recall.budget.used).toBe(1);
    expect(recall.boundary.truncated).toBe(true);
    const walk = service.traverse({ seedIds: [IDS.a], maxNodes: 2 });
    expect(walk.status).toBe('ok');
    expect(walk.boundary).toMatchObject({ truncated: true, reason: 'node-budget' });
    expect(walk.boundary.unexpandedNodeIds).toContain(IDS.ownerA);
    expect(service.traverse({ seedIds: ['not-a-node'] }).gaps)
      .toContainEqual({ kind: 'unknown-node', nodeId: 'not-a-node' });
  });

  it('reports the 80-node default boundary and supports a second bounded pass', () => {
    const { fixture, service } = fixtureService();
    const ids = Array.from({ length: 100 }, (_, i) => `function:src/same-a.ts:step${i}()`);
    const graph = { ...fixture.graph,
      nodes: ids.map((id, i) => ({ id, type: 'function', name: `step${i}`, filePath: 'src/same-a.ts', lineRange: [1, 1] })),
      edges: ids.slice(1).map((id) => ({ type: 'calls', source: ids[0], target: id })),
    };
    writeFileSync(join(fixture.root, '.excavator', 'knowledge-graph.json'), JSON.stringify(graph));
    const first = service.traverse({ seedIds: [ids[0]] });
    expect(first.budget.usedNodes).toBe(80);
    expect(first.boundary).toMatchObject({ truncated: true, reason: 'node-budget' });
    expect(first.boundary.unexpandedNodeIds).toContain(ids[80]);
    const second = service.traverse({ seedIds: first.boundary.unexpandedNodeIds.slice(0, 10), maxNodes: 80 });
    const third = service.traverse({ seedIds: first.boundary.unexpandedNodeIds.slice(10), maxNodes: 80 });
    const union = new Set([...first.data.nodes.map((n) => n.id),
      ...second.data.nodes.map((n) => n.id), ...third.data.nodes.map((n) => n.id)]);
    expect(union.size).toBe(100);
  });

  it('keeps cache and fact graph byte-identical for a duplicate fresh commit', async () => {
    const { fixture, service } = fixtureService();
    const beforeCache = fixture.readCacheBytes();
    const beforeGraph = sha(readFileSync(join(fixture.root, '.excavator', 'knowledge-graph.json')));
    const fields = { summary: 'New but redundant description.', tags: ['redundant'],
      semanticSourceHash: fixture.manifest.entries.find((e) => e.path === 'src/same-a.ts').contentHash,
      model: 'caller', generatedAt: '2026-09-16T01:00:00.000Z' };
    const result = await service.semanticCommit({ nodeId: IDS.a, filePath: 'src/same-a.ts', fields });
    expect(result.status).toBe('already-fresh');
    expect(fixture.readCacheBytes()).toEqual(beforeCache);
    expect(sha(readFileSync(join(fixture.root, '.excavator', 'knowledge-graph.json')))).toBe(beforeGraph);
  });

  it('rejects forged node/path, stale hash, and Chinese model prose without changing facts', async () => {
    const { fixture, service } = fixtureService();
    const beforeGraph = sha(readFileSync(join(fixture.root, '.excavator', 'knowledge-graph.json')));
    const fields = { summary: 'Loads a local value.', tags: ['load'],
      semanticSourceHash: fixture.manifest.entries.find((e) => e.path === 'src/missing.ts').contentHash,
      model: 'caller', generatedAt: '2026-09-16T01:00:00.000Z' };
    expect((await service.semanticCommit({ nodeId: IDS.missing, filePath: 'src/same-a.ts', fields })).status).toBe('unavailable');
    expect((await service.semanticCommit({ nodeId: IDS.missing, filePath: 'src/missing.ts',
      fields: { ...fields, semanticSourceHash: 'old' } })).status).toBe('stale-hash');
    expect((await service.semanticCommit({ nodeId: IDS.missing, filePath: 'src/missing.ts',
      fields: { ...fields, summary: '加载本地值。' } })).status).toBe('noncanonical-language');
    expect((await service.semanticCommit({ nodeId: IDS.missing, filePath: 'src/missing.ts', fields })).status).toBe('ok');
    expect(sha(readFileSync(join(fixture.root, '.excavator', 'knowledge-graph.json')))).toBe(beforeGraph);
  });

  it('detects source drift instead of claiming stale artifacts are fresh', () => {
    const { fixture, service } = fixtureService();
    writeFileSync(join(fixture.root, 'src', 'missing.ts'), 'export function load() { return 99; }\n');
    const status = service.projectStatus();
    expect(status.snapshot.freshness).toBe('stale');
    expect(service.readEvidence({ nodeId: IDS.missing }).status).toBe('stale-snapshot');
  });

  it('detects source drift during a read and drops the now-old evidence', () => {
    const fixture = makeMcpFixture();
    cleanup.push(fixture.cleanup);
    let calls = 0;
    const service = createProjectService(fixture.root, { snapshotFactory: (root) => {
      calls++;
      if (calls === 2) writeFileSync(join(root, 'src', 'missing.ts'), 'export function load() { return 99; }\n');
      return resolveSourceSnapshot(root);
    } });
    const result = service.readEvidence({ nodeId: IDS.missing });
    expect(result).toMatchObject({ status: 'stale-snapshot', data: null,
      error: { code: 'stale-snapshot', retryable: true } });
    expect(result.gaps).toContainEqual({ kind: 'source-changed-during-call' });
  });

  it('cold sync builds deterministic facts without changing source bytes', async () => {
    const { fixture, service } = fixtureService();
    const sourcePath = join(fixture.root, 'src', 'missing.ts');
    const sourceBefore = sha(readFileSync(sourcePath));
    rmSync(join(fixture.root, '.excavator'), { recursive: true });
    const cold = service.projectStatus();
    expect(cold.snapshot.freshness).toBe('missing');
    const result = await service.syncFacts();
    expect(result.status).toBe('ok');
    expect(result.snapshot.freshness).toBe('fresh');
    expect(result.data.kind).toBe('full-rebuild');
    expect(result.data.metaAdvanced).toBe(true);
    expect(sha(readFileSync(sourcePath))).toBe(sourceBefore);
    writeFileSync(sourcePath, 'export function load() { return 9; }\n');
    expect(service.projectStatus().snapshot.freshness).toBe('stale');
    const synced = await service.syncFacts();
    expect(synced.status).toBe('ok');
    expect(synced.data.kind).toBe('synced');
    expect(synced.data.changed.modified).toContain('src/missing.ts');
    expect(synced.snapshot.freshness).toBe('fresh');
  }, 30_000);
});
