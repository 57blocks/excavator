// Group 3 (openspec: changes/full-semantic-isolation, capability
// `domain-freshness`) — domain-graph.json records the sourceRevision +
// factDigest it was produced against, and a consumer gate refuses to treat a
// domain graph as usable once either has moved.
//
// Purpose-built synthetic fixtures only (AGENTS.md: no real-project source).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { annotateDomain } from '../../skills/excavator-domain/annotate-domain.mjs';
import { isDomainGraphUsable, resolveDomainFreshness } from '../../skills/excavator-domain/domain-freshness.mjs';
import {
  DOMAIN_CONTENT_LANGUAGE,
  DOMAIN_GRAPH_VERSION,
} from '../../skills/excavator-domain/domain-contract.mjs';
import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const ANNOTATE_DOMAIN = resolve(repoRoot, 'skills/excavator-domain/annotate-domain.mjs');

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'excavator-domain-freshness-'));
  roots.push(dir);
  return dir;
}

function knowledge(factsDigest = 'f'.repeat(64)) {
  return {
    version: '1.0.0',
    project: { name: 'fixture', languages: ['typescript'], gitCommitHash: null, factsDigest },
    nodes: [
      { id: 'file:src/a.ts', type: 'file', name: 'a.ts', filePath: 'src/a.ts', summary: '', tags: [], complexity: 'simple' },
    ],
    edges: [], layers: [], tour: [],
  };
}

function domain(nodes = []) {
  return {
    version: '1.0.0',
    project: { name: 'fixture', languages: ['typescript'], gitCommitHash: null },
    nodes, edges: [], layers: [], tour: [],
  };
}

// ---------------------------------------------------------------------------
// Write side: annotateDomain stamps sourceRevision + factDigest.
// ---------------------------------------------------------------------------

