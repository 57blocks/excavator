/**
 * apply-verification.mjs — phase 2.5's two deterministic halves.
 *
 * The property that matters most here is negative: a summary must never come
 * out of this step looking checked when nothing checked it. So the first tests
 * are the fail-closed ones — no verdicts, a fourth verdict value, a verdict
 * for an id that is not in the graph, a selected node nobody answered for —
 * and only then the happy path.
 *
 * The second property is that a contradiction is recorded, not cleaned up: the
 * summary text stays on the node byte-for-byte, and the reason lands in the
 * archive.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  prepareVerification, applyVerification, readVerdictFiles, strideSample, chunk,
  VERDICTS, VERIFICATION_SEVERITY, OWNED_GAP_KINDS, DEFAULT_BATCH_SIZE,
} from '../../../skills/excavator/apply-verification.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const APPLY = resolve(repoRoot, 'skills/excavator/apply-verification.mjs');

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'excavator-verify-'));
  tempDirs.push(dir);
  return dir;
}

/** Every path classifies as an existing in-scope file. */
const allOk = () => 'ok';

function node(id, overrides = {}) {
  return {
    id,
    type: 'function',
    name: id.split(':').pop(),
    filePath: 'src/app.ts',
    lineRange: [1, 5],
    summary: `summary of ${id}`,
    tags: ['x'],
    complexity: 'simple',
    ...overrides,
  };
}

function graphOf(nodes, extra = {}) {
  return {
    version: '1.0.0',
    project: { name: 'fixture', languages: ['typescript'], gitCommitHash: null },
    nodes,
    edges: [],
    layers: [],
    tour: [],
    ...extra,
  };
}

function gapOf(graph, kind) {
  return (graph.gaps ?? []).find(g => g.kind === kind);
}

describe('apply-verification fails closed', () => {
  it('marks nothing verified when no verdicts came back', () => {
    const graph = graphOf([node('function:src/app.ts:a'), node('function:src/app.ts:b')]);
    const { verified, report } = applyVerification({ graph, verdicts: [] });

    for (const n of verified.nodes) expect(n.verification).toBeUndefined();
    expect(report.counts.verified).toBe(0);
    expect(report.byVerification.unmarked).toBe(2);
    expect(gapOf(verified, 'summary-unchecked').count).toBe(2);
  });

  it('rejects a fourth verdict value instead of storing it', () => {
    const graph = graphOf([node('function:src/app.ts:a')]);
    const { verified, report } = applyVerification({
      graph,
      verdicts: [{ id: 'function:src/app.ts:a', verdict: 'partially-verified', reason: 'mostly' }],
    });

    expect(verified.nodes[0].verification).toBeUndefined();
    expect(report.counts.verdictInvalid).toBe(1);
    expect(report.counts.verdictsApplied).toBe(0);
    expect(gapOf(verified, 'summary-verdict-invalid').count).toBe(1);
    // The rejected value is named, so a verifier that invents a scale is
    // debuggable rather than merely absent.
    expect(gapOf(verified, 'summary-verdict-invalid').samples.join()).toContain('partially-verified');
  });

  it('counts and discards a verdict for an id that is not in the graph', () => {
    const graph = graphOf([node('function:src/app.ts:a')]);
    const { verified, report } = applyVerification({
      graph,
      verdicts: [{ id: 'function:src/ghost.ts:nope', verdict: 'verified', reason: 'ok' }],
    });

    expect(verified.nodes[0].verification).toBeUndefined();
    expect(report.counts.verdictUnknownNode).toBe(1);
    expect(gapOf(verified, 'summary-verdict-unknown-node').samples).toContain('function:src/ghost.ts:nope');
  });

  it('marks a selected node with no verdict as unverified and counts the omission', () => {
    const graph = graphOf([node('function:src/app.ts:a'), node('function:src/app.ts:b')]);
    const manifest = { mode: 'full', selectedIds: ['function:src/app.ts:a', 'function:src/app.ts:b'] };
    const { verified, report } = applyVerification({
      graph,
      manifest,
      verdicts: [{ id: 'function:src/app.ts:a', verdict: 'verified', reason: 'matches' }],
    });

    expect(verified.nodes[0].verification).toBe('verified');
    expect(verified.nodes[1].verification).toBe('unverified');
    expect(report.counts.verdictMissing).toBe(1);
    expect(report.counts.unverified).toBe(1);
    expect(gapOf(verified, 'summary-verdict-missing').count).toBe(1);
  });
});

