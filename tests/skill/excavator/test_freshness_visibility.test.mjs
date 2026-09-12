/**
 * Freshness visibility (phase 2.3's added half) and the non-git fallback in
 * prepare-incremental.
 *
 * Two things have to hold at once here, and they pull in opposite directions:
 *
 *   1. a file whose content moved without re-analysis must be VISIBLE — its
 *      nodes marked `dirty`, the file named in `meta.json`;
 *   2. the pipeline's own commit-marker logic must behave EXACTLY as before,
 *      because that logic is UA's and this step is a supplement.
 *
 * So the marker is checked two ways: `finalize-incremental.mjs` is proven
 * byte-identical to the base branch, and a real SKIP run is exercised to show
 * the marker still advances while a supplement-written `meta.excavator` key
 * survives.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  annotate, cosmeticDirtyFiles, hostModelName, HOST_MODEL_ENV_VARS, PIPELINE_VERSION,
} from '../../../skills/excavator/annotate-graph.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const skillDir = join(repoRoot, 'skills', 'excavator');
const ANNOTATE = join(skillDir, 'annotate-graph.mjs');
const SCAN = join(skillDir, 'scan-project.mjs');
const IMPORTS = join(skillDir, 'extract-import-map.mjs');
const FINGERPRINTS = join(skillDir, 'build-fingerprints.mjs');
const PREPARE = join(skillDir, 'prepare-incremental.mjs');
const STRUCTURE_ALL = join(skillDir, 'structure-all.mjs');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function tempRoot(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function writeFile(root, path, content) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf-8');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ── unit-level fixtures ───────────────────────────────────────────────────

function scanOf(paths) {
  return {
    contentDigest: 'a'.repeat(64),
    files: paths.map(path => ({
      path, language: 'typescript', sizeLines: 10, fileCategory: 'code',
    })),
    totalFiles: paths.length,
  };
}

function structureOf(paths) {
  return {
    results: paths.map(path => ({
      path, language: 'typescript', status: 'parsed',
      functions: [], classes: [], exports: [], imports: [], callGraph: [],
    })),
  };
}

function graphOf(nodes, project = {}) {
  return {
    version: '1.0.0',
    project: { name: 'fixture', languages: ['typescript'], gitCommitHash: 'a'.repeat(40), ...project },
    nodes,
    edges: [],
    layers: [],
    tour: [],
  };
}

function fileNode(path, overrides = {}) {
  return {
    id: `file:${path}`, type: 'file', name: path.split('/').at(-1), filePath: path,
    summary: `about ${path}`, tags: ['t'], complexity: 'simple', ...overrides,
  };
}

describe('cosmeticDirtyFiles', () => {
  const scan = scanOf(['src/a.ts', 'src/b.ts']);
  const fingerprints = { files: { 'src/a.ts': { contentHash: 'x' }, 'src/b.ts': { contentHash: 'y' } } };

  it('reports nothing when there is no incremental plan', () => {
    // A full analysis re-derived every node from current source, so marking
    // anything dirty would be a lie about fresh work.
    expect(cosmeticDirtyFiles({ plan: null, fingerprints, scan })).toEqual({
      files: [], unfingerprinted: [], reanalysedOverlap: [],
    });
  });

  it('reports the files the plan classified as cosmetic', () => {
    const plan = { cosmeticFiles: ['src/a.ts'], filesToReanalyze: [] };
    expect(cosmeticDirtyFiles({ plan, fingerprints, scan }).files).toEqual(['src/a.ts']);
  });

  it('drops a cosmetic file that is no longer scanned', () => {
    const plan = { cosmeticFiles: ['src/gone.ts'], filesToReanalyze: [] };
    expect(cosmeticDirtyFiles({ plan, fingerprints, scan }).files).toEqual([]);
  });

  it('counts a file that is both cosmetic and re-analysed instead of marking it', () => {
    const plan = { cosmeticFiles: ['src/a.ts'], filesToReanalyze: ['src/a.ts'] };
    const result = cosmeticDirtyFiles({ plan, fingerprints, scan });
    expect(result.files).toEqual([]);
    expect(result.reanalysedOverlap).toEqual(['src/a.ts']);
  });

  it('still reports a cosmetic file with no baseline fingerprint, and counts the hole', () => {
    const plan = { cosmeticFiles: ['src/b.ts'], filesToReanalyze: [] };
    const result = cosmeticDirtyFiles({ plan, fingerprints: { files: {} }, scan });
    expect(result.files).toEqual(['src/b.ts']);
    expect(result.unfingerprinted).toEqual(['src/b.ts']);
  });
});

describe('annotate marks the nodes of files it did not re-analyse', () => {
  const paths = ['src/a.ts', 'src/b.ts'];
  const base = {
    structure: structureOf(paths),
    scan: scanOf(paths),
    importMap: { importMap: {} },
    fingerprints: { files: { 'src/a.ts': { contentHash: 'x' }, 'src/b.ts': { contentHash: 'y' } } },
  };

  it('marks only the cosmetic file, and says so in gaps and audit', () => {
    const graph = graphOf([
      fileNode('src/a.ts'),
      { ...fileNode('src/a.ts'), id: 'function:src/a.ts:threshold', type: 'function', name: 'threshold', lineRange: [3, 9] },
      fileNode('src/b.ts'),
    ]);
    const { annotated, audit, dirtyFiles } = annotate({
      ...base, graph, plan: { cosmeticFiles: ['src/a.ts'], filesToReanalyze: ['src/b.ts'] },
    });

    const byId = new Map(annotated.nodes.map(n => [n.id, n]));
    expect(byId.get('file:src/a.ts').verification).toBe('dirty');
    expect(byId.get('function:src/a.ts:threshold').verification).toBe('dirty');
    expect(byId.get('file:src/b.ts').verification).toBeUndefined();

    expect(dirtyFiles).toEqual(['src/a.ts']);
    expect(audit.counts.dirtyFiles).toBe(1);
    expect(audit.counts.dirtyNodes).toBe(2);
    const gap = annotated.gaps.find(g => g.kind === 'cosmetic-dirty');
    expect(gap.count).toBe(1);
    expect(gap.samples).toEqual(['src/a.ts']);
  });

  it('marks nothing at all without a plan', () => {
    const graph = graphOf([fileNode('src/a.ts')]);
    const { annotated, audit } = annotate({ ...base, graph });
    expect(annotated.nodes[0].verification).toBeUndefined();
    expect(audit.counts.dirtyFiles).toBe(0);
    expect(annotated.gaps.some(g => g.kind === 'cosmetic-dirty')).toBe(false);
  });

  it('does not downgrade a contradicted node to dirty', () => {
    const graph = graphOf([
      fileNode('src/a.ts', { verification: 'contradicted' }),
      fileNode('src/b.ts', { verification: 'verified' }),
    ]);
    const { annotated, audit } = annotate({
      ...base, graph, plan: { cosmeticFiles: ['src/a.ts', 'src/b.ts'], filesToReanalyze: [] },
    });
    expect(annotated.nodes[0].verification).toBe('contradicted');
    // "The source moved" DOES outrank "a summary was confirmed earlier".
    expect(annotated.nodes[1].verification).toBe('dirty');
    expect(audit.counts.dirtyPreserved).toBe(1);
    expect(audit.counts.dirtyNodes).toBe(1);
  });

  it('leaves every summary the model wrote untouched', () => {
    const graph = graphOf([fileNode('src/a.ts')]);
    const before = graph.nodes[0].summary;
    const { annotated } = annotate({
      ...base, graph, plan: { cosmeticFiles: ['src/a.ts'], filesToReanalyze: [] },
    });
    expect(annotated.nodes[0].summary).toBe(before);
  });
});

describe('non-git targets get a null commit and a source digest', () => {
  const paths = ['src/a.ts'];
  const base = { structure: structureOf(paths), scan: scanOf(paths), importMap: { importMap: {} } };

  it.each([
    ['a missing field', undefined],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['the word unknown', 'unknown'],
    ['a branch name', 'HEAD'],
    ['the word none', 'none'],
    ['an already-null value', null],
  ])('normalises %s to null', (_label, value) => {
    const graph = graphOf([fileNode('src/a.ts')], { gitCommitHash: value });
    if (value === undefined) delete graph.project.gitCommitHash;
    const { annotated } = annotate({ ...base, graph });
    expect(annotated.project.gitCommitHash).toBeNull();
    expect(annotated.project.sourceDigest).toBe('a'.repeat(64));
  });

  it('keeps any value that carries an identifier', () => {
    // A commit, an abbreviated commit, and the pipeline's own multi-repo
    // marker for a parent directory of separate repositories. Nulling that
    // last one would discard the only record of which member states the
    // graph was built from — and would rewrite a value the pipeline wrote.
    for (const hash of ['a'.repeat(40), 'abc1234', `multi-repo:${'d'.repeat(64)}`]) {
      const graph = graphOf([fileNode('src/a.ts')], { gitCommitHash: hash });
      const { annotated, audit } = annotate({ ...base, graph });
      expect(annotated.project.gitCommitHash).toBe(hash);
      expect(audit.counts.gitCommitHashNormalized).toBe(0);
    }
  });

  it('counts the normalisation and names what it replaced', () => {
    const graph = graphOf([fileNode('src/a.ts')], { gitCommitHash: 'unknown' });
    const { annotated, audit } = annotate({ ...base, graph });
    expect(audit.counts.gitCommitHashNormalized).toBe(1);
    const gap = annotated.gaps.find(g => g.kind === 'git-commit-hash-normalized');
    expect(gap.count).toBe(1);
    expect(gap.samples).toEqual(['unknown']);
  });

  it('does not count an absent field as a replacement', () => {
    const graph = graphOf([fileNode('src/a.ts')]);
    delete graph.project.gitCommitHash;
    const { annotated, audit } = annotate({ ...base, graph });
    expect(annotated.project.gitCommitHash).toBeNull();
    expect(audit.counts.gitCommitHashNormalized).toBe(0);
  });

  it('reports a gap when the scan has no contentDigest to stand in for a commit', () => {
    const scan = scanOf(paths);
    delete scan.contentDigest;
    const graph = graphOf([fileNode('src/a.ts')], { gitCommitHash: null });
    const { annotated, audit } = annotate({ ...base, scan, graph });
    expect(annotated.project.sourceDigest).toBeUndefined();
    expect(audit.counts.sourceDigestMissing).toBe(1);
    expect(annotated.gaps.some(g => g.kind === 'source-digest-missing')).toBe(true);
  });
});

describe('annotate publishes dirtyFiles into meta.json', () => {
  function fixture({ withMeta = true } = {}) {
    const root = tempRoot('excavator-dirty-meta-');
    const intermediate = join(root, '.excavator', 'intermediate');
    mkdirSync(intermediate, { recursive: true });
    writeFile(root, 'src/a.ts', 'export const a = 1;\n');
    writeFileSync(join(intermediate, 'assembled-graph.json'),
      JSON.stringify(graphOf([fileNode('src/a.ts')])), 'utf-8');
    writeFileSync(join(intermediate, 'structure-all.json'),
      JSON.stringify(structureOf(['src/a.ts'])), 'utf-8');
    writeFileSync(join(intermediate, 'scan-result.json'),
      JSON.stringify(scanOf(['src/a.ts'])), 'utf-8');
    writeFileSync(join(intermediate, 'import-map.json'), JSON.stringify({ importMap: {} }), 'utf-8');
    writeFileSync(join(intermediate, 'incremental-plan.json'),
      JSON.stringify({ cosmeticFiles: ['src/a.ts'], filesToReanalyze: [] }), 'utf-8');
    writeFileSync(join(root, '.excavator', 'fingerprints.json'),
      JSON.stringify({ files: { 'src/a.ts': { contentHash: 'x' } } }), 'utf-8');
    if (withMeta) {
      writeFileSync(join(root, '.excavator', 'meta.json'), JSON.stringify({
        lastAnalyzedAt: '2026-01-01T00:00:00.000Z',
        gitCommitHash: 'b'.repeat(40),
        version: '1.0.0',
        analyzedFiles: 1,
      }), 'utf-8');
    }
    return { root, intermediate };
  }

  it('adds excavator.dirtyFiles without disturbing the pipeline keys', () => {
    const { root } = fixture();
    const result = run(process.execPath, [ANNOTATE, root], repoRoot);
    expect(result.stderr).toContain('dirty-files=1');

    const meta = readJson(join(root, '.excavator', 'meta.json'));
    expect(meta.excavator.dirtyFiles).toEqual(['src/a.ts']);
    expect(meta.excavator.pipelineVersion).toBe(PIPELINE_VERSION);
    expect(meta.excavator.model).toBe('unknown');
    // The commit marker is finalize's business, not this step's.
    expect(meta.gitCommitHash).toBe('b'.repeat(40));
    expect(meta.lastAnalyzedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(meta.analyzedFiles).toBe(1);
    expect(meta.version).toBe('1.0.0');
  });

  it('leaves meta.json alone under --no-meta', () => {
    const { root } = fixture();
    const before = readFileSync(join(root, '.excavator', 'meta.json'), 'utf-8');
    run(process.execPath, [ANNOTATE, root, '--no-meta'], repoRoot);
    expect(readFileSync(join(root, '.excavator', 'meta.json'), 'utf-8')).toBe(before);
    // The graph still carries the marking; only the publish is suppressed.
    const graph = readJson(join(root, '.excavator', 'intermediate', 'annotated-graph.json'));
    expect(graph.nodes[0].verification).toBe('dirty');
  });

  it('warns instead of inventing a meta.json that does not exist', () => {
    const { root } = fixture({ withMeta: false });
    const result = run(process.execPath, [ANNOTATE, root], repoRoot);
    expect(result.stderr).toContain('no meta.json at');
    expect(existsSync(join(root, '.excavator', 'meta.json'))).toBe(false);
  });
});

// ── the git-backed baseline harness ───────────────────────────────────────

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf-8' }).trim();
}

function buildBaseline(root, { gitCommitHash }) {
  const dataDir = join(root, '.excavator');
  const intermediate = join(dataDir, 'intermediate');
  mkdirSync(intermediate, { recursive: true });

  const rawScanPath = join(intermediate, 'baseline-scan.json');
  run(process.execPath, [SCAN, root, rawScanPath, '--exclude-analysis-data'], root);
  const rawScan = readJson(rawScanPath);

  const importInput = join(intermediate, 'baseline-import-input.json');
  const importOutput = join(intermediate, 'baseline-import-output.json');
  writeFileSync(importInput, JSON.stringify({ projectRoot: root, files: rawScan.files }), 'utf-8');
  run(process.execPath, [IMPORTS, importInput, importOutput], root);
  const importMap = readJson(importOutput).importMap;

  writeFileSync(join(intermediate, 'scan-result.json'), JSON.stringify({
    name: 'fixture',
    description: 'fixture project',
    languages: [...new Set(rawScan.files.map(f => f.language))].sort(),
    frameworks: [],
    contentDigest: rawScan.contentDigest,
    files: rawScan.files,
    totalFiles: rawScan.totalFiles,
    filteredByIgnore: rawScan.filteredByIgnore,
    estimatedComplexity: rawScan.estimatedComplexity,
    importMap,
  }), 'utf-8');

  const fingerprintInput = join(intermediate, 'fingerprint-input.json');
  writeFileSync(fingerprintInput, JSON.stringify({
    projectRoot: root,
    filePaths: rawScan.files.map(f => f.path),
    gitCommitHash,
  }), 'utf-8');
  run(process.execPath, [FINGERPRINTS, fingerprintInput], root);

  const nodes = rawScan.files.map(file => fileNode(file.path));
  writeFileSync(join(dataDir, 'knowledge-graph.json'), JSON.stringify({
    version: '1.0.0',
    project: {
      name: 'fixture', languages: ['typescript'], frameworks: [],
      description: 'fixture project', analyzedAt: '2026-01-01T00:00:00.000Z',
      gitCommitHash,
    },
    nodes,
    edges: [],
    layers: [{ id: 'layer:source', name: 'Source', description: 'src', nodeIds: nodes.map(n => n.id) }],
    tour: [{ order: 1, title: 'Overview', description: 'read', nodeIds: nodes.map(n => n.id) }],
  }), 'utf-8');
  writeFileSync(join(dataDir, 'meta.json'), JSON.stringify({
    gitCommitHash, analyzedFiles: nodes.length, version: '1.0.0',
  }), 'utf-8');
  return { dataDir, intermediate };
}

describe('the cosmetic-change scenario end to end', { timeout: 60_000 }, () => {
  it('marks the changed file dirty while the commit marker stays finalize\'s job', () => {
    const root = tempRoot('excavator-freshness-git-');
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'Test User']);
    writeFile(root, '.gitignore', '.excavator/\n');
    // `src/threshold.ts` gets a body-only edit (a literal), which classifies
    // as COSMETIC; `src/added.ts` gains a function, which is STRUCTURAL and
    // keeps the run on the path that reaches phase 2.3.
    writeFile(root, 'src/threshold.ts', [
      'export function overLimit(value: number) {',
      '  return value > 10;',
      '}',
      '',
    ].join('\n'));
    writeFile(root, 'src/added.ts', 'export const a = 1;\n');
    writeFile(root, 'src/other.ts', 'export const b = 2;\n');
    writeFile(root, 'src/more.ts', 'export const c = 3;\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'baseline']);
    const baseCommit = git(root, ['rev-parse', 'HEAD']);
    const { dataDir, intermediate } = buildBaseline(root, { gitCommitHash: baseCommit });

    writeFile(root, 'src/threshold.ts', [
      'export function overLimit(value: number) {',
      '  return value > 20;',
      '}',
      '',
    ].join('\n'));
    writeFile(root, 'src/added.ts', [
      'export const a = 1;',
      'export function extra() {',
      '  return a;',
      '}',
      '',
    ].join('\n'));
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'threshold + a new function']);
    const headCommit = git(root, ['rev-parse', 'HEAD']);

    run(process.execPath, [PREPARE, root, baseCommit], root);
    const plan = readJson(join(intermediate, 'incremental-plan.json'));
    expect(plan.cosmeticFiles).toEqual(['src/threshold.ts']);
    expect(plan.filesToReanalyze).toEqual(['src/added.ts']);

    run(process.execPath, [STRUCTURE_ALL, root], root);
    // The graph under audit stands in for the merge output of this run.
    const graph = readJson(join(dataDir, 'knowledge-graph.json'));
    graph.nodes.push({
      id: 'function:src/threshold.ts:overLimit', type: 'function', name: 'overLimit',
      filePath: 'src/threshold.ts', lineRange: [1, 3],
      summary: 'Returns true above the threshold of 10.', tags: ['predicate'], complexity: 'simple',
    });
    writeFileSync(join(intermediate, 'assembled-graph.json'), JSON.stringify(graph), 'utf-8');

    const annotated = run(process.execPath, [
      ANNOTATE, root, '--import-map', join(intermediate, 'import-map-missing.json'),
    ], repoRoot);
    expect(annotated.stderr).toContain('dirty-files=1');

    const audited = readJson(join(intermediate, 'annotated-graph.json'));
    const byId = new Map(audited.nodes.map(n => [n.id, n]));
    expect(byId.get('file:src/threshold.ts').verification).toBe('dirty');
    expect(byId.get('function:src/threshold.ts:overLimit').verification).toBe('dirty');
    // The stale summary is still readable — marked, not deleted.
    expect(byId.get('function:src/threshold.ts:overLimit').summary)
      .toBe('Returns true above the threshold of 10.');
    expect(byId.get('file:src/added.ts').verification).toBeUndefined();

    const meta = readJson(join(dataDir, 'meta.json'));
    expect(meta.excavator.dirtyFiles).toEqual(['src/threshold.ts']);
    // Annotate must not advance the marker: that is finalize's decision and
    // this run has not finalized.
    expect(meta.gitCommitHash).toBe(baseCommit);
    expect(meta.gitCommitHash).not.toBe(headCommit);
  });

  it('advances the commit marker on a cosmetic SKIP and keeps the supplement key', () => {
    const root = tempRoot('excavator-freshness-skip-');
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'Test User']);
    writeFile(root, '.gitignore', '.excavator/\n');
    writeFile(root, 'src/a.ts', 'export function value() { return 1; }\n');
    writeFile(root, 'src/b.ts', 'export const b = 2;\n');
    writeFile(root, 'src/c.ts', 'export const c = 3;\n');
    writeFile(root, 'src/d.ts', 'export const d = 4;\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'baseline']);
    const baseCommit = git(root, ['rev-parse', 'HEAD']);
    const { dataDir } = buildBaseline(root, { gitCommitHash: baseCommit });

    // A supplement-written key, as annotate would have left it.
    const meta = readJson(join(dataDir, 'meta.json'));
    meta.excavator = { dirtyFiles: ['src/a.ts'] };
    writeFileSync(join(dataDir, 'meta.json'), JSON.stringify(meta), 'utf-8');

    writeFile(root, 'src/a.ts', 'export function value() { return 2; }\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'implementation only']);
    const headCommit = git(root, ['rev-parse', 'HEAD']);

    run(process.execPath, [PREPARE, root, baseCommit], root);
    const plan = readJson(join(dataDir, 'intermediate', 'incremental-plan.json'));
    expect(plan.action).toBe('SKIP');
    expect(plan.cosmeticFiles).toEqual(['src/a.ts']);

    run(process.execPath, [join(skillDir, 'finalize-incremental.mjs'), root], root);
    const after = readJson(join(dataDir, 'meta.json'));
    // Unchanged UA behaviour: the marker advances on a cosmetic SKIP.
    expect(after.gitCommitHash).toBe(headCommit);
    // And the supplement's key is carried through rather than dropped.
    expect(after.excavator.dirtyFiles).toEqual(['src/a.ts']);
  });
});

describe('service-only incremental finalization', () => {
  it('forces an empty tour before advancing fingerprints and metadata', () => {
    const current = readFileSync(
      resolve(repoRoot, 'skills/excavator/finalize-incremental.mjs'),
      'utf-8',
    );
    expect(current).toContain('tour: []');
    expect(current).not.toContain('rerunTour');
    expect(current).not.toContain('tour.json');
    expect(current.lastIndexOf('atomicWriteJson(graphPath, graph)'))
      .toBeLessThan(current.lastIndexOf('patchFingerprints(dataDir, plan, patch)'));
    expect(current.lastIndexOf('patchFingerprints(dataDir, plan, patch)'))
      .toBeLessThan(current.lastIndexOf('advanceMeta(dataDir, plan, scan.totalFiles)'));
  });
});

describe('prepare-incremental without git', { timeout: 60_000 }, () => {
  function nonGitProject() {
    const root = tempRoot('excavator-nongit-');
    writeFile(root, 'src/a.ts', 'export const a = 1;\n');
    writeFile(root, 'src/b.ts', 'export const b = 2;\n');
    writeFile(root, 'src/c.ts', 'export const c = 3;\n');
    writeFile(root, 'src/d.ts', 'export const d = 4;\n');
    const { dataDir, intermediate } = buildBaseline(root, { gitCommitHash: null });
    return { root, dataDir, intermediate };
  }

  it('does not fail for lack of git, and the change set is exactly the changed file', () => {
    const { root, intermediate } = nonGitProject();
    expect(existsSync(join(root, '.git'))).toBe(false);

    writeFile(root, 'src/b.ts', 'export const b = 2;\nexport function grew() { return b; }\n');

    const result = run(process.execPath, [PREPARE, root], root);
    expect(result.stderr).toContain('not a git repository');

    const plan = readJson(join(intermediate, 'incremental-plan.json'));
    expect(plan.baseCommit).toBeNull();
    expect(plan.headCommit).toBeNull();
    expect(plan.filesToReanalyze).toEqual(['src/b.ts']);
    expect(plan.deletedFiles).toEqual([]);
    expect(readJson(join(intermediate, 'changed-files.json'))).toEqual(['src/b.ts']);
  });

  it('sees a cosmetic-only edit as cosmetic, not as nothing', () => {
    const { root, intermediate } = nonGitProject();
    writeFile(root, 'src/a.ts', 'export const a = 99;\n');

    run(process.execPath, [PREPARE, root], root);
    const plan = readJson(join(intermediate, 'incremental-plan.json'));
    expect(plan.cosmeticFiles).toEqual(['src/a.ts']);
    expect(plan.filesToReanalyze).toEqual([]);
  });

  it('reports no change set when nothing changed', () => {
    const { root, intermediate } = nonGitProject();
    run(process.execPath, [PREPARE, root], root);
    const plan = readJson(join(intermediate, 'incremental-plan.json'));
    expect(plan.filesToReanalyze).toEqual([]);
    expect(plan.cosmeticFiles).toEqual([]);
    expect(plan.action).toBe('SKIP');
  });

  it('detects a deleted file without a git diff', () => {
    const { root, intermediate } = nonGitProject();
    rmSync(join(root, 'src/d.ts'));
    run(process.execPath, [PREPARE, root], root);
    const plan = readJson(join(intermediate, 'incremental-plan.json'));
    expect(plan.deletedFiles).toEqual(['src/d.ts']);
  });

  it('still requires a base commit when the target IS a repository', () => {
    const { root } = nonGitProject();
    execFileSync('git', ['-C', root, 'init', '-b', 'main'], { encoding: 'utf-8' });
    const result = spawnSync(process.execPath, [PREPARE, root], { cwd: root, encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: node prepare-incremental.mjs');
  });
});

describe('project.model says which model wrote the prose', () => {
  const paths = ['src/a.ts'];
  const base = { structure: structureOf(paths), scan: scanOf(paths), importMap: { importMap: {} } };

  it('defaults to unknown rather than to a guess', () => {
    const { annotated } = annotate({ ...base, graph: graphOf([fileNode('src/a.ts')]) });
    expect(annotated.project.model).toBe('unknown');
    expect(annotated.project.pipelineVersion).toBe(PIPELINE_VERSION);
  });

  it('stamps the name it is given', () => {
    const { annotated } = annotate({
      ...base, graph: graphOf([fileNode('src/a.ts')]), model: 'claude-opus-5',
    });
    expect(annotated.project.model).toBe('claude-opus-5');
  });

  it('treats a blank name as unknown', () => {
    for (const model of ['', '   ', null, undefined]) {
      const { annotated } = annotate({ ...base, graph: graphOf([fileNode('src/a.ts')]), model });
      expect(annotated.project.model).toBe('unknown');
    }
  });

  it('reads the host env in the documented order, explicit flag first', () => {
    expect(hostModelName({}, null)).toBe('unknown');
    expect(hostModelName({ CLAUDE_MODEL: 'from-env' }, null)).toBe('from-env');
    expect(hostModelName({ CLAUDE_MODEL: 'from-env' }, 'from-flag')).toBe('from-flag');
    expect(hostModelName({ CLAUDE_MODEL: '  spaced  ' }, null)).toBe('spaced');
    // Every documented variable is actually consulted.
    for (const name of HOST_MODEL_ENV_VARS) {
      expect(hostModelName({ [name]: `via-${name}` }, null)).toBe(`via-${name}`);
    }
  });

  it('honours --model on the command line', () => {
    const root = tempRoot('excavator-model-');
    const intermediate = join(root, '.excavator', 'intermediate');
    mkdirSync(intermediate, { recursive: true });
    writeFile(root, 'src/a.ts', 'export const a = 1;\n');
    writeFileSync(join(intermediate, 'assembled-graph.json'),
      JSON.stringify(graphOf([fileNode('src/a.ts')])), 'utf-8');
    writeFileSync(join(intermediate, 'structure-all.json'),
      JSON.stringify(structureOf(['src/a.ts'])), 'utf-8');
    writeFileSync(join(intermediate, 'scan-result.json'),
      JSON.stringify(scanOf(['src/a.ts'])), 'utf-8');

    run(process.execPath, [ANNOTATE, root, '--model', 'claude-opus-5'], repoRoot);
    const annotated = readJson(join(intermediate, 'annotated-graph.json'));
    expect(annotated.project.model).toBe('claude-opus-5');
  });
});
