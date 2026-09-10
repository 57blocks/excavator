/**
 * mark-dirty.mjs — freshness on the `SKIP` path.
 *
 * The gap this closes: a commit whose only change is cosmetic is classified
 * `SKIP`, the pipeline finalizes and STOPS, and phases 1.2 / 2.3 / 6b never
 * run — so the dirty marking missed the exact commit shape it was written for.
 *
 * Two properties matter. The marking must LAND on the published graph through
 * the same publish step everything else uses (one writer of that file), and it
 * must not drift from phase 2.3's answer for the same plan: both call the same
 * `cosmeticDirtyFiles` and the same never-downgrade merge, and the test asserts
 * the two paths agree node for node.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markDirty, OWNED_GAP_KINDS } from '../../../skills/excavator/mark-dirty.mjs';
import { annotate } from '../../../skills/excavator/annotate-graph.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const MARK_DIRTY = resolve(repoRoot, 'skills/excavator/mark-dirty.mjs');
const PUBLISH = resolve(repoRoot, 'skills/excavator/publish-annotations.mjs');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'excavator-skip-dirty-'));
  roots.push(dir);
  return dir;
}

const PATHS = ['src/threshold.ts', 'src/other.ts'];

function scanOf(paths = PATHS) {
  return {
    contentDigest: 'a'.repeat(64),
    files: paths.map(path => ({ path, language: 'typescript', sizeLines: 10, fileCategory: 'code' })),
    totalFiles: paths.length,
  };
}

function structureOf(paths = PATHS) {
  return {
    results: paths.map(path => ({
      path, language: 'typescript', status: 'parsed',
      functions: [], classes: [], exports: [], imports: [], callGraph: [],
    })),
  };
}

function fingerprintsOf(paths = PATHS) {
  return { files: Object.fromEntries(paths.map(path => [path, { contentHash: 'x' }])) };
}

function graphOf(extra = {}) {
  return {
    version: '1.0.0',
    project: {
      name: 'fixture', languages: ['typescript'],
      gitCommitHash: 'multi-repo:' + 'd'.repeat(64),
    },
    nodes: [
      {
        id: 'file:src/threshold.ts', type: 'file', name: 'threshold.ts', filePath: 'src/threshold.ts',
        summary: 'Holds the limit check.', tags: ['t'], complexity: 'simple',
      },
      {
        id: 'function:src/threshold.ts:overLimit', type: 'function', name: 'overLimit',
        filePath: 'src/threshold.ts', lineRange: [1, 3],
        summary: 'Returns true above the threshold of 10.', tags: ['t'], complexity: 'simple',
      },
      {
        id: 'file:src/other.ts', type: 'file', name: 'other.ts', filePath: 'src/other.ts',
        summary: 'Untouched.', tags: ['t'], complexity: 'simple',
      },
    ],
    edges: [{
      source: 'file:src/threshold.ts', target: 'function:src/threshold.ts:overLimit',
      type: 'contains', direction: 'forward', weight: 1.0,
    }],
    layers: [], tour: [],
    ...extra,
  };
}

const skipPlan = {
  action: 'SKIP', baseCommit: null, headCommit: null,
  filesToReanalyze: [], deletedFiles: [],
  cosmeticFiles: ['src/threshold.ts'], ignoredFiles: [], generatedArtifactFiles: [],
};

describe('markDirty', () => {
  it('marks the cosmetic file\'s nodes and leaves the rest alone', () => {
    const { marked, counts, dirtyFiles } = markDirty({
      graph: graphOf(), plan: skipPlan, fingerprints: fingerprintsOf(), scan: scanOf(),
    });
    const byId = new Map(marked.nodes.map(n => [n.id, n]));
    expect(byId.get('file:src/threshold.ts').verification).toBe('dirty');
    expect(byId.get('function:src/threshold.ts:overLimit').verification).toBe('dirty');
    expect(byId.get('file:src/other.ts').verification).toBeUndefined();
    expect(counts.dirtyFiles).toBe(1);
    expect(counts.dirtyNodes).toBe(2);
    expect(dirtyFiles).toEqual(['src/threshold.ts']);
    expect(marked.gaps.find(g => g.kind === 'cosmetic-dirty').count).toBe(1);
  });

  it('keeps every summary and adds no node or edge', () => {
    const graph = graphOf();
    const { marked } = markDirty({
      graph, plan: skipPlan, fingerprints: fingerprintsOf(), scan: scanOf(),
    });
    expect(marked.nodes.map(n => n.summary)).toEqual(graph.nodes.map(n => n.summary));
    expect(marked.nodes).toHaveLength(graph.nodes.length);
    expect(marked.edges).toEqual(graph.edges);
    expect(marked.project.gitCommitHash).toBe(graph.project.gitCommitHash);
  });

  it('does not downgrade a contradicted marking', () => {
    const graph = graphOf();
    graph.nodes[1].verification = 'contradicted';
    const { marked, counts } = markDirty({
      graph, plan: skipPlan, fingerprints: fingerprintsOf(), scan: scanOf(),
    });
    expect(marked.nodes[1].verification).toBe('contradicted');
    expect(counts.dirtyPreserved).toBe(1);
    expect(counts.dirtyNodes).toBe(1);
  });

  it('marks nothing when the cosmetic file is no longer analysed', () => {
    const { counts } = markDirty({
      graph: graphOf(), plan: skipPlan, fingerprints: fingerprintsOf(),
      scan: scanOf(['src/other.ts']),
    });
    expect(counts.dirtyFiles).toBe(0);
    expect(counts.dirtyNodes).toBe(0);
  });

  it('is idempotent and owns only its own gap rows', () => {
    const args = { plan: skipPlan, fingerprints: fingerprintsOf(), scan: scanOf() };
    const graph = graphOf({
      gaps: [{ kind: 'edge-missing', scope: 'imports', reason: 'from annotate', count: 7, samples: [] }],
    });
    const first = markDirty({ graph, ...args });
    const second = markDirty({ graph: first.marked, ...args });
    expect(JSON.stringify(second.marked)).toBe(JSON.stringify(first.marked));
    expect(second.marked.gaps.filter(g => g.kind === 'cosmetic-dirty')).toHaveLength(1);
    expect(second.marked.gaps.find(g => g.kind === 'edge-missing').count).toBe(7);
    expect(OWNED_GAP_KINDS).not.toContain('edge-missing');
  });

  it('agrees with phase 2.3 about the same plan', () => {
    // The two paths must not drift: same plan, same nodes marked.
    const viaSkip = markDirty({
      graph: graphOf(), plan: skipPlan, fingerprints: fingerprintsOf(), scan: scanOf(),
    }).marked;
    const viaAnnotate = annotate({
      graph: graphOf(), structure: structureOf(), scan: scanOf(),
      importMap: { importMap: {} }, plan: skipPlan, fingerprints: fingerprintsOf(),
    }).annotated;

    const marks = graph => Object.fromEntries(
      graph.nodes.map(n => [n.id, n.verification ?? null]),
    );
    expect(marks(viaSkip)).toEqual(marks(viaAnnotate));
  });
});

describe('the SKIP path end to end', () => {
  function fixture({ withScan = true, cosmetic = ['src/threshold.ts'] } = {}) {
    const root = tempRoot();
    const dataDir = join(root, '.excavator');
    const intermediate = join(dataDir, 'intermediate');
    mkdirSync(intermediate, { recursive: true });
    writeFileSync(join(dataDir, 'knowledge-graph.json'), JSON.stringify(graphOf(), null, 2), 'utf-8');
    writeFileSync(join(dataDir, 'fingerprints.json'), JSON.stringify(fingerprintsOf(), null, 2), 'utf-8');
    writeFileSync(join(dataDir, 'meta.json'), JSON.stringify({
      lastAnalyzedAt: '2026-01-01T00:00:00.000Z',
      gitCommitHash: 'b'.repeat(40), version: '1.0.0', analyzedFiles: 2,
    }, null, 2), 'utf-8');
    writeFileSync(join(intermediate, 'incremental-plan.json'), JSON.stringify({
      ...skipPlan, cosmeticFiles: cosmetic,
    }, null, 2), 'utf-8');
    if (withScan) {
      writeFileSync(join(intermediate, 'scan-result.json'), JSON.stringify(scanOf(), null, 2), 'utf-8');
    }
    return { root, dataDir, intermediate };
  }

  function run(script, root, extra = []) {
    return spawnSync(process.execPath, [script, root, ...extra], { encoding: 'utf-8', cwd: repoRoot });
  }

  it('marks, publishes into the saved graph, and records dirtyFiles in meta.json', () => {
    const { root, dataDir, intermediate } = fixture();

    const marked = run(MARK_DIRTY, root);
    expect(marked.status, marked.stderr).toBe(0);
    expect(marked.stderr).toContain('dirty-files=1 dirty-nodes=2');

    const published = run(PUBLISH, root, [
      '--annotated', join(intermediate, 'dirty-graph.json'), '--no-reports',
    ]);
    expect(published.status, published.stderr).toBe(0);

    const graph = JSON.parse(readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8'));
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    expect(byId.get('file:src/threshold.ts').verification).toBe('dirty');
    expect(byId.get('function:src/threshold.ts:overLimit').verification).toBe('dirty');
    expect(byId.get('file:src/other.ts').verification).toBeUndefined();
    // The stale summary is still there to read — marked, not deleted.
    expect(byId.get('function:src/threshold.ts:overLimit').summary)
      .toBe('Returns true above the threshold of 10.');
    expect(graph.gaps.find(g => g.kind === 'cosmetic-dirty').count).toBe(1);

    const meta = JSON.parse(readFileSync(join(dataDir, 'meta.json'), 'utf-8'));
    expect(meta.excavator.dirtyFiles).toEqual(['src/threshold.ts']);
    // The finalizer's marker is untouched by this step.
    expect(meta.gitCommitHash).toBe('b'.repeat(40));
    expect(meta.analyzedFiles).toBe(2);
  });

  it('prints a note and changes nothing when the plan has no analysed cosmetic file', () => {
    const { root, dataDir } = fixture({ cosmetic: [] });
    const before = readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8');
    const result = run(MARK_DIRTY, root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('nothing marked');
    expect(readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8')).toBe(before);
  });

  it('refuses to mark without the scan inventory rather than guessing', () => {
    const { root } = fixture({ withScan: false });
    const result = run(MARK_DIRTY, root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('cannot confirm which files are still analysed');
  });

  it('does nothing without an incremental plan', () => {
    const { root, intermediate } = fixture();
    rmSync(join(intermediate, 'incremental-plan.json'));
    const result = run(MARK_DIRTY, root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('nothing was skipped, so nothing is dirty');
  });

  it('rejects an unknown option', () => {
    const { root } = fixture();
    const result = run(MARK_DIRTY, root, ['--mark-everything']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown option');
  });
});

describe('the SKIP path is wired in both places, additively', () => {
  const skill = readFileSync(resolve(repoRoot, 'skills/excavator/SKILL.md'), 'utf-8');
  const hook = readFileSync(resolve(repoRoot, 'hooks/auto-update-prompt.md'), 'utf-8');

  it.each([['SKILL.md', skill], ['auto-update-prompt.md', hook]])('%s runs mark-dirty then publish', (_label, text) => {
    expect(text).toContain('mark-dirty.mjs');
    expect(text).toContain('publish-annotations.mjs');
    expect(text.indexOf('mark-dirty.mjs')).toBeLessThan(text.indexOf('publish-annotations.mjs'));
    // The finalizer still comes first and is unchanged.
    expect(text.indexOf('finalize-incremental.mjs')).toBeLessThan(text.indexOf('mark-dirty.mjs'));
  });

  it('deletes nothing from either file', () => {
    const refs = ['excavator-v2', 'origin/excavator-v2'];
    const ref = refs.find(candidate => spawnSync(
      'git', ['-C', repoRoot, 'rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], { encoding: 'utf-8' },
    ).status === 0);
    expect(ref).toBeTruthy();
    for (const path of ['skills/excavator/SKILL.md', 'hooks/auto-update-prompt.md']) {
      const numstat = spawnSync('git', ['-C', repoRoot, 'diff', '--numstat', ref, '--', path], { encoding: 'utf-8' })
        .stdout.trim();
      expect(numstat, path).not.toBe('');
      const [added, deleted] = numstat.split('\n')[0].split('\t');
      expect(Number(deleted), `${path} deleted ${deleted} line(s)`).toBe(0);
      expect(Number(added)).toBeGreaterThan(0);
    }
  });
});

describe('the freshness spec says what the pipeline actually reports', () => {
  const spec = readFileSync(
    resolve(repoRoot, 'openspec/changes/verifiable-statements/specs/freshness/spec.md'), 'utf-8',
  );

  it('uses the pipeline\'s existing reason string, not an invented one', () => {
    expect(spec).toContain('missing-graph-commit');
    expect(spec).not.toContain('`no-git`');
    expect(spec).toContain('SHALL NOT be renamed by this change');
  });

  it('keeps the multi-repo marker as version information', () => {
    expect(spec).toContain('multi-repo:<digest>');
    expect(spec).toContain('not an absence');
  });
});
