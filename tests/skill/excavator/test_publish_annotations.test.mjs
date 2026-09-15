/**
 * publish-annotations.mjs — the end of the supplement chain.
 *
 * The bug this closes is not a wrong value, it is a disappearance: the audit
 * wrote its findings into `intermediate/`, the published graph came from
 * elsewhere, and the SAVE cleanup then moved `intermediate/` into `.trash-*`.
 *
 * So the tests are shaped around two opposite risks. Everything the supplement
 * layer produced must ARRIVE in the published file (per field class, not "some
 * fields"), and nothing else may move: a `summary`, a `name`, a `weight`, a
 * node count, an edge count, `project.gitCommitHash`. The allowlist makes the
 * second property structural, so the test asserts it on a graph where every
 * one of those differs between the two copies — if the merge ever grew a
 * wildcard, this goes red.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeAnnotations, isEvidenceSuperset,
  NODE_FIELDS, EDGE_FIELDS, PROJECT_FIELDS, ROOT_FIELDS, REPORT_FILES,
} from '../../../skills/excavator/publish-annotations.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const PUBLISH = resolve(repoRoot, 'skills/excavator/publish-annotations.mjs');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'excavator-publish-'));
  roots.push(dir);
  return dir;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** The graph as UA publishes it: model content, no supplement fields. */
function publishedGraph() {
  return {
    version: '1.0.0',
    project: {
      name: 'fixture', languages: ['typescript'], frameworks: [],
      description: 'fixture project', analyzedAt: '2026-01-01T00:00:00.000Z',
      gitCommitHash: 'multi-repo:' + 'd'.repeat(64),
    },
    nodes: [
      {
        id: 'file:src/app.ts', type: 'file', name: 'app.ts', filePath: 'src/app.ts',
        summary: 'The entry point.', tags: ['entry-point'], complexity: 'simple',
      },
      {
        id: 'function:src/app.ts:run', type: 'function', name: 'run', filePath: 'src/app.ts',
        lineRange: [3, 9], summary: 'Runs the app.', tags: ['entry'], complexity: 'simple',
      },
    ],
    edges: [
      {
        source: 'file:src/app.ts', target: 'function:src/app.ts:run', type: 'contains',
        direction: 'forward', weight: 1.0,
        evidence: [{ file: 'src/app.ts', line: 3, source: 'model' }],
      },
    ],
    layers: [{ id: 'layer:source', name: 'Source', description: 'src', nodeIds: ['file:src/app.ts'] }],
    tour: [],
  };
}

/**
 * The audited copy. Every value that is NOT a supplement field is deliberately
 * different from the published one, so a merge that copied too much shows up.
 */
function annotatedGraph() {
  return {
    version: '9.9.9',
    project: {
      name: 'DIFFERENT', languages: ['go'], frameworks: ['Docker'],
      description: 'DIFFERENT', analyzedAt: '2099-01-01T00:00:00.000Z',
      gitCommitHash: null,
      sourceDigest: 'a'.repeat(64),
      factsDigest: 'b'.repeat(64),
      pipelineVersion: 'excavator-annotate/1',
      model: 'claude-opus-5',
      verification: 'sample:50',
    },
    nodes: [
      {
        id: 'file:src/app.ts', type: 'file', name: 'DIFFERENT', filePath: 'DIFFERENT',
        summary: 'DIFFERENT', tags: ['different'], complexity: 'complex',
        anchorSource: 'census', verification: 'dirty',
      },
      {
        id: 'function:src/app.ts:run', type: 'function', name: 'DIFFERENT', filePath: 'DIFFERENT',
        lineRange: [99, 99], summary: 'DIFFERENT', tags: ['different'], complexity: 'complex',
        anchorSource: 'tree-sitter', verification: 'contradicted',
        owner: 'App', owners: ['App', 'Runner'],
      },
      // Known to the audit, absent from the published graph: never added.
      {
        id: 'function:src/ghost.ts:gone', type: 'function', name: 'gone', filePath: 'src/ghost.ts',
        summary: 'x', tags: ['x'], complexity: 'simple', verification: 'verified',
      },
    ],
    edges: [
      {
        source: 'file:src/app.ts', target: 'function:src/app.ts:run', type: 'contains',
        direction: 'forward', weight: 0.1,
        provenance: 'extracted',
        evidence: [
          { file: 'src/app.ts', line: 3, source: 'model', verified: true },
          { file: 'src/app.ts', line: 3, source: 'tree-sitter' },
        ],
        verification: 'verified',
      },
      // A supplement edge: counted, never appended.
      {
        source: 'file:src/app.ts', target: 'file:src/other.ts', type: 'imports',
        direction: 'forward', weight: 0.7, provenance: 'extracted',
        addedBy: 'excavator-annotate',
        evidence: [{ file: 'src/app.ts', line: 1, source: 'import-map' }],
      },
    ],
    layers: [],
    tour: [],
    coverage: {
      files: 2, ignored: 0,
      byLanguage: {
        typescript: {
          files: 2, parsed: 2, zeroSymbol: 0, skipped: {},
          kinds: { function: 1, class: 0, import: 1, export: 1, call: 0 },
        },
      },
    },
    gaps: [
      { kind: 'summary-contradicted', scope: 'graph', reason: '1', count: 1, samples: ['function:src/app.ts:run'] },
    ],
  };
}

