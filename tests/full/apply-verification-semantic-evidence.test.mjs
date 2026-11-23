// A verified or contradicted verdict lands in the semantic cache only when it
// quotes a line of the node's slice other than the declaration line
// (openspec: changes/semantic-read-evidence, D4). A verifier that only
// compared the function name with the slice has no such line to give.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  applySemanticVerification,
  createSemanticEvidenceChecker,
} from '../../skills/excavator/apply-verification.mjs';
import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';

const LINES = [
  'export function run(): void {',
  "  const label = 'run the fixture';",
  '  console.log(label);',
  '}',
];
const ID = 'function:src/a.ts:run()';
const checkEvidence = createSemanticEvidenceChecker({
  anchorOf: (id) => (id === ID ? { filePath: 'src/a.ts', lineRange: [1, 4] } : null),
  readLines: (filePath) => (filePath === 'src/a.ts' ? LINES : null),
});
const cache = () => ({ version: '1.0.0', entries: { [ID]: { summary: 'Logs a fixed label.', semanticSourceHash: 'h' } } });
const body = { line: 3, quote: 'console.log(label);' };

describe('applySemanticVerification requires read evidence', () => {
  it('refuses to run without an evidence checker', () => {
    expect(() => applySemanticVerification({ semanticCache: cache(), verdicts: [] })).toThrow(/checkEvidence/);
  });

  for (const [label, evidence] of [
    ['no evidence', undefined],
    ['the declaration line', { line: 1, quote: 'export function run(): void {' }],
    ['words that are not on the line', { line: 2, quote: 'logs the label' }],
  ]) {
    it(`does not write a verified verdict citing ${label}, and leaves the entry for the next run`, () => {
      const { semanticCache, report } = applySemanticVerification({
        semanticCache: cache(), batchIds: [ID], checkEvidence,
        verdicts: [{ id: ID, verdict: 'verified', reason: 'name matches', ...(evidence ? { evidence } : {}) }],
      });
      expect(semanticCache.entries[ID].verification).toBeUndefined();
      expect(report.counts).toMatchObject({ verdictNoEvidence: 1, verdictsApplied: 0, verified: 0 });
      expect(report.gaps.find((g) => g.kind === 'semantic-summary-verdict-no-evidence'))
        .toMatchObject({ count: 1, samples: [ID] });
    });
  }

  it('writes a verified verdict that quotes a body line', () => {
    const { semanticCache, report } = applySemanticVerification({
      semanticCache: cache(), batchIds: [ID], checkEvidence,
      verdicts: [{ id: ID, verdict: 'verified', reason: 'logs label', evidence: body }],
    });
    expect(semanticCache.entries[ID].verification).toBe('verified');
    expect(report.counts.verdictNoEvidence).toBe(0);
  });

  it('writes and archives a contradicted verdict that quotes a body line', () => {
    const { semanticCache, archive } = applySemanticVerification({
      semanticCache: cache(), batchIds: [ID], checkEvidence,
      verdicts: [{ id: ID, verdict: 'contradicted', reason: 'logs, does not save', evidence: body }],
    });
    expect(semanticCache.entries[ID].verification).toBe('contradicted');
    expect(archive).toEqual([{ id: ID, summary: 'Logs a fixed label.', reason: 'logs, does not save' }]);
  });

  it('does not write a contradicted verdict without evidence', () => {
    const { semanticCache, archive } = applySemanticVerification({
      semanticCache: cache(), batchIds: [ID], checkEvidence,
      verdicts: [{ id: ID, verdict: 'contradicted', reason: 'feels off' }],
    });
    expect(semanticCache.entries[ID].verification).toBeUndefined();
    expect(archive).toEqual([]);
  });

  it('writes an unverified verdict without evidence', () => {
    const { semanticCache } = applySemanticVerification({
      semanticCache: cache(), batchIds: [ID], checkEvidence,
      verdicts: [{ id: ID, verdict: 'unverified', reason: 'file missing' }],
    });
    expect(semanticCache.entries[ID].verification).toBe('unverified');
  });

  it('at the close, marks a verdict without evidence unverified and counts it apart from missing ones', () => {
    const { semanticCache, report } = applySemanticVerification({
      semanticCache: cache(), manifest: { selectedIds: [ID], batches: [{ batchIndex: 0 }] }, checkEvidence,
      verdicts: [{ id: ID, verdict: 'verified', reason: 'name matches' }],
    });
    expect(semanticCache.entries[ID].verification).toBe('unverified');
    expect(report.counts).toMatchObject({ verdictNoEvidence: 1, verdictMissing: 0, unverified: 1 });
    expect(report.conserves).toBe(true);
  });

  it('refuses evidence for a node with no anchor or an unreadable file', () => {
    const none = createSemanticEvidenceChecker({ anchorOf: () => null, readLines: () => LINES });
    expect(none({ id: ID, verdict: 'verified', evidence: body })).toMatchObject({ ok: false });
    const unreadable = createSemanticEvidenceChecker({
      anchorOf: () => ({ filePath: 'src/a.ts', lineRange: [1, 4] }), readLines: () => null,
    });
    expect(unreadable({ id: ID, verdict: 'verified', evidence: body })).toEqual({ ok: false, status: 'evidence-source-unreadable' });
  });
});

describe('apply-verification.mjs apply-semantic checks the evidence against the source', () => {
  const SCRIPT = resolve(import.meta.dirname, '../../skills/excavator/apply-verification.mjs');
  let root;
  let inter;
  let runId;
  const run = (...args) => execFileSync(process.execPath, [SCRIPT, root, ...args], { stdio: 'pipe' });
  const entry = () => JSON.parse(readFileSync(join(root, '.excavator', 'semantic-cache.json'), 'utf-8')).entries[runId];
  const verdicts = (list) => writeFileSync(join(inter, 'summary-verdicts-0.json'), JSON.stringify({ verdicts: list }));

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'apply-verification-evidence-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), `${LINES.join('\n')}\n`);
    await runLazyAnalysis({ projectRoot: root, now: () => '2024-01-01T00:00:00.000Z' });
    const graph = readKnowledgeGraph(join(root, '.excavator', 'knowledge-graph.jsonl'));
    runId = graph.nodes.find((n) => n.name === 'run').id;
    inter = join(root, '.excavator', 'intermediate');
    writeFileSync(join(root, '.excavator', 'semantic-cache.json'), JSON.stringify({
      version: '1.0.0', contentLanguage: 'en',
      entries: { [runId]: { summary: 'Logs a fixed label.', displayName: 'Log the label', tags: [], semanticSourceHash: 'h' } },
    }));
    run('prepare-semantic');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('leaves the entry unmarked for a verdict citing the declaration line, then writes one citing the body', () => {
    verdicts([{ id: runId, verdict: 'verified', reason: 'r', evidence: { line: 1, quote: 'export function run(): void {' } }]);
    run('apply-semantic', '--batch', '0');
    expect(entry().verification).toBeUndefined();
    verdicts([{ id: runId, verdict: 'verified', reason: 'r', evidence: { line: 3, quote: 'console.log(label);' } }]);
    run('apply-semantic', '--batch', '0');
    expect(entry().verification).toBe('verified');
  });

  it('closes a verdict without evidence as unverified', () => {
    verdicts([{ id: runId, verdict: 'verified', reason: 'r' }]);
    run('apply-semantic');
    expect(entry().verification).toBe('unverified');
    const report = JSON.parse(readFileSync(join(inter, 'semantic-verification.json'), 'utf-8'));
    expect(report.counts.verdictNoEvidence).toBe(1);
  });
});
