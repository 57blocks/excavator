// Slice A / Task 3 — Lazy first-run driver (openspec: changes/lazy-first-run,
// capability `lazy-analysis`).
//
// This is an e2e-ish test: it runs the REAL bundled scripts (scan-project.mjs,
// structure-all.mjs, extract-import-map.mjs) as child processes against a
// tiny purpose-built synthetic project in a tmp directory, and calls the
// real `buildFactGraph` in-process, exactly as the driver does in
// production. Nothing here is a real project's source — see AGENTS.md's
// "purpose-built synthetic projects only" rule.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { runLazyAnalysis, defaultRunScript } from '../../skills/excavator/lazy-analyze.mjs';

/** A fixed clock so two runs over an unchanged project are byte-identical
 *  (real wall-clock time would otherwise make `project.analyzedAt` differ
 *  between runs, which is expected/correct in production but would make the
 *  determinism assertion below meaningless). */
const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

/** A tiny two-file TypeScript project: `a.ts` imports and calls `b.ts`'s
 *  `helper()`. Small enough to keep the test fast; real enough that
 *  structure-all/tree-sitter produce genuine declarations, an import edge,
 *  and a uniquely-resolvable call edge. */
function makeFixtureProject() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-lazy-fixture-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'lazy-fixture', description: 'tiny lazy fixture' }, null, 2),
  );
  mkdirSync(join(root, 'src'));
  writeFileSync(
    join(root, 'src', 'a.ts'),
    "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n}\n",
  );
  writeFileSync(
    join(root, 'src', 'b.ts'),
    "export function helper(): void {\n  console.log('hi');\n}\n",
  );
  return root;
}