describe('the supplement fields arrive', () => {
  const { merged, counts } = mergeAnnotations({
    published: publishedGraph(), annotated: annotatedGraph(),
  });
  const node = id => merged.nodes.find(n => n.id === id);

  it('writes node verification, owner(s) and anchorSource', () => {
    expect(node('file:src/app.ts').verification).toBe('dirty');
    expect(node('file:src/app.ts').anchorSource).toBe('census');
    expect(node('function:src/app.ts:run').verification).toBe('contradicted');
    expect(node('function:src/app.ts:run').owner).toBe('App');
    expect(node('function:src/app.ts:run').owners).toEqual(['App', 'Runner']);
    expect(node('function:src/app.ts:run').anchorSource).toBe('tree-sitter');
  });

  it('writes edge provenance, evidence and verification', () => {
    const [edge] = merged.edges;
    expect(edge.provenance).toBe('extracted');
    expect(edge.verification).toBe('verified');
    expect(edge.evidence).toHaveLength(2);
    // The model's own citation survives, now marked verified.
    expect(edge.evidence[0]).toEqual({ file: 'src/app.ts', line: 3, source: 'model', verified: true });
  });

  it('writes root coverage and gaps', () => {
    expect(merged.coverage.byLanguage.typescript.parsed).toBe(2);
    expect(merged.gaps[0].kind).toBe('summary-contradicted');
    expect(counts.rootFieldsWritten).toBe(ROOT_FIELDS.length);
  });

  it('writes the project extras but never the commit hash', () => {
    expect(merged.project.sourceDigest).toBe('a'.repeat(64));
    expect(merged.project.factsDigest).toBe('b'.repeat(64));
    expect(merged.project.pipelineVersion).toBe('excavator-annotate/1');
    expect(merged.project.model).toBe('claude-opus-5');
    expect(merged.project.verification).toBe('sample:50');
    // The audited copy normalises it; the published value is the pipeline's.
    expect(merged.project.gitCommitHash).toBe('multi-repo:' + 'd'.repeat(64));
    expect(PROJECT_FIELDS).not.toContain('gitCommitHash');
  });
});