describe('annotateDomain stamps domain freshness keys at the top level', () => {
  it('writes sourceRevision and factDigest when both are known', () => {
    const { annotated } = annotateDomain({
      domainGraph: domain(), knowledgeGraph: knowledge('a'.repeat(64)), sourceRevision: 'git:' + 'b'.repeat(40),
    });
    expect(annotated.sourceRevision).toBe('git:' + 'b'.repeat(40));
    expect(annotated.factDigest).toBe('a'.repeat(64));
    expect(annotated.version).toBe(DOMAIN_GRAPH_VERSION);
    expect(annotated.contentLanguage).toBe(DOMAIN_CONTENT_LANGUAGE);
  });

  it('stamps no sourceRevision/factDigest key at all when neither is known — never fabricates a match', () => {
    const { annotated } = annotateDomain({ domainGraph: domain(), knowledgeGraph: null });
    expect(Object.hasOwn(annotated, 'sourceRevision')).toBe(false);
    expect(Object.hasOwn(annotated, 'factDigest')).toBe(false);
  });

  it('stamps factDigest alone when a knowledge graph exists but no sourceRevision was supplied', () => {
    const { annotated } = annotateDomain({ domainGraph: domain(), knowledgeGraph: knowledge('c'.repeat(64)) });
    expect(annotated.factDigest).toBe('c'.repeat(64));
    expect(Object.hasOwn(annotated, 'sourceRevision')).toBe(false);
  });

  it('end-to-end via the CLI: reads sourceRevision from the persisted source-manifest.json', () => {
    const root = tempRoot();
    const dataDir = join(root, '.excavator');
    const intermediate = join(dataDir, 'intermediate');
    mkdirSync(intermediate, { recursive: true });
    writeFileSync(join(dataDir, 'knowledge-graph.json'), JSON.stringify(knowledge('d'.repeat(64))), 'utf-8');
    writeFileSync(
      join(dataDir, 'source-manifest.json'),
      JSON.stringify({ sourceRevision: 'directory:' + 'e'.repeat(64), selectionDigest: 'x', pipelineVersion: 1 }),
      'utf-8',
    );
    writeFileSync(join(intermediate, 'domain-analysis.json'), JSON.stringify(domain()), 'utf-8');

    const result = spawnSync(process.execPath, [ANNOTATE_DOMAIN, root], { encoding: 'utf-8', cwd: repoRoot });
    expect(result.status, result.stderr).toBe(0);

    const annotated = JSON.parse(readFileSync(join(intermediate, 'domain-analysis.json'), 'utf-8'));
    expect(annotated.sourceRevision).toBe('directory:' + 'e'.repeat(64));
    expect(annotated.factDigest).toBe('d'.repeat(64));
  });

  it('CLI stamps nothing when there is no persisted source-manifest.json yet', () => {
    const root = tempRoot();
    const dataDir = join(root, '.excavator');
    const intermediate = join(dataDir, 'intermediate');
    mkdirSync(intermediate, { recursive: true });
    writeFileSync(join(dataDir, 'knowledge-graph.json'), JSON.stringify(knowledge()), 'utf-8');
    writeFileSync(join(intermediate, 'domain-analysis.json'), JSON.stringify(domain()), 'utf-8');

    const result = spawnSync(process.execPath, [ANNOTATE_DOMAIN, root], { encoding: 'utf-8', cwd: repoRoot });
    expect(result.status, result.stderr).toBe(0);

    const annotated = JSON.parse(readFileSync(join(intermediate, 'domain-analysis.json'), 'utf-8'));
    expect(Object.hasOwn(annotated, 'sourceRevision')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gate side: isDomainGraphUsable — pure decision.
// ---------------------------------------------------------------------------

describe('isDomainGraphUsable — pure gate', () => {
  const currentSourceRevision = 'git:' + '1'.repeat(40);
  const currentFactDigest = '2'.repeat(64);
  const canonical = (overrides = {}) => ({
    version: DOMAIN_GRAPH_VERSION,
    contentLanguage: DOMAIN_CONTENT_LANGUAGE,
    sourceRevision: currentSourceRevision,
    factDigest: currentFactDigest,
    ...overrides,
  });

  it('is usable when sourceRevision and factDigest both match', () => {
    const result = isDomainGraphUsable({
      domainGraph: canonical(),
      currentSourceRevision, currentFactDigest,
    });
    expect(result.usable).toBe(true);
    expect(result.status).toBe('fresh');
  });

  it('is not usable when sourceRevision has moved (factDigest still matching)', () => {
    const result = isDomainGraphUsable({
      domainGraph: canonical({ sourceRevision: 'git:' + '0'.repeat(40) }),
      currentSourceRevision, currentFactDigest,
    });
    expect(result.usable).toBe(false);
    expect(result.reason).toMatch(/sourceRevision mismatch/);
  });

  it('is not usable when factDigest has moved (sourceRevision still matching)', () => {
    const result = isDomainGraphUsable({
      domainGraph: canonical({ factDigest: '9'.repeat(64) }),
      currentSourceRevision, currentFactDigest,
    });
    expect(result.usable).toBe(false);
    expect(result.reason).toMatch(/factDigest mismatch/);
  });

  it('is visibly noncanonical when the domain graph lacks its English identity', () => {
    const result = isDomainGraphUsable({ domainGraph: {}, currentSourceRevision, currentFactDigest });
    expect(result.usable).toBe(false);
    expect(result.status).toBe('noncanonical-language');
    expect(result.reason).toMatch(/noncanonical-language/);
  });

  it('is stale when a canonical graph carries no sourceRevision', () => {
    const result = isDomainGraphUsable({
      domainGraph: canonical({ sourceRevision: undefined }), currentSourceRevision, currentFactDigest,
    });
    expect(result.usable).toBe(false);
    expect(result.status).toBe('stale');
    expect(result.reason).toMatch(/no sourceRevision/);
  });

  it('is not usable when there is no domain graph at all', () => {
    expect(isDomainGraphUsable({ domainGraph: null, currentSourceRevision, currentFactDigest }).usable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end gate: resolveDomainFreshness over real files on disk.
// ---------------------------------------------------------------------------

describe('resolveDomainFreshness — end-to-end over real files', () => {
  let root;
  beforeEach(() => { root = tempRoot(); });

  it('a domain graph produced in the same run as the current fact layer is usable', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'domain-freshness-fixture' }));
    writeFileSync(join(root, 'src', 'a.ts'), 'export function run(): void {}\n');

    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const dataDir = join(root, '.excavator');
    const graph = JSON.parse(readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8'));
    const manifest = JSON.parse(readFileSync(join(dataDir, 'source-manifest.json'), 'utf-8'));

    const { annotated } = annotateDomain({
      domainGraph: domain(), knowledgeGraph: graph, sourceRevision: manifest.sourceRevision,
    });
    writeFileSync(join(dataDir, 'domain-graph.json'), JSON.stringify(annotated), 'utf-8');

    const result = await resolveDomainFreshness(root);
    expect(result.usable).toBe(true);
    expect(result.status).toBe('fresh');
    expect(result.domainGraph.contentLanguage).toBe(DOMAIN_CONTENT_LANGUAGE);
  });

  it('the same domain graph is reported not-usable once the source changes (stale)', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'domain-freshness-fixture' }));
    writeFileSync(join(root, 'src', 'a.ts'), 'export function run(): void {}\n');

    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const dataDir = join(root, '.excavator');
    const graph = JSON.parse(readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8'));
    const manifest = JSON.parse(readFileSync(join(dataDir, 'source-manifest.json'), 'utf-8'));

    const { annotated } = annotateDomain({
      domainGraph: domain(), knowledgeGraph: graph, sourceRevision: manifest.sourceRevision,
    });
    writeFileSync(join(dataDir, 'domain-graph.json'), JSON.stringify(annotated), 'utf-8');

    // Drift the source (content-hash guard territory) without re-running Domain.
    writeFileSync(join(root, 'src', 'a.ts'), 'export function run(): void { /* changed */ }\n');

    const result = await resolveDomainFreshness(root);
    expect(result.usable).toBe(false);
    expect(result.status).toBe('stale');
    expect(result.reason).toMatch(/sourceRevision mismatch/);
  });

  it('is missing when no domain-graph.json exists yet', async () => {
    mkdirSync(join(root, '.excavator'), { recursive: true });
    writeFileSync(join(root, '.excavator', 'knowledge-graph.json'), JSON.stringify(knowledge()), 'utf-8');
    const result = await resolveDomainFreshness(root);
    expect(result.usable).toBe(false);
    expect(result.status).toBe('missing');
  });

  it('CLI reports the same usable/status shape as JSON on stdout', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'domain-freshness-fixture' }));
    writeFileSync(join(root, 'src', 'a.ts'), 'export function run(): void {}\n');
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const dataDir = join(root, '.excavator');
    const graph = JSON.parse(readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8'));
    const manifest = JSON.parse(readFileSync(join(dataDir, 'source-manifest.json'), 'utf-8'));
    const { annotated } = annotateDomain({ domainGraph: domain(), knowledgeGraph: graph, sourceRevision: manifest.sourceRevision });
    writeFileSync(join(dataDir, 'domain-graph.json'), JSON.stringify(annotated), 'utf-8');

    const DOMAIN_FRESHNESS = resolve(repoRoot, 'skills/excavator-domain/domain-freshness.mjs');
    const result = spawnSync(process.execPath, [DOMAIN_FRESHNESS, root], { encoding: 'utf-8', cwd: repoRoot });
    expect(result.status, result.stderr).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.usable).toBe(true);
    expect(parsed.status).toBe('fresh');
    expect(existsSync(join(dataDir, 'domain-graph.json'))).toBe(true);
  });
});
