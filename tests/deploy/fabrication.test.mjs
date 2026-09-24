import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkFabrication, runValidateGraphScript, runIndependentValidation, PIPELINE_VERSION,
} from '../../deploy/run-excavator.mjs';

const repoRoot = process.cwd();
const cleanup = [];
afterEach(() => { while (cleanup.length) cleanup.pop()(); });

function mkTmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------
// Pure checkFabrication: five visible outcomes (task 2.4).
// ---------------------------------------------------------------------------

describe('checkFabrication (pure, design D4 "独立复核", task 2.4)', () => {
  const cleanGraph = { project: { verification: 'verified' }, nodes: [{ verification: 'verified' }], edges: [] };
  const cleanReport = { issues: [] };

  it('all clean: zero contradicted, zero issues, not skipped', () => {
    const result = checkFabrication({ validationReport: cleanReport, validatedGraph: cleanGraph, maxContradicted: 0 });
    expect(result).toMatchObject({ integrityOk: true, fabricationOk: true, contradictedCount: 0, verificationSkipped: false });
  });

  it('a contradicted node pushes contradictedCount over the default threshold', () => {
    const graph = { project: { verification: 'verified' }, nodes: [{ verification: 'contradicted' }], edges: [] };
    const result = checkFabrication({ validationReport: cleanReport, validatedGraph: graph, maxContradicted: 0 });
    expect(result.integrityOk).toBe(true);
    expect(result.fabricationOk).toBe(false);
    expect(result.contradictedCount).toBe(1);
  });

  it('a contradicted edge counts the same way as a contradicted node', () => {
    const graph = { project: { verification: 'verified' }, nodes: [], edges: [{ verification: 'contradicted' }] };
    const result = checkFabrication({ validationReport: cleanReport, validatedGraph: graph, maxContradicted: 0 });
    expect(result.fabricationOk).toBe(false);
    expect(result.contradictedCount).toBe(1);
  });

  it('project.verification === "skipped" is fabrication, never zero-fabrication', () => {
    const graph = { project: { verification: 'skipped' }, nodes: [{ verification: 'verified' }], edges: [] };
    const result = checkFabrication({ validationReport: cleanReport, validatedGraph: graph, maxContradicted: 0 });
    expect(result.verificationSkipped).toBe(true);
    expect(result.fabricationOk).toBe(false);
    expect(result.integrityOk).toBe(true); // skip is a fabrication-stage failure, not a structural one
  });

  it('non-empty issues is a structural-integrity failure, independent of contradicted count', () => {
    const report = { issues: ['Node[0] missing id'] };
    const result = checkFabrication({ validationReport: report, validatedGraph: cleanGraph, maxContradicted: 0 });
    expect(result.integrityOk).toBe(false);
    expect(result.issuesCount).toBe(1);
  });

  it('a positive maxContradicted threshold tolerates that many contradicted items', () => {
    const graph = { project: { verification: 'verified' }, nodes: [{ verification: 'contradicted' }], edges: [] };
    const result = checkFabrication({ validationReport: cleanReport, validatedGraph: graph, maxContradicted: 1 });
    expect(result.fabricationOk).toBe(true);
  });

  it('counts unverified nodes/edges separately from contradicted ones', () => {
    const graph = {
      project: { verification: 'verified' },
      nodes: [{ verification: 'unverified' }, { verification: 'verified' }],
      edges: [{ verification: 'unverified' }],
    };
    const result = checkFabrication({ validationReport: cleanReport, validatedGraph: graph, maxContradicted: 0 });
    expect(result.unverifiedCount).toBe(2);
    expect(result.contradictedCount).toBe(0);
    expect(result.fabricationOk).toBe(true);
  });

  it('the clean case carries an empty reasons array', () => {
    const result = checkFabrication({ validationReport: cleanReport, validatedGraph: cleanGraph, maxContradicted: 0 });
    expect(result.reasons).toEqual([]);
  });

  // No fourth state: a missing/unreadable validation report or validated
  // graph must fail visibly, never be read as "zero issues"/"zero
  // contradicted" just because there was nothing to check.
  it('a null validation report fails integrity with a reason, not zero issues', () => {
    const result = checkFabrication({ validationReport: null, validatedGraph: cleanGraph, maxContradicted: 0 });
    expect(result.integrityOk).toBe(false);
    expect(result.issuesCount).toBeNull();
    expect(result.reasons.some((r) => r.includes('validation report') && r.includes('missing'))).toBe(true);
  });

  it('a validation report with no issues array fails integrity the same way', () => {
    const result = checkFabrication({ validationReport: {}, validatedGraph: cleanGraph, maxContradicted: 0 });
    expect(result.integrityOk).toBe(false);
    expect(result.reasons.some((r) => r.includes('validation report'))).toBe(true);
  });

  it('a null validated graph fails fabrication with a reason, not zero contradicted', () => {
    const result = checkFabrication({ validationReport: cleanReport, validatedGraph: null, maxContradicted: 0 });
    expect(result.fabricationOk).toBe(false);
    expect(result.contradictedCount).toBeNull();
    expect(result.unverifiedCount).toBeNull();
    expect(result.reasons.some((r) => r.includes('validated graph') && r.includes('missing'))).toBe(true);
  });

  it('a validated graph with no nodes array fails fabrication the same way', () => {
    const result = checkFabrication({ validationReport: cleanReport, validatedGraph: { edges: [] }, maxContradicted: 0 });
    expect(result.fabricationOk).toBe(false);
    expect(result.reasons.some((r) => r.includes('validated graph'))).toBe(true);
  });

  it('a scriptFailure short-circuits to both stages failed, with status and stderr in the reason', () => {
    const result = checkFabrication({
      validationReport: cleanReport, validatedGraph: cleanGraph, maxContradicted: 0,
      scriptFailure: { status: 1, stderrTail: 'boom: graph not found' },
    });
    expect(result.integrityOk).toBe(false);
    expect(result.fabricationOk).toBe(false);
    expect(result.reasons.some((r) => r.includes('status 1') && r.includes('boom: graph not found'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runIndependentValidation (fix for the acceptor's silent-pass review, task
// 2.4): must delete any stale validation.json/validated-graph.json from a
// reused /work/out BEFORE invoking validate-graph.mjs, and must surface a
// non-zero validate-graph exit as a scriptFailure rather than silently
// reading whatever happens to be on disk.
// ---------------------------------------------------------------------------

describe('runIndependentValidation (task 2.4, no stale-report fourth state)', () => {
  it('deletes a stale validation.json/validated-graph.json before invoking the script', () => {
    const outDir = mkTmp('excavator-fab-stale-out-');
    writeFileSync(join(outDir, 'validation.json'), JSON.stringify({ issues: [], sentinel: 'STALE' }));
    writeFileSync(join(outDir, 'validated-graph.json'), JSON.stringify({ sentinel: 'STALE', nodes: [], edges: [] }));

    // The staleness check happens INSIDE the injected spawn, at the moment
    // the script would actually run — proving deletion happens before the
    // script is invoked, not just eventually.
    let reportExistedAtSpawnTime = 'unchecked';
    let graphExistedAtSpawnTime = 'unchecked';
    const spawnSyncFn = () => {
      reportExistedAtSpawnTime = existsSync(join(outDir, 'validation.json'));
      graphExistedAtSpawnTime = existsSync(join(outDir, 'validated-graph.json'));
      return { status: 1, stdout: '', stderr: 'simulated failure', error: null };
    };

    runIndependentValidation({
      pluginDir: repoRoot, repoRoot: '/does/not/matter', graphPath: '/does/not/matter/knowledge-graph.json',
      outDir, spawnSyncFn,
    });

    expect(reportExistedAtSpawnTime).toBe(false);
    expect(graphExistedAtSpawnTime).toBe(false);
  });

  it('a non-zero validate-graph exit is a scriptFailure, never silently reads a stale report', () => {
    const outDir = mkTmp('excavator-fab-stale-out2-');
    writeFileSync(join(outDir, 'validation.json'), JSON.stringify({ issues: [] }));
    writeFileSync(join(outDir, 'validated-graph.json'), JSON.stringify({ nodes: [], edges: [] }));

    const spawnSyncFn = () => ({ status: 1, stdout: '', stderr: 'validate-graph.mjs: graph not found\n', error: null });
    const result = runIndependentValidation({
      pluginDir: repoRoot, repoRoot: '/does/not/matter', graphPath: '/does/not/matter/knowledge-graph.json',
      outDir, spawnSyncFn,
    });

    expect(result.scriptFailure).toMatchObject({ status: 1 });
    expect(result.scriptFailure.stderrTail).toContain('graph not found');
    expect(result.validationReport).toBeNull();
    expect(result.validatedGraph).toBeNull();
  });

  it('a successful (status 0) run reads back the freshly-written report and graph', () => {
    const outDir = mkTmp('excavator-fab-fresh-out-');
    const spawnSyncFn = (cmd, args) => {
      // Simulate what the real script does: write outPath/reportPath, exit 0.
      const outIdx = args.indexOf('--out');
      const reportIdx = args.indexOf('--report');
      writeFileSync(args[outIdx + 1], JSON.stringify({ nodes: [], edges: [], project: {} }));
      writeFileSync(args[reportIdx + 1], JSON.stringify({ issues: [] }));
      return { status: 0, stdout: '', stderr: '', error: null };
    };
    const result = runIndependentValidation({
      pluginDir: repoRoot, repoRoot: '/does/not/matter', graphPath: '/does/not/matter/knowledge-graph.json',
      outDir, spawnSyncFn,
    });
    expect(result.scriptFailure).toBeNull();
    expect(result.validationReport).toEqual({ issues: [] });
    expect(result.validatedGraph).toEqual({ nodes: [], edges: [], project: {} });
  });
});

// ---------------------------------------------------------------------------
// Wired end-to-end: the real validate-graph.mjs, on a small synthetic
// project + graph, produces a report checkFabrication can consume, and never
// touches a single byte under .excavator/ (task 2.4's hash-invariance check).
// ---------------------------------------------------------------------------

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function hashTree(dir) {
  const hashes = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(hashes, hashTree(full));
    else hashes[full] = sha256(readFileSync(full));
  }
  return hashes;
}

describe('runValidateGraphScript wiring + .excavator/ hash invariance (task 2.4)', () => {
  it('detects a real anchor contradiction and leaves every .excavator/ file byte-identical', () => {
    const projectRoot = mkTmp('excavator-fab-');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(join(projectRoot, 'src', 'thing.js'), 'function realFunction() {\n  return 1;\n}\nmodule.exports = { realFunction };\n');

    const dataDir = join(projectRoot, '.excavator');
    mkdirSync(dataDir, { recursive: true });
    const graph = {
      project: { pipelineVersion: PIPELINE_VERSION, gitCommitHash: 'deadbeef', model: 'test-model', verification: 'verified' },
      nodes: [{
        // Anchor claims a name the source line does not contain — this is
        // exactly what validate-graph.mjs's anchor check contradicts.
        id: 'function:src/thing.js:wrongName()', type: 'function', name: 'wrongName',
        filePath: 'src/thing.js', lineRange: [1, 1], summary: 'x', tags: [],
      }],
      edges: [], layers: [], coverage: {}, gaps: [],
    };
    writeFileSync(join(dataDir, 'knowledge-graph.json'), JSON.stringify(graph, null, 2));
    writeFileSync(join(dataDir, 'meta.json'), JSON.stringify({ gitCommitHash: 'deadbeef' }, null, 2));
    writeFileSync(join(dataDir, 'fingerprints.json'), JSON.stringify({ some: 'baseline' }, null, 2));

    const beforeHashes = hashTree(dataDir);

    const outDir = mkTmp('excavator-fab-out-');
    const graphPath = join(dataDir, 'knowledge-graph.json');
    const result = runValidateGraphScript({ pluginDir: repoRoot, repoRoot: projectRoot, graphPath, outDir });
    expect(result.status).toBe(0);

    const afterHashes = hashTree(dataDir);
    expect(afterHashes).toEqual(beforeHashes);

    const report = JSON.parse(readFileSync(result.reportPath, 'utf-8'));
    const validatedGraph = JSON.parse(readFileSync(result.outPath, 'utf-8'));
    expect(report.issues).toEqual([]);
    expect(validatedGraph.nodes[0].verification).toBe('contradicted');

    const fabrication = checkFabrication({ validationReport: report, validatedGraph, maxContradicted: 0 });
    expect(fabrication.integrityOk).toBe(true);
    expect(fabrication.fabricationOk).toBe(false);
    expect(fabrication.contradictedCount).toBe(1);
  });
});