describe('nothing the model wrote moves', () => {
  const published = publishedGraph();
  const { merged, counts, samples } = mergeAnnotations({
    published, annotated: annotatedGraph(),
  });

  it('keeps every summary, name, path, tag, complexity and weight', () => {
    for (const before of published.nodes) {
      const after = merged.nodes.find(n => n.id === before.id);
      expect(after.summary).toBe(before.summary);
      expect(after.name).toBe(before.name);
      expect(after.filePath).toBe(before.filePath);
      expect(after.tags).toEqual(before.tags);
      expect(after.complexity).toBe(before.complexity);
      expect(after.lineRange).toEqual(before.lineRange);
    }
    expect(merged.edges[0].weight).toBe(1.0);
    expect(merged.version).toBe('1.0.0');
    expect(merged.project.name).toBe('fixture');
    expect(merged.project.description).toBe('fixture project');
    expect(merged.project.analyzedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(merged.layers).toEqual(published.layers);
  });

  it('adds no node and no edge, and counts what it did not publish', () => {
    expect(merged.nodes).toHaveLength(published.nodes.length);
    expect(merged.edges).toHaveLength(published.edges.length);
    expect(counts.nodeNotPublished).toBe(1);
    expect(samples.nodeNotPublished).toEqual(['function:src/ghost.ts:gone']);
    expect(counts.edgeNotPublished).toBe(1);
    expect(samples.edgeNotPublished[0]).toContain('imports|file:src/app.ts|file:src/other.ts');
  });

  it('writes only allowlisted keys', () => {
    // Structural, not a spot check: the union of keys that changed must be a
    // subset of the allowlists.
    const changed = new Set();
    for (const before of published.nodes) {
      const after = merged.nodes.find(n => n.id === before.id);
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.add(key);
      }
    }
    for (const key of changed) expect(NODE_FIELDS).toContain(key);

    const edgeChanged = new Set();
    for (const key of new Set([...Object.keys(published.edges[0]), ...Object.keys(merged.edges[0])])) {
      if (JSON.stringify(published.edges[0][key]) !== JSON.stringify(merged.edges[0][key])) edgeChanged.add(key);
    }
    for (const key of edgeChanged) expect(EDGE_FIELDS).toContain(key);
  });

  it('refuses to replace an evidence array that would lose an entry', () => {
    const published = publishedGraph();
    published.edges[0].evidence = [{ file: 'src/app.ts', line: 3, source: 'model' }];
    const annotated = annotatedGraph();
    // The audited copy no longer carries the model's own citation.
    annotated.edges[0].evidence = [{ file: 'src/app.ts', line: 42, source: 'tree-sitter' }];

    const { merged, counts } = mergeAnnotations({ published, annotated });
    expect(merged.edges[0].evidence).toEqual([{ file: 'src/app.ts', line: 3, source: 'model' }]);
    expect(counts.evidenceNotSuperset).toBe(1);
    // The other fields still land — one refusal does not abandon the edge.
    expect(merged.edges[0].provenance).toBe('extracted');
  });

  it('isEvidenceSuperset is total on the empty and missing cases', () => {
    expect(isEvidenceSuperset([], [])).toBe(true);
    expect(isEvidenceSuperset(undefined, undefined)).toBe(true);
    expect(isEvidenceSuperset(undefined, [{ file: 'a', line: 1, source: 'model' }])).toBe(false);
    expect(isEvidenceSuperset([{ file: 'a', line: 1, source: 'model' }], [])).toBe(true);
  });
});

describe('running it twice equals running it once', () => {
  it('is idempotent', () => {
    const annotated = annotatedGraph();
    const first = mergeAnnotations({ published: publishedGraph(), annotated });
    const second = mergeAnnotations({ published: first.merged, annotated });
    expect(JSON.stringify(second.merged)).toBe(JSON.stringify(first.merged));
    expect((second.merged.gaps ?? []).filter(g => g.kind === 'summary-contradicted')).toHaveLength(1);
  });
});