describe('lazy-analyze driver — first-run pipeline', () => {
  let root;
  beforeEach(() => {
    root = makeFixtureProject();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes a fact-only knowledge graph: empty summaries/tags, coverage/gaps/factsDigest present', async () => {
    const result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(result.saveError).toBeNull();
    expect(result.metaAdvanced).toBe(true);
    expect(result.validation.ok).toBe(true);

    const graph = JSON.parse(readFileSync(join(root, '.excavator', 'knowledge-graph.json'), 'utf-8'));
    expect(graph.nodes.length).toBeGreaterThan(0);
    for (const node of graph.nodes) {
      expect(node.summary).toBe('');
      expect(node.tags).toEqual([]);
    }
    expect(graph.layers).toEqual([]);
    expect(graph.tour).toEqual([]);
    expect(graph.coverage).toBeDefined();
    expect(Array.isArray(graph.gaps)).toBe(true);
    expect(typeof graph.project.factsDigest).toBe('string');
    expect(graph.project.factsDigest.length).toBeGreaterThan(0);
    expect(graph.project.sourceDigest).toBeTruthy();

    // A real structural fact made it all the way through: a.ts's `run`
    // uniquely resolves its call to b.ts's `helper`.
    const runNode = graph.nodes.find((n) => n.type === 'function' && n.name === 'run');
    const helperNode = graph.nodes.find((n) => n.type === 'function' && n.name === 'helper');
    expect(runNode).toBeDefined();
    expect(helperNode).toBeDefined();
    expect(
      graph.edges.some((e) => e.type === 'calls' && e.source === runNode.id && e.target === helperNode.id),
    ).toBe(true);

    expect(existsSync(join(root, '.excavator', 'meta.json'))).toBe(true);
    expect(existsSync(join(root, '.excavator', 'fingerprints.json'))).toBe(true);
  });

  it('is deterministic: a second run over an unchanged project is byte-identical', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const first = readFileSync(join(root, '.excavator', 'knowledge-graph.json'), 'utf-8');

    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const second = readFileSync(join(root, '.excavator', 'knowledge-graph.json'), 'utf-8');

    expect(second).toBe(first);
  });

  it('save-failure gate: a failed fingerprints step does not advance meta.json', async () => {
    const failingRunScript = (scriptName, args) => {
      if (scriptName === 'build-fingerprints.mjs') {
        return { status: 1, stdout: '', stderr: 'simulated fingerprints failure' };
      }
      return defaultRunScript(scriptName, args);
    };

    const result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW, runScript: failingRunScript });

    expect(result.metaAdvanced).toBe(false);
    expect(result.saveError).toMatch(/build-fingerprints/);
    // The graph write is unconditional (matches Phase 7 step 1); only the
    // fingerprints-gated meta.json write is withheld.
    expect(existsSync(join(root, '.excavator', 'knowledge-graph.json'))).toBe(true);
    expect(existsSync(join(root, '.excavator', 'meta.json'))).toBe(false);
  });

  it('does not wipe or downgrade an existing full graph\'s summaries/tags/layers', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const graphPath = join(root, '.excavator', 'knowledge-graph.json');
    const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));

    // Simulate a prior Full run's model-authored semantics on one node, plus
    // an architecture layer grouping (Lazy never produces either).
    const target = graph.nodes.find((n) => n.type === 'function' && n.name === 'run');
    target.summary = 'Runs the fixture entry point.';
    target.tags = ['entrypoint'];
    graph.layers = [{ id: 'layer:app', name: 'App', description: 'application code', nodeIds: [target.id] }];
    writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf-8');

    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });

    const after = JSON.parse(readFileSync(graphPath, 'utf-8'));
    const afterTarget = after.nodes.find((n) => n.id === target.id);
    expect(afterTarget.summary).toBe('Runs the fixture entry point.');
    expect(afterTarget.tags).toEqual(['entrypoint']);
    expect(after.layers).toEqual(graph.layers);
  });

  it('re-run over a GIT target with an existing .excavator is byte-identical (data dir dropped from scan)', async () => {
    // A real-repo-only defect the plain (non-git) fixture cannot catch: on a
    // git target, scan-project consults the working tree and, on the second
    // run, sees the first run's own `.excavator/*.json`. Ignored files are not
    // parsed, but they were still COUNTED in the coverage ledger — so
    // coverage.files grew (41 -> 51 on go-clean-arch) and factsDigest shifted
    // every re-run, though nodes/edges/gaps were unchanged. The driver now
    // passes --exclude-analysis-data so `.excavator/` is dropped before
    // coverage, keeping re-runs byte-identical (plan §3.3: always excluded).
    const git = (args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, stdio: 'ignore' });
    git(['init', '-q']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'fixture']);

    const first = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const second = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });

    expect(second.factsDigest).toBe(first.factsDigest);
    // The tell-tale of the bug: the second run must not count its own data dir.
    expect(second.coverage.files).toBe(first.coverage.files);
  });

  it('never dispatches a model/subagent — structural check on the driver code (comments excluded)', () => {
    const raw = readFileSync(new URL('../../skills/excavator/lazy-analyze.mjs', import.meta.url), 'utf-8');
    // The module doc deliberately NAMES every subagent it does NOT invoke, to
    // explain why (see the file's header comment). Strip comments before
    // scanning so this check is about actual code, not its own explanatory
    // prose quoting the forbidden names.
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const forbiddenTokens = [
      'excavator-file-analyzer',
      'excavator-project-scanner',
      'excavator-summary-verifier',
      'excavator-assemble-reviewer',
      'excavator-architecture-analyzer',
      'excavator-graph-reviewer',
      'dispatch a subagent',
      'Task(',
    ];
    for (const token of forbiddenTokens) {
      expect(codeOnly.includes(token)).toBe(false);
    }
  });
});

describe('validateFactGraphIntegrity — pure, no I/O', () => {
  it('flags a dangling edge endpoint and a duplicate node id, passes a clean projection', async () => {
    const { validateFactGraphIntegrity } = await import('../../skills/excavator/lazy-analyze.mjs');

    const clean = validateFactGraphIntegrity({
      nodes: [{ id: 'file:a.ts' }, { id: 'function:a.ts:run()' }],
      edges: [{ source: 'file:a.ts', target: 'function:a.ts:run()', type: 'contains' }],
      coverage: { byLanguage: {} },
    });
    expect(clean.ok).toBe(true);
    expect(clean.issues).toEqual([]);

    const dangling = validateFactGraphIntegrity({
      nodes: [{ id: 'file:a.ts' }],
      edges: [{ source: 'file:a.ts', target: 'function:missing', type: 'contains' }],
      coverage: { byLanguage: {} },
    });
    expect(dangling.ok).toBe(false);
    expect(dangling.issues.some((i) => i.includes('function:missing'))).toBe(true);

    const duplicate = validateFactGraphIntegrity({
      nodes: [{ id: 'file:a.ts' }, { id: 'file:a.ts' }],
      edges: [],
      coverage: { byLanguage: {} },
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.issues.some((i) => i.includes('duplicate node id'))).toBe(true);
  });
});