describe('apply-verification write-back', () => {
  it('writes all three verdicts and keeps every summary intact', () => {
    const nodes = [
      node('function:src/app.ts:a'),
      node('function:src/app.ts:b'),
      node('function:src/app.ts:c'),
    ];
    const before = nodes.map(n => n.summary);
    const graph = graphOf(nodes);
    const { verified, report, archive } = applyVerification({
      graph,
      manifest: { mode: 'full', selectedIds: nodes.map(n => n.id) },
      verdicts: [
        { id: 'function:src/app.ts:a', verdict: 'verified', reason: 'names match' },
        { id: 'function:src/app.ts:b', verdict: 'unverified', reason: 'claim is about callers' },
        { id: 'function:src/app.ts:c', verdict: 'contradicted', reason: 'slice validates the id only' },
      ],
    });

    expect(verified.nodes.map(n => n.verification)).toEqual([
      'verified', 'unverified', 'contradicted',
    ]);
    // Nothing was cleared, shortened or rewritten.
    expect(verified.nodes.map(n => n.summary)).toEqual(before);
    expect(report.counts).toMatchObject({ verified: 1, unverified: 1, contradicted: 1 });

    expect(archive).toHaveLength(1);
    expect(archive[0]).toMatchObject({
      id: 'function:src/app.ts:c',
      filePath: 'src/app.ts',
      reason: 'slice validates the id only',
    });
    expect(archive[0].summary).toBe(before[2]);

    const gap = gapOf(verified, 'summary-contradicted');
    expect(gap.count).toBe(1);
    expect(gap.samples).toEqual(['function:src/app.ts:c']);
  });

  it('records how the run was scoped on project.verification', () => {
    const graph = graphOf([node('function:src/app.ts:a')]);
    const full = applyVerification({ graph, manifest: { mode: 'full', selectedIds: [] }, verdicts: [] });
    expect(full.verified.project.verification).toBe('full');

    const sampled = applyVerification({
      graph, manifest: { mode: 'sample:50', selectedIds: [] }, verdicts: [],
    });
    expect(sampled.verified.project.verification).toBe('sample:50');
    expect(sampled.report.mode).toBe('sample:50');

    const skipped = applyVerification({ graph, verdicts: [], mode: 'skipped' });
    expect(skipped.verified.project.verification).toBe('skipped');
  });

  it('never downgrades a marking an earlier phase set', () => {
    const graph = graphOf([
      node('function:src/app.ts:dirty', { verification: 'dirty' }),
      node('function:src/app.ts:contradicted', { verification: 'contradicted' }),
      node('function:src/app.ts:plain'),
    ]);
    const { verified, report } = applyVerification({
      graph,
      verdicts: [
        { id: 'function:src/app.ts:dirty', verdict: 'verified', reason: 'matches' },
        { id: 'function:src/app.ts:contradicted', verdict: 'unverified', reason: 'cannot tell' },
        { id: 'function:src/app.ts:plain', verdict: 'verified', reason: 'matches' },
      ],
    });

    // A "verified" summary verdict must not erase a freshness marking.
    expect(verified.nodes[0].verification).toBe('dirty');
    expect(verified.nodes[1].verification).toBe('contradicted');
    expect(verified.nodes[2].verification).toBe('verified');
    expect(report.counts.verificationPreserved).toBe(2);
  });

  it('lets a contradiction override a dirty marking', () => {
    const graph = graphOf([node('function:src/app.ts:a', { verification: 'dirty' })]);
    const { verified, report } = applyVerification({
      graph,
      verdicts: [{ id: 'function:src/app.ts:a', verdict: 'contradicted', reason: 'wrong operation' }],
    });
    expect(verified.nodes[0].verification).toBe('contradicted');
    expect(report.counts.verificationPreserved).toBe(0);
  });

  it('accounts for every non-empty summary in exactly one bucket', () => {
    const nodes = [
      node('function:src/app.ts:a'),
      node('function:src/app.ts:b'),
      node('function:src/app.ts:c', { verification: 'dirty' }),
      node('function:src/app.ts:d'),
      node('file:src/empty.ts', { type: 'file', summary: '', lineRange: undefined }),
    ];
    const { verified, report } = applyVerification({
      graph: graphOf(nodes),
      manifest: { mode: 'full', selectedIds: ['function:src/app.ts:a', 'function:src/app.ts:b'] },
      verdicts: [
        { id: 'function:src/app.ts:a', verdict: 'verified', reason: 'r' },
        { id: 'function:src/app.ts:b', verdict: 'contradicted', reason: 'r' },
      ],
    });

    // Four non-empty summaries; the empty one is not a summary to check.
    expect(report.counts.summariesTotal).toBe(4);
    expect(report.byVerification).toMatchObject({
      verified: 1, contradicted: 1, dirty: 1, unmarked: 1,
    });
    const sum = Object.values(report.byVerification).reduce((a, b) => a + b, 0);
    expect(sum).toBe(report.counts.summariesTotal);
    expect(report.conserves).toBe(true);
    expect(gapOf(verified, 'summary-unchecked').count).toBe(1);
    expect(verified.nodes[4].verification).toBeUndefined();
  });

  it('is idempotent: applying twice does not duplicate its own gap rows', () => {
    const graph = graphOf([node('function:src/app.ts:a')]);
    const verdicts = [{ id: 'function:src/app.ts:a', verdict: 'contradicted', reason: 'r' }];
    const first = applyVerification({ graph, verdicts });
    const second = applyVerification({ graph: first.verified, verdicts });

    expect(JSON.stringify(second.verified)).toBe(JSON.stringify(first.verified));
    expect((second.verified.gaps ?? []).filter(g => g.kind === 'summary-contradicted')).toHaveLength(1);
  });

  it('leaves gap rows it does not own alone', () => {
    const graph = graphOf([node('function:src/app.ts:a')], {
      gaps: [{ kind: 'edge-missing', scope: 'imports', reason: 'from annotate', count: 7, samples: [] }],
    });
    const { verified } = applyVerification({ graph, verdicts: [] });
    expect(gapOf(verified, 'edge-missing')).toMatchObject({ count: 7, reason: 'from annotate' });
    for (const owned of OWNED_GAP_KINDS) {
      if (owned === 'summary-unchecked') continue;
      expect(gapOf(verified, owned)).toBeUndefined();
    }
  });

  it('exposes exactly three verdicts and a severity order that cannot invert', () => {
    expect(VERDICTS).toEqual(['verified', 'unverified', 'contradicted']);
    expect(VERIFICATION_SEVERITY.contradicted).toBeGreaterThan(VERIFICATION_SEVERITY.dirty);
    expect(VERIFICATION_SEVERITY.dirty).toBeGreaterThan(VERIFICATION_SEVERITY.unverified);
    expect(VERIFICATION_SEVERITY.unverified).toBeGreaterThan(VERIFICATION_SEVERITY.verified);
  });
});