describe('publish-annotations CLI', () => {
  function fixture({ withAnnotated = true, withValidated = false, withDomain = false, withReports = true } = {}) {
    const root = tempRoot();
    const dataDir = join(root, '.excavator');
    const intermediate = join(dataDir, 'intermediate');
    mkdirSync(intermediate, { recursive: true });
    writeFileSync(join(dataDir, 'knowledge-graph.json'), JSON.stringify(publishedGraph(), null, 2), 'utf-8');
    if (withAnnotated) {
      writeFileSync(join(intermediate, 'annotated-graph.json'), JSON.stringify(annotatedGraph(), null, 2), 'utf-8');
    }
    if (withValidated) {
      const validated = annotatedGraph();
      validated.nodes[1].verification = 'contradicted';
      validated.gaps = [
        ...(validated.gaps ?? []),
        { kind: 'anchor-mismatch', scope: 'graph', reason: '1', count: 1, samples: ['function:src/app.ts:run'] },
      ];
      writeFileSync(join(intermediate, 'validated-graph.json'), JSON.stringify(validated, null, 2), 'utf-8');
    }
    if (withDomain) {
      writeFileSync(join(dataDir, 'domain-graph.json'), JSON.stringify({
        version: '1.0.0',
        project: { name: 'fixture', languages: ['typescript'], gitCommitHash: null },
        nodes: [{
          id: 'step:create-order:validate', type: 'step', name: 'Validate',
          summary: 'validates', tags: ['t'], complexity: 'simple', filePath: 'src/app.ts',
        }],
        edges: [], layers: [], tour: [],
      }, null, 2), 'utf-8');
      writeFileSync(join(intermediate, 'domain-analysis.json'), JSON.stringify({
        version: '1.0.0',
        project: { name: 'fixture', languages: ['typescript'], gitCommitHash: null },
        nodes: [{
          id: 'step:create-order:validate', type: 'step', name: 'DIFFERENT',
          summary: 'DIFFERENT', tags: ['x'], complexity: 'complex', filePath: 'src/app.ts',
          nodeIds: ['function:src/app.ts:run'],
          unresolvedNodeIds: ['function:src/ghost.ts:nope'],
          evidence: [{ file: 'src/app.ts', line: 3, source: 'rule' }],
        }],
        edges: [], layers: [], tour: [],
        gaps: [{ kind: 'step-nodeid-unresolved', scope: 'domain', reason: '1', count: 1, samples: ['x'] }],
      }, null, 2), 'utf-8');
    }
    if (withReports) {
      writeFileSync(join(intermediate, 'audit.json'), JSON.stringify({ scriptCompleted: true }), 'utf-8');
      writeFileSync(join(intermediate, 'validation.json'), JSON.stringify({ scriptCompleted: true }), 'utf-8');
      writeFileSync(join(intermediate, 'contradicted-summaries.json'), JSON.stringify({ count: 0, records: [] }), 'utf-8');
    }
    return { root, dataDir, intermediate };
  }

  function run(root, extra = []) {
    return spawnSync(process.execPath, [PUBLISH, root, ...extra], { encoding: 'utf-8', cwd: repoRoot });
  }

  it('publishes into knowledge-graph.json and preserves the reports outside intermediate/', () => {
    const { root, dataDir } = fixture();
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('knowledge-graph.json');
    expect(result.stderr).toContain('node-not-published=1');

    const graph = readJson(join(dataDir, 'knowledge-graph.json'));
    expect(graph.nodes.find(n => n.id === 'file:src/app.ts').verification).toBe('dirty');
    expect(graph.edges[0].provenance).toBe('extracted');
    expect(graph.coverage.files).toBe(2);
    expect(graph.gaps[0].kind).toBe('summary-contradicted');
    expect(graph.project.model).toBe('claude-opus-5');
    expect(graph.nodes[0].summary).toBe('The entry point.');

    for (const name of ['audit.json', 'validation.json', 'contradicted-summaries.json', 'publish.json']) {
      expect(existsSync(join(dataDir, 'excavator', name)), name).toBe(true);
    }
    const report = readJson(join(dataDir, 'excavator', 'publish.json'));
    expect(report.knowledgeGraph.source).toBe('annotated-graph.json');
    expect(report.reportsPreserved).toContain('audit.json');
  });

  it('prefers the validated copy over the annotated one', () => {
    const { root, dataDir } = fixture({ withValidated: true });
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    const graph = readJson(join(dataDir, 'knowledge-graph.json'));
    expect(graph.gaps.some(g => g.kind === 'anchor-mismatch')).toBe(true);
    const report = readJson(join(dataDir, 'excavator', 'publish.json'));
    expect(report.knowledgeGraph.source).toBe('validated-graph.json');
  });

  it('publishes the domain anchors into domain-graph.json', () => {
    const { root, dataDir } = fixture({ withDomain: true });
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    const domain = readJson(join(dataDir, 'domain-graph.json'));
    const [step] = domain.nodes;
    expect(step.nodeIds).toEqual(['function:src/app.ts:run']);
    expect(step.unresolvedNodeIds).toEqual(['function:src/ghost.ts:nope']);
    expect(step.evidence).toEqual([{ file: 'src/app.ts', line: 3, source: 'rule' }]);
    expect(step.summary).toBe('validates');
    expect(step.name).toBe('Validate');
    expect(domain.gaps[0].kind).toBe('step-nodeid-unresolved');
  });

  it('is a no-op with a printed note when the supplement outputs are gone', () => {
    const { root, dataDir } = fixture({ withAnnotated: false, withReports: false });
    const before = readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8');
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('no annotated knowledge-graph.json found');
    expect(result.stderr).toContain('no audit or validation report found');
    expect(readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8')).toBe(before);
  });

  it('says so when there is no published graph to publish into', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.excavator', 'intermediate'), { recursive: true });
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('nothing to publish into');
    expect(result.stderr).toContain('nothing was published');
  });

  it('rewrites the same bytes on a second run', () => {
    const { root, dataDir } = fixture({ withValidated: true, withDomain: true });
    expect(run(root).status).toBe(0);
    const once = readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8');
    const onceDomain = readFileSync(join(dataDir, 'domain-graph.json'), 'utf-8');
    expect(run(root).status).toBe(0);
    expect(readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8')).toBe(once);
    expect(readFileSync(join(dataDir, 'domain-graph.json'), 'utf-8')).toBe(onceDomain);
  });

  it('rejects an unknown option', () => {
    const { root } = fixture();
    const result = run(root, ['--merge-everything']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown option');
  });

  it('knows which reports it is responsible for', () => {
    expect(REPORT_FILES).toContain('audit.json');
    expect(REPORT_FILES).toContain('validation.json');
    expect(REPORT_FILES).toContain('contradicted-summaries.json');
  });
});

describe('both skills wire the publish step in additively', () => {
  const skill = readFileSync(resolve(repoRoot, 'skills/excavator/SKILL.md'), 'utf-8');
  const domainSkill = readFileSync(resolve(repoRoot, 'skills/excavator-domain/SKILL.md'), 'utf-8');

  it('runs before the SAVE cleanup that trashes intermediate/', () => {
    const publishAt = skill.indexOf('**Step 7.1 — PUBLISH ANNOTATIONS (run before step 4).**');
    const cleanupAt = skill.indexOf('4. Clean up intermediate files');
    expect(publishAt).toBeGreaterThan(-1);
    expect(cleanupAt).toBeGreaterThan(publishAt);
    expect(skill).toContain('publish-annotations.mjs');
    expect(skill).toContain('$DATA_DIR/excavator/');
  });

  it('runs INSIDE the domain skill\'s Phase 5, between steps 4 and 5', () => {
    // Placement is the whole point: step 5 deletes `domain-analysis.json`,
    // which is this step's input, so a block sitting after the phase would
    // always hit the documented no-op. The acceptor caught exactly that.
    const step4 = domainSkill.indexOf('4. Save to `$DATA_DIR/domain-graph.json`');
    const publish = domainSkill.indexOf('**Publish the step anchors before step 5.**');
    const step5 = domainSkill.indexOf('5. Clean up `$DATA_DIR/intermediate/domain-analysis.json`');
    expect(step4).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(step4);
    expect(step5).toBeGreaterThan(publish);
    expect(domainSkill).toContain('--domain-annotated');
    // The later section is a pointer now, not a second copy of the command.
    const pointer = domainSkill.slice(
      domainSkill.indexOf('### Phase 5.1: Publish Annotations'),
      domainSkill.indexOf('### Phase 6: Service Ready'),
    );
    expect(pointer).toContain('inside Phase 5, between steps 4 and 5');
    expect(pointer).not.toContain('```bash');
  });

  it('keeps annotation publishing before cleanup after the service-only rewrite', () => {
    expect(skill.indexOf('publish-annotations.mjs'))
      .toBeLessThan(skill.indexOf('4. Clean up intermediate files'));
    expect(domainSkill.indexOf('--domain-annotated'))
      .toBeLessThan(domainSkill.indexOf('5. Clean up `$DATA_DIR/intermediate/domain-analysis.json`'));
  });
});
