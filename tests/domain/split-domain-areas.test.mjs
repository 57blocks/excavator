/**
 * split-domain-areas.mjs — every source file goes to exactly one bounded area.
 *
 * One domain-analyzer for a whole project reads what fits and skips the rest
 * without saying so. The split is the deterministic floor: each module is
 * handed to exactly one analyzer, no area exceeds the byte budget unless a
 * single file does (and then it says so), and a re-run cannot leave an older
 * analysis lying where the analyzer writes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planAreas, moduleOf, isTestFile } from '../../skills/excavator-domain/split-domain-areas.mjs';
import { writeKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SPLIT = resolve(repoRoot, 'skills/excavator-domain/split-domain-areas.mjs');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'domain-split-'));
  roots.push(dir);
  return dir;
}

/** A domain-context.json shaped like the extractor's, built from a file list. */
function contextFor(files, { entriesPerFile = 1, preview = 'x'.repeat(200) } = {}) {
  const entryPoints = [];
  for (const file of files) {
    if (isTestFile(file)) continue;
    for (let i = 0; i < entriesPerFile; i++) {
      entryPoints.push({
        file, line: i + 1, type: 'http', description: 'Express/Koa route',
        match: `router.post('/${file}/${i}'`, snippet: `router.post('/${file}/${i}', h)`,
      });
    }
  }
  return {
    projectRoot: '/ignored',
    fileCount: files.length,
    fileTree: files,
    entryPoints,
    fileSignatures: files.map((file) => ({ file, exports: ['h'], imports: [], lines: 10, preview })),
    metadata: { 'package.json': { name: 'fixture' } },
    truncated: { fileTree: 0, entryPoints: 0, depthSkippedDirs: 0 },
  };
}

function allAreaFiles(plan) {
  return plan.areas.flatMap((area) => area.modules.flatMap((m) => m.files));
}

describe('moduleOf and isTestFile', () => {
  it('uses the directory as the module and "." for root files', () => {
    expect(moduleOf('src/orders/create.ts')).toBe('src/orders');
    expect(moduleOf('main.go')).toBe('.');
  });
  it('recognises the test-file shapes the extractor skips', () => {
    for (const path of ['a/b.test.ts', 'a/b.spec.js', 'a/__tests__/c.js', 'a/x_test.go', 'a/test_x.py', 'a/x_test.py']) {
      expect(isTestFile(path), path).toBe(true);
    }
    expect(isTestFile('a/contest.ts')).toBe(false);
  });
});