describe('apply-verification prepare', () => {
  it('selects only summaries with an anchor, and says why the rest were dropped', () => {
    const graph = graphOf([
      node('function:src/app.ts:a'),
      node('function:src/app.ts:b', { lineRange: undefined }),
      node('file:src/c.ts', { type: 'file', summary: '   ' }),
    ]);
    const { manifest } = prepareVerification({ graph, classifyPath: allOk });

    expect(manifest.counts.summariesTotal).toBe(2);
    expect(manifest.counts.noAnchor).toBe(1);
    expect(manifest.counts.candidates).toBe(1);
    expect(manifest.mode).toBe('full');
    expect(manifest.selectedIds).toEqual(['function:src/app.ts:a']);
  });

  it('refuses an out-of-root anchor rather than handing it to the model as a read', () => {
    const graph = graphOf([
      node('function:src/app.ts:inside'),
      node('function:../outside.ts:escape', { filePath: '../outside.ts' }),
      node('function:/etc/passwd:absolute', { filePath: '/etc/passwd' }),
      node('function:src/gone.ts:missing', { filePath: 'src/gone.ts' }),
    ]);
    const classify = (filePath) => {
      if (filePath.startsWith('..') || filePath.startsWith('/')) return 'out-of-scope';
      if (filePath === 'src/gone.ts') return 'missing';
      return 'ok';
    };
    const { manifest, batches } = prepareVerification({ graph, classifyPath: classify });

    expect(manifest.counts.pathOutOfScope).toBe(2);
    expect(manifest.counts.sourceMissing).toBe(1);
    expect(manifest.selectedIds).toEqual(['function:src/app.ts:inside']);
    const batched = batches.flatMap(b => b.nodes.map(n => n.filePath));
    expect(batched).toEqual(['src/app.ts']);
    expect(manifest.outOfScopePaths.join()).toContain('../outside.ts');
  });

  it('carries the refusal count into the applied graph as a gap', () => {
    const graph = graphOf([node('function:src/app.ts:a')]);
    const manifest = {
      mode: 'full', selectedIds: [], counts: { pathOutOfScope: 3 },
      outOfScopePaths: ['x -> ../a.ts', 'y -> ../b.ts', 'z -> /etc/hosts'],
    };
    const { verified } = applyVerification({ graph, manifest, verdicts: [] });
    expect(gapOf(verified, 'summary-path-out-of-scope').count).toBe(3);
  });

  it('samples by stride, not by taking the alphabetical first n', () => {
    const nodes = [];
    for (let i = 0; i < 10; i++) nodes.push(node(`function:src/app.ts:n${i}`));
    const { manifest, mode } = prepareVerification({ graph: graphOf(nodes), sample: 3, classifyPath: allOk });

    expect(mode).toBe('sample:3');
    expect(manifest.counts.candidates).toBe(10);
    expect(manifest.counts.selected).toBe(3);
    // Spread across the id space: the last selected id is not n2.
    expect(manifest.selectedIds).toEqual([
      'function:src/app.ts:n0', 'function:src/app.ts:n3', 'function:src/app.ts:n6',
    ]);
  });

  it('treats a sample larger than the candidate set as a full run', () => {
    const graph = graphOf([node('function:src/app.ts:a')]);
    const { manifest, mode } = prepareVerification({ graph, sample: 500, classifyPath: allOk });
    expect(mode).toBe('full');
    expect(manifest.mode).toBe('full');
  });

  it('produces the same manifest twice for the same graph', () => {
    const nodes = [];
    for (let i = 0; i < 25; i++) nodes.push(node(`function:src/app.ts:n${i}`));
    const graph = graphOf(nodes);
    const first = prepareVerification({ graph, sample: 7, batchSize: 4, classifyPath: allOk });
    const second = prepareVerification({ graph, sample: 7, batchSize: 4, classifyPath: allOk });
    expect(JSON.stringify(second.manifest)).toBe(JSON.stringify(first.manifest));
    expect(JSON.stringify(second.batches)).toBe(JSON.stringify(first.batches));
  });

  it('batches at the documented default size', () => {
    const nodes = [];
    for (let i = 0; i < DEFAULT_BATCH_SIZE + 5; i++) nodes.push(node(`function:src/app.ts:n${String(i).padStart(3, '0')}`));
    const { batches } = prepareVerification({ graph: graphOf(nodes), classifyPath: allOk });
    expect(batches).toHaveLength(2);
    expect(batches[0].nodes).toHaveLength(DEFAULT_BATCH_SIZE);
    expect(batches[1].nodes).toHaveLength(5);
  });

  it('refuses to run without a path classifier rather than accepting every path', () => {
    expect(() => prepareVerification({ graph: graphOf([node('function:src/app.ts:a')]) }))
      .toThrow(/classifyPath must be a function/);
  });

  it('strideSample and chunk are total functions on their edge cases', () => {
    expect(strideSample([1, 2, 3], 0)).toEqual([]);
    expect(strideSample([1, 2, 3], 9)).toEqual([1, 2, 3]);
    expect(strideSample([], 3)).toEqual([]);
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe('apply-verification CLI on a fixture project', () => {
  function writeFixture() {
    const root = tempProject();
    const src = join(root, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'app.ts'), [
      'export function run() {',
      '  return 1;',
      '}',
      '',
    ].join('\n'), 'utf-8');

    const intermediate = join(root, '.excavator', 'intermediate');
    mkdirSync(intermediate, { recursive: true });
    const graph = graphOf([
      node('function:src/app.ts:run', { name: 'run', lineRange: [1, 3] }),
      node('function:src/app.ts:ghost', { name: 'ghost', filePath: 'src/ghost.ts' }),
      node('function:../escape.ts:out', { name: 'out', filePath: '../escape.ts' }),
    ]);
    writeFileSync(join(intermediate, 'annotated-graph.json'), JSON.stringify(graph, null, 2), 'utf-8');
    return { root, intermediate };
  }

  function run(args, cwd) {
    return spawnSync('node', [APPLY, ...args], { encoding: 'utf-8', cwd });
  }

  it('prepares, applies in place, and archives the contradiction', () => {
    const { root, intermediate } = writeFixture();

    const prepared = run([root, 'prepare'], repoRoot);
    expect(prepared.status, prepared.stderr).toBe(0);
    expect(prepared.stderr).toContain('mode=full');
    expect(prepared.stderr).toContain('path-out-of-scope=1');

    const manifest = JSON.parse(readFileSync(join(intermediate, 'summary-verify-manifest.json'), 'utf-8'));
    expect(manifest.selectedIds).toEqual(['function:src/app.ts:run']);
    expect(manifest.counts.sourceMissing).toBe(1);
    expect(manifest.counts.pathOutOfScope).toBe(1);

    const batch = JSON.parse(readFileSync(join(intermediate, 'summary-verify-batch-0.json'), 'utf-8'));
    expect(batch.nodes).toHaveLength(1);
    expect(batch.nodes[0]).toMatchObject({ filePath: 'src/app.ts', lineRange: [1, 3] });

    // Stand in for the verifier agent.
    writeFileSync(join(intermediate, 'summary-verdicts-0.json'), JSON.stringify({
      batchIndex: 0,
      verdicts: [{
        id: 'function:src/app.ts:run',
        verdict: 'contradicted',
        reason: 'slice returns a constant; the summary claims a lookup',
      }],
    }, null, 2), 'utf-8');

    const applied = run([root, 'apply'], repoRoot);
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stderr).toContain('summary-contradicted=1');

    const graph = JSON.parse(readFileSync(join(intermediate, 'annotated-graph.json'), 'utf-8'));
    const target = graph.nodes.find(n => n.id === 'function:src/app.ts:run');
    expect(target.verification).toBe('contradicted');
    expect(target.summary).toBe('summary of function:src/app.ts:run');
    expect(graph.project.verification).toBe('full');
    expect(gapOf(graph, 'summary-contradicted').count).toBe(1);
    expect(gapOf(graph, 'summary-path-out-of-scope').count).toBe(1);

    const archive = JSON.parse(readFileSync(join(intermediate, 'contradicted-summaries.json'), 'utf-8'));
    expect(archive.count).toBe(1);
    expect(archive.records[0].reason).toContain('returns a constant');

    const report = JSON.parse(readFileSync(join(intermediate, 'summary-verification.json'), 'utf-8'));
    expect(report.scriptCompleted).toBe(true);
    expect(report.conserves).toBe(true);
    expect(report.verdictFiles).toEqual(['summary-verdicts-0.json']);
  });

  it('the skip action stamps skipped without touching a summary', () => {
    const { root, intermediate } = writeFixture();
    const before = readFileSync(join(intermediate, 'annotated-graph.json'), 'utf-8');

    const skipped = run([root, 'skip'], repoRoot);
    expect(skipped.status, skipped.stderr).toBe(0);
    expect(skipped.stderr).toContain('project.verification=skipped');

    const graph = JSON.parse(readFileSync(join(intermediate, 'annotated-graph.json'), 'utf-8'));
    expect(graph.project.verification).toBe('skipped');
    for (const n of graph.nodes) expect(n.verification).toBeUndefined();
    // Summaries are byte-identical to before.
    expect(graph.nodes.map(n => n.summary)).toEqual(JSON.parse(before).nodes.map(n => n.summary));
    expect(gapOf(graph, 'summary-unchecked').count).toBe(3);
  });

  it('warns instead of inventing verdicts when no verdict file exists', () => {
    const { root, intermediate } = writeFixture();
    const applied = run([root, 'apply'], repoRoot);
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stderr).toContain('no summary-verdicts-');

    const graph = JSON.parse(readFileSync(join(intermediate, 'annotated-graph.json'), 'utf-8'));
    for (const n of graph.nodes) expect(n.verification).toBeUndefined();
  });

  it('rejects an unknown action and an unknown flag', () => {
    const { root } = writeFixture();
    const badAction = run([root, 'validate'], repoRoot);
    expect(badAction.status).toBe(1);
    expect(badAction.stderr).toContain('unknown action');

    const badFlag = run([root, 'prepare', '--verify'], repoRoot);
    expect(badFlag.status).toBe(1);
    expect(badFlag.stderr).toContain('unknown option');
  });

  it('reads verdict files in index order and ignores unrelated json', () => {
    const dir = tempProject();
    writeFileSync(join(dir, 'summary-verdicts-10.json'), JSON.stringify({ verdicts: [{ id: 'j', verdict: 'verified' }] }), 'utf-8');
    writeFileSync(join(dir, 'summary-verdicts-2.json'), JSON.stringify({ verdicts: [{ id: 'i', verdict: 'verified' }] }), 'utf-8');
    writeFileSync(join(dir, 'summary-verify-batch-0.json'), JSON.stringify({ nodes: [] }), 'utf-8');
    const { verdicts, files } = readVerdictFiles(dir);
    expect(files).toEqual(['summary-verdicts-2.json', 'summary-verdicts-10.json']);
    expect(verdicts.map(v => v.id)).toEqual(['i', 'j']);
  });
});

describe('summary-verifier prompt contract', () => {
  const prompt = readFileSync(resolve(repoRoot, 'agents/excavator-summary-verifier.md'), 'utf-8');

  it('offers exactly the three verdicts in its verdict table', () => {
    const rows = [...prompt.matchAll(/^\| `([a-z-]+)` \|/gm)].map(m => m[1]);
    expect(rows).toEqual(['verified', 'unverified', 'contradicted']);
  });

  it('states there is no fourth verdict and no confidence score', () => {
    expect(prompt).toContain('there is no fourth');
    expect(prompt).toContain('no confidence score');
    expect(prompt).toMatch(/no\s+fourth value/);
  });

  it('breaks ties towards the weaker claim', () => {
    expect(prompt).toMatch(/torn between `verified` and `unverified`, choose\s+`unverified`/);
    expect(prompt).toContain('over-claiming turns an');
  });

  it('withholds the graph and keeps reads inside the batch and the root', () => {
    expect(prompt).toContain('**Deliberately withheld:**');
    expect(prompt).toContain('Do NOT read the knowledge graph');
    expect(prompt).toContain('Never read a path that climbs out of the root');
  });

  it('forbids rewriting summaries or the graph', () => {
    expect(prompt).toContain('never edits the graph');
    expect(prompt).toContain('do NOT propose graph');
  });

  it('requires one reason line per verdict and verbatim ids', () => {
    expect(prompt).toContain('`reason` is **one line**');
    expect(prompt).toContain('copied byte-for-byte from the batch');
  });
});

describe('SKILL.md phase 2.5', () => {
  const skill = readFileSync(resolve(repoRoot, 'skills/excavator/SKILL.md'), 'utf-8');

  it('is a new phase between 2.3 and 3, leaving their order intact', () => {
    const at = (heading) => skill.indexOf(heading);
    expect(at('## Phase 2.5 — VERIFY')).toBeGreaterThan(at('## Phase 2.3 — ANNOTATE'));
    expect(at('## Phase 2.5 — VERIFY')).toBeLessThan(at('## Phase 3 — ASSEMBLE REVIEW'));
    expect(at('## Phase 6b — VALIDATE')).toBeGreaterThan(at('## Phase 3 — ASSEMBLE REVIEW'));
  });

  it('documents both options and the three script invocations', () => {
    const section = skill.slice(
      skill.indexOf('## Phase 2.5 — VERIFY'),
      skill.indexOf('## Phase 3 — ASSEMBLE REVIEW'),
    );
    expect(section).toContain('`--no-verify`');
    expect(section).toContain('`--verify-sample <n>`');
    expect(section).toContain('apply-verification.mjs" "$PROJECT_ROOT" prepare');
    expect(section).toContain('apply-verification.mjs" "$PROJECT_ROOT" apply');
    expect(section).toContain('apply-verification.mjs" "$PROJECT_ROOT" skip');
    expect(section).toContain('agents/excavator-summary-verifier.md');
    expect(section).toContain('project.verification');
    expect(section).toContain('contradicted-summaries.json');
    // The verifier is dispatched without the graph or the project description.
    expect(section).toContain('Pass **no** project description');
    // A supplement phase never fails the run.
    expect(section).toContain('Supplement, so not fatal.');
  });
});