describe('planAreas', () => {
  const files = [];
  for (let m = 0; m < 12; m++) {
    for (let f = 0; f < 3; f++) files.push(`svc/mod${String(m).padStart(2, '0')}/f${f}.js`);
  }
  files.push('svc/mod00/f0.test.js', 'main.js');

  it('puts every non-test source file in exactly one area (conservation)', () => {
    const plan = planAreas({ context: contextFor(files), budgetBytes: 6000 });
    const placed = allAreaFiles(plan);
    const expected = files.filter((f) => !isTestFile(f));
    expect([...placed].sort()).toEqual([...expected].sort());
    expect(new Set(placed).size).toBe(placed.length);
    expect(plan.counts.testFilesExcluded).toBe(1);
    expect(plan.counts.sourceFiles).toBe(expected.length);
    expect(plan.areas.length).toBeGreaterThan(1);
  });

  it('keeps every area within the budget unless a single file exceeds it', () => {
    const plan = planAreas({ context: contextFor(files), budgetBytes: 6000 });
    for (const area of plan.areas) {
      if (!area.overBudget) expect(area.bytes, area.areaId).toBeLessThanOrEqual(6000);
    }
    expect(plan.areas.some((a) => a.overBudget)).toBe(false);
  });

  it('splits a module larger than the budget into numbered parts', () => {
    const big = [];
    for (let f = 0; f < 20; f++) big.push(`api/handlers/h${String(f).padStart(2, '0')}.js`);
    const plan = planAreas({ context: contextFor(big, { entriesPerFile: 3 }), budgetBytes: 5000 });
    const parts = plan.areas.flatMap((a) => a.modules).filter((m) => m.path === 'api/handlers');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.map((p) => p.part.index)).toEqual(parts.map((_, i) => i + 1));
    expect(parts.every((p) => p.part.of === parts.length)).toBe(true);
    const mod = plan.modules.find((m) => m.path === 'api/handlers');
    expect(mod.areas).toEqual(parts.map((p) => p.areaId));
    expect(mod.files).toHaveLength(20);
  });

  it('marks a single file over the budget instead of cutting it', () => {
    const plan = planAreas({ context: contextFor(['a/huge.js', 'a/small.js'], { preview: 'y'.repeat(9000) }), budgetBytes: 4000 });
    expect(plan.areas.every((a) => a.overBudget)).toBe(true);
    expect(allAreaFiles(plan).sort()).toEqual(['a/huge.js', 'a/small.js']);
  });

  it('also bounds the number of entry points per area', () => {
    const plan = planAreas({ context: contextFor(files, { entriesPerFile: 4 }), budgetBytes: 1_000_000, maxEntryPoints: 30 });
    expect(plan.areas.length).toBeGreaterThan(1);
    for (const area of plan.areas) expect(area.entryPoints.length, area.areaId).toBeLessThanOrEqual(30);
    const big = [];
    for (let f = 0; f < 10; f++) big.push(`api/handlers/h${f}.js`);
    const split = planAreas({ context: contextFor(big, { entriesPerFile: 5 }), budgetBytes: 1_000_000, maxEntryPoints: 12 });
    expect(split.areas.map((a) => a.entryPoints.length)).toEqual([10, 10, 10, 10, 10]);
    const single = planAreas({ context: contextFor(['a/one.js'], { entriesPerFile: 50 }), budgetBytes: 1_000_000, maxEntryPoints: 12 });
    expect(single.areas).toHaveLength(1);
    expect(single.areas[0].overBudget).toBe(true);
  });

  it('gives the same areas for the same input', () => {
    const a = planAreas({ context: contextFor(files), budgetBytes: 6000 });
    const b = planAreas({ context: contextFor([...files].reverse()), budgetBytes: 6000 });
    expect(b.areas.map((x) => x.modules)).toEqual(a.areas.map((x) => x.modules));
  });

  it('attaches graph nodes of an area\'s files and counts the ones it cannot place', () => {
    const graphNodes = [
      { id: 'function:svc/mod00/f0.js:create', type: 'function', name: 'create', filePath: 'svc/mod00/f0.js', lineRange: [1, 9], summary: 's', tags: ['t'] },
      { id: 'file:svc/mod00/f1.js', type: 'file', name: 'f1.js', filePath: './svc/mod00/f1.js', summary: 's' },
      { id: 'file:../outside.js', type: 'file', name: 'outside.js', filePath: '../outside.js', summary: 's' },
      { id: 'file:/etc/passwd', type: 'file', name: 'passwd', filePath: '/etc/passwd', summary: 's' },
      { id: 'config:package.json', type: 'config', name: 'package.json', filePath: 'package.json', summary: 's' },
      { id: 'concept:orders', type: 'concept', name: 'orders', summary: 's' },
    ];
    const plan = planAreas({ context: contextFor(files), budgetBytes: 6000, graphNodes });
    const attached = plan.areas.flatMap((a) => a.graphNodes);
    expect(attached.map((n) => n.id).sort()).toEqual(['config:package.json', 'file:svc/mod00/f1.js', 'function:svc/mod00/f0.js:create']);
    expect(attached.find((n) => n.id === 'file:svc/mod00/f1.js').filePath).toBe('svc/mod00/f1.js');
    expect(plan.counts.graphNodesOutsideRoot).toBe(2);
    expect(plan.counts.graphNodesWithoutFile).toBe(1);
    // package.json is not in the extractor's file list but is a file of the
    // project: its node is placed, in module '.'.
    expect(plan.counts.graphNodesAttached).toBe(3);
  });

  it('places graph nodes on files the extractor does not list, so their modules reach an analyzer and the report', () => {
    const graphNodes = [
      { id: 'file:web/src/App.vue', type: 'file', name: 'App.vue', filePath: 'web/src/App.vue', summary: 's' },
      { id: 'file:bin/tool.kts', type: 'file', name: 'tool.kts', filePath: 'bin/tool.kts', summary: 's' },
      { id: 'file:package.json', type: 'config', name: 'package.json', filePath: 'package.json', summary: 's' },
      { id: 'file:svc/mod00/f0.test.js', type: 'file', name: 'f0.test.js', filePath: 'svc/mod00/f0.test.js', summary: 's' },
    ];
    const plan = planAreas({ context: contextFor(files), budgetBytes: 6000, graphNodes });
    const attached = plan.areas.flatMap((a) => a.graphNodes).map((n) => n.id).sort();
    expect(attached).toEqual(['file:bin/tool.kts', 'file:package.json', 'file:web/src/App.vue']);
    const modules = plan.modules.map((m) => m.path);
    expect(modules).toEqual(expect.arrayContaining(['.', 'bin', 'web/src']));
    expect(allAreaFiles(plan)).toEqual(expect.arrayContaining(['bin/tool.kts', 'package.json', 'web/src/App.vue']));
    expect(plan.counts.graphOnlyFiles).toBe(3);
    expect(plan.counts.graphNodesOnTestFiles).toBe(1);
    expect(plan.counts).not.toHaveProperty('graphNodesOutsideModules');
  });

  it('counts context files that resolve outside the project root and places none of them', () => {
    const plan = planAreas({ context: contextFor(['ok/a.js', '../escape/b.js', '/abs/c.js']), budgetBytes: 6000 });
    expect(allAreaFiles(plan)).toEqual(['ok/a.js']);
    expect(plan.counts.contextFilesOutsideRoot).toBe(2);
  });
});

describe('split-domain-areas.mjs CLI', () => {
  function project() {
    const root = tempRoot();
    const files = ['svc/a/x.js', 'svc/a/y.js', 'svc/b/z.js', 'web/pages/p.jsx'];
    mkdirSync(join(root, '.excavator/intermediate'), { recursive: true });
    writeFileSync(join(root, '.excavator/intermediate/domain-context.json'), JSON.stringify(contextFor(files)));
    return root;
  }

  function run(root, extra = []) {
    const result = spawnSync(process.execPath, [SPLIT, root, '--budget-bytes', '3000', ...extra], { encoding: 'utf-8' });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(readFileSync(join(root, '.excavator/intermediate/domain-areas/manifest.json'), 'utf-8'));
  }

  it('removes an earlier run\'s area outputs and domain-analysis.json before writing', () => {
    const root = project();
    const areasDir = join(root, '.excavator/intermediate/domain-areas');
    mkdirSync(areasDir, { recursive: true });
    writeFileSync(join(areasDir, 'area-001.analysis.json'), '{"old":true}');
    writeFileSync(join(areasDir, 'area-099.analysis.json'), '{"old":true}');
    writeFileSync(join(root, '.excavator/intermediate/domain-analysis.json'), '{"old":true}');
    run(root);
    expect(existsSync(join(areasDir, 'area-001.analysis.json'))).toBe(false);
    expect(existsSync(join(areasDir, 'area-099.analysis.json'))).toBe(false);
    expect(existsSync(join(root, '.excavator/intermediate/domain-analysis.json'))).toBe(false);
  });

  it('writes a fresh token into the manifest and every area context, different on each run', () => {
    const root = project();
    const first = run(root);
    expect(first.token).toMatch(/^[0-9a-f]{32}$/);
    for (const area of first.areas) {
      const context = JSON.parse(readFileSync(area.contextFile, 'utf-8'));
      expect(context.areaRun).toEqual({ areaId: area.areaId, token: first.token });
      expect(context.output).toBe(area.outputFile);
      // No index of the other areas: it grew with the project, and an area's
      // context must not.
      expect(context).not.toHaveProperty('otherAreas');
    }
    const second = run(root);
    expect(second.token).not.toBe(first.token);
    expect(second.areas.map((a) => a.modules)).toEqual(first.areas.map((a) => a.modules));
  });

  it('attaches knowledge-graph nodes only when --graph is given', () => {
    const root = project();
    const graphPath = join(root, '.excavator/knowledge-graph.jsonl');
    writeKnowledgeGraph(graphPath, {
      version: '1.0.0', project: { name: 'fixture' },
      nodes: [{ id: 'file:svc/a/x.js', type: 'file', name: 'x.js', filePath: 'svc/a/x.js', summary: 'x', tags: ['t'], complexity: 'simple' }],
      edges: [], layers: [], tour: [],
    });
    const without = run(root);
    expect(without.graph).toBe(false);
    const withGraph = run(root, ['--graph', graphPath]);
    expect(withGraph.graph).toBe(true);
    expect(withGraph.counts.graphNodesAttached).toBe(1);
  });
});

describe('unrecognised files and entry-point sources', () => {
  const unrecognisedContext = () => {
    const context = contextFor(['svc/a/x.js', 'svc/a/y.js', 'svc/b/z.py', 'web/p.js'], { entriesPerFile: 0 });
    context.entryPoints = [
      { file: 'svc/a/x.js', line: 1, type: 'http', description: 'express route', source: 'script', method: 'GET', path: '/x' },
      { file: 'svc/a/x.js', line: 2, type: 'cli', description: 'CLI command', source: 'pattern' },
      { file: 'svc/a/y.js', line: 1, type: 'event', description: 'Event listener', source: 'pattern' },
    ];
    context.unrecognisedFiles = [
      { file: 'svc/b/z.py', lines: [3], matches: ['Decorator route (Flask/FastAPI/NestJS)'] },
      { file: 'svc/b/gone.py', lines: [1], matches: ['x'] },
      { file: 'svc/a/y.js', lines: [9], matches: ['Express/Koa route'] },
    ];
    return context;
  };

  it('carries unrecognised files into the file material, area contexts and module counts', () => {
    const plan = planAreas({ context: unrecognisedContext(), budgetBytes: 1_000_000 });
    expect(plan.areas).toHaveLength(1);
    expect(plan.areas[0].unrecognisedFiles.map((u) => u.file)).toEqual(['svc/a/y.js', 'svc/b/z.py']);
    expect(plan.areas[0].entryPoints.map((e) => e.source)).toEqual(['script', 'pattern', 'pattern']);
    const row = (path) => plan.modules.find((m) => m.path === path);
    expect(row('svc/a')).toMatchObject({ entryPoints: 3, scriptEntryPoints: 1, patternEntryPoints: 2, unrecognisedFiles: 1 });
    expect(row('svc/b')).toMatchObject({ entryPoints: 0, scriptEntryPoints: 0, patternEntryPoints: 0, unrecognisedFiles: 1, candidateFiles: ['svc/b/z.py'] });
    expect(row('svc/a').candidateFiles).toEqual(['svc/a/x.js', 'svc/a/y.js']);
    expect(plan.counts).toMatchObject({ unrecognisedFiles: 2, unrecognisedFilesOutsideModules: 1 });
  });

  it('does not count unrecognised files toward the entry-point budget', () => {
    const context = contextFor(['a/one.js', 'b/two.js'], { entriesPerFile: 0 });
    context.unrecognisedFiles = [
      { file: 'a/one.js', lines: [1], matches: ['x'] },
      { file: 'b/two.js', lines: [1], matches: ['x'] },
    ];
    const plan = planAreas({ context, budgetBytes: 1_000_000, maxEntryPoints: 1 });
    expect(plan.areas).toHaveLength(1);
    expect(plan.areas[0].overBudget).toBe(false);
  });

  it('writes unrecognisedFiles into each area context, only for that area, and prints unrecognised=<n>', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.excavator/intermediate'), { recursive: true });
    writeFileSync(join(root, '.excavator/intermediate/domain-context.json'), JSON.stringify(unrecognisedContext()));
    const result = spawnSync(process.execPath, [SPLIT, root, '--budget-bytes', '1000', '--max-entry-points', '40'], { encoding: 'utf-8' });
    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(root, '.excavator/intermediate/domain-areas/manifest.json'), 'utf-8'));
    expect(manifest.areas.length).toBeGreaterThan(1);
    for (const area of manifest.areas) {
      const context = JSON.parse(readFileSync(area.contextFile, 'utf-8'));
      const files = new Set(area.modules.flatMap((m) => m.files));
      expect(context.unrecognisedFiles.every((u) => files.has(u.file))).toBe(true);
      expect(area.unrecognisedFiles).toBe(context.unrecognisedFiles.length);
      expect(result.stdout).toContain(`${area.areaId} modules=${area.modules.length} files=${area.files} entryPoints=${area.entryPoints} unrecognised=${area.unrecognisedFiles} `);
    }
    expect(manifest.areas.reduce((n, a) => n + a.unrecognisedFiles, 0)).toBe(2);
    expect(manifest.modules.find((m) => m.path === 'svc/b')).toMatchObject({ unrecognisedFiles: 1 });
  });
});


describe('script entry points no module holds', () => {
  it('lists their ids for the merge and keeps the count', () => {
    const context = contextFor(['a/routes.js']);
    context.entryPoints = [
      { file: 'a/routes.js', line: 1, type: 'http', source: 'script', id: 'ep:http.get-a', group: 'ep:http.get-a' },
      { file: 'gone/routes.js', line: 1, type: 'http', source: 'script', id: 'ep:http.get-gone', group: 'ep:http.get-gone' },
      { file: 'gone/jobs.js', line: 1, type: 'cron', source: 'pattern' },
    ];
    const plan = planAreas({ context });
    expect(plan.entryPointsOutsideModules).toEqual(['ep:http.get-gone']);
    expect(plan.counts.entryPointsOutsideModules).toBe(2);
    expect(plan.areas[0].entryPoints.map((e) => e.id)).toEqual(['ep:http.get-a']);
  });
});
