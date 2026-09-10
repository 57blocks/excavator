/**
 * validate-graph.mjs — the source-touching checks of phase 6b.
 *
 * The first test in this file is the merge gate: the validator has to prove it
 * SEES a known-bad anchor and a known-bad evidence line before its zeros on a
 * clean graph mean anything. A validator that cannot go red is not a
 * validator.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  validateAgainstSource, createSourceReader, resolveWithinRoot, findToken, findTokenInImportStatement,
  endsImportStatement, expectedTokens, isAnonymousName,
  ANCHOR_TOLERANCE, IMPORT_WINDOW_LINES,
} from '../../../skills/excavator/validate-graph.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALIDATE = resolve(__dirname, '../../../skills/excavator/validate-graph.mjs');

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

/**
 * The fixture project. Line numbers matter, so they are written out
 * explicitly rather than generated.
 *
 * src/app.ts
 *   1 import { helper } from './helper';
 *   2
 *   3 export function run() {
 *   4   return helper();
 *   5 }
 *   6
 *   7 export class Runner {
 *   8   start() {
 *   9     return run();
 *  10   }
 *  11 }
 */
const SOURCES = {
  'src/app.ts': [
    "import { helper } from './helper';",
    '',
    'export function run() {',
    '  return helper();',
    '}',
    '',
    'export class Runner {',
    '  start() {',
    '    return run();',
    '  }',
    '}',
    '',
  ].join('\n'),
  // A multi-line ES import: tree-sitter reports the statement as starting on
  // line 1, but the specifier is on line 5.
  'src/multiline.ts': [
    'import {',
    '  helper,',
    '  other,',
    '  third',
    "} from './helper';",
    '',
    'export function useThem() {',
    '  return helper();',
    '}',
    '',
  ].join('\n'),
  // The control: same multi-line shape, but the statement never names
  // `helper`. `helper` DOES appear after the statement ends, so this file also
  // proves the scan stops at the statement instead of running on.
  'src/decoy.ts': [
    'import {',
    '  unrelated,',
    '  alsoUnrelated',
    "} from './something-else';",
    '',
    'export const decoy = () => helper();',
    '',
  ].join('\n'),
  'src/helper.ts': [
    'export function helper() {',
    '  return 1;',
    '}',
    '',
  ].join('\n'),
};

function fixtureProject() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-validate-'));
  tempDirs.push(root);
  for (const [rel, contents] of Object.entries(SOURCES)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return root;
}

/** A clean, fully attributed graph over the fixture project. */
function cleanGraph() {
  return {
    version: '1.0.0',
    project: {
      name: 'fixture', languages: ['typescript'], frameworks: [],
      description: '', analyzedAt: '2026-09-11T00:00:00.000Z', gitCommitHash: null,
    },
    nodes: [
      { id: 'file:src/app.ts', type: 'file', name: 'app.ts', filePath: 'src/app.ts', summary: 'Entry', tags: ['entry'], complexity: 'simple' },
      { id: 'file:src/helper.ts', type: 'file', name: 'helper.ts', filePath: 'src/helper.ts', summary: 'Helper', tags: ['util'], complexity: 'simple' },
      { id: 'function:src/app.ts:run', type: 'function', name: 'run', filePath: 'src/app.ts', lineRange: [3, 5], summary: 'Runs', tags: [], complexity: 'simple' },
      { id: 'class:src/app.ts:Runner', type: 'class', name: 'Runner', filePath: 'src/app.ts', lineRange: [7, 11], summary: 'Runner', tags: [], complexity: 'simple' },
      { id: 'function:src/helper.ts:helper', type: 'function', name: 'helper', filePath: 'src/helper.ts', lineRange: [1, 3], summary: 'Helps', tags: [], complexity: 'simple' },
    ],
    edges: [
      {
        source: 'file:src/app.ts', target: 'file:src/helper.ts', type: 'imports', direction: 'forward', weight: 0.7,
        provenance: 'extracted', evidence: [{ file: 'src/app.ts', line: 1, source: 'import-map' }],
      },
      {
        source: 'file:src/app.ts', target: 'function:src/app.ts:run', type: 'contains', direction: 'forward', weight: 1,
        provenance: 'extracted', evidence: [{ file: 'src/app.ts', line: 3, source: 'tree-sitter' }],
      },
      {
        source: 'file:src/app.ts', target: 'function:src/app.ts:run', type: 'exports', direction: 'forward', weight: 0.8,
        provenance: 'extracted', evidence: [{ file: 'src/app.ts', line: 3, source: 'tree-sitter' }],
      },
      {
        source: 'function:src/app.ts:run', target: 'function:src/helper.ts:helper', type: 'calls', direction: 'forward', weight: 0.8,
        provenance: 'extracted', evidence: [{ file: 'src/app.ts', line: 4, source: 'tree-sitter' }],
      },
      {
        source: 'file:src/app.ts', target: 'file:src/helper.ts', type: 'depends_on', direction: 'forward', weight: 0.6,
        provenance: 'inferred', evidence: [],
      },
    ],
    layers: [{
      id: 'l1', name: 'Core', description: 'Core',
      nodeIds: ['file:src/app.ts', 'file:src/helper.ts', 'function:src/app.ts:run', 'class:src/app.ts:Runner', 'function:src/helper.ts:helper'],
    }],
    tour: [{ order: 1, title: 'Start', description: 'here', nodeIds: ['file:src/app.ts'] }],
  };
}

function validate(root, graph, sampleLimit = 5) {
  return validateAgainstSource({ graph, reader: createSourceReader(root), sampleLimit });
}

describe('validate-graph — the instrument sees known-bad samples (merge gate)', () => {
  it('reports exactly one edge-contradicted and one anchor-mismatch for two injected faults, naming both', () => {
    const root = fixtureProject();
    const graph = cleanGraph();

    // Fault 1: a calls edge whose evidence line does not mention the callee.
    // Line 1 is the import statement; `helper` appears there, so cite line 3
    // ("export function run() {"), which does not mention helper at all.
    const call = graph.edges.find((e) => e.type === 'calls');
    call.evidence = [{ file: 'src/app.ts', line: 3, source: 'tree-sitter' }];

    // Fault 2: a node whose lineRange is shifted by five lines.
    const node = graph.nodes.find((n) => n.id === 'function:src/helper.ts:helper');
    node.lineRange = [node.lineRange[0] + 5, node.lineRange[1] + 5];

    const { validated, report } = validate(root, graph);

    expect(report.counts.edgeContradicted).toBe(1);
    expect(report.counts.anchorMismatch).toBe(1);

    // and it names them
    expect(report.findings.edgeContradicted).toHaveLength(1);
    expect(report.findings.edgeContradicted[0].edgeKey).toBe(
      'calls|function:src/app.ts:run|function:src/helper.ts:helper',
    );
    expect(report.findings.anchorMismatch).toHaveLength(1);
    expect(report.findings.anchorMismatch[0]).toMatchObject({
      nodeId: 'function:src/helper.ts:helper',
      filePath: 'src/helper.ts',
      line: 6,
      name: 'helper',
    });

    // and it marks the graph
    expect(validated.nodes.find((n) => n.id === 'function:src/helper.ts:helper').verification).toBe('contradicted');
    expect(validated.edges.find((e) => e.type === 'calls').verification).toBe('contradicted');
    const gap = (kind) => validated.gaps.find((g) => g.kind === kind);
    expect(gap('anchor-mismatch').count).toBe(1);
    expect(gap('edge-contradicted').count).toBe(1);
  });

  it('reports zero of both on the un-injected fixture graph', () => {
    const root = fixtureProject();
    const { validated, report } = validate(root, cleanGraph());

    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.edgeContradicted).toBe(0);
    expect(report.counts.anchorConfirmed).toBe(3);
    expect(report.counts.edgeConfirmed).toBe(4);
    expect(report.counts.edgesInferred).toBe(1);
    expect(report.issues).toEqual([]);
    expect(validated.gaps.filter((g) => g.kind === 'anchor-mismatch')).toEqual([]);
    expect(validated.nodes.every((n) => n.verification === undefined)).toBe(true);
  });
});

describe('validate-graph — anchors', () => {
  it('accepts an anchor one line off (the ±1 tolerance)', () => {
    const root = fixtureProject();
    const graph = cleanGraph();
    const node = graph.nodes.find((n) => n.id === 'function:src/app.ts:run');
    node.lineRange = [4, 5];
    expect(validate(root, graph).report.counts.anchorMismatch).toBe(0);
    expect(ANCHOR_TOLERANCE).toBe(1);
  });

  it('accepts an anonymous declaration when the line carries a declaration keyword', () => {
    const root = fixtureProject();
    const graph = cleanGraph();
    graph.nodes.push({
      id: 'class:src/app.ts:anon@7', type: 'class', name: 'anon@7',
      filePath: 'src/app.ts', lineRange: [7, 11], summary: '', tags: [], complexity: 'simple',
    });
    graph.layers[0].nodeIds.push('class:src/app.ts:anon@7');
    expect(validate(root, graph).report.counts.anchorMismatch).toBe(0);
    expect(isAnonymousName('anon@7')).toBe(true);
    expect(isAnonymousName('Runner')).toBe(false);
  });

  it('counts an unreadable source instead of calling the graph wrong', () => {
    const root = fixtureProject();
    const graph = cleanGraph();
    graph.nodes.push({
      id: 'function:src/gone.ts:vanished', type: 'function', name: 'vanished',
      filePath: 'src/gone.ts', lineRange: [1, 2], summary: '', tags: [], complexity: 'simple',
    });
    graph.layers[0].nodeIds.push('function:src/gone.ts:vanished');
    const { report, validated } = validate(root, graph);

    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.sourceMissing).toBe(1);
    expect(report.missingFiles).toEqual(['src/gone.ts']);
    expect(validated.gaps.find((g) => g.kind === 'source-missing').count).toBe(1);
  });
});

describe('validate-graph — evidence lines', () => {
  it('checks the token that matches the edge type', () => {
    const root = fixtureProject();
    const reader = createSourceReader(root);
    const graph = cleanGraph();
    const node = (id) => graph.nodes.find((n) => n.id === id);

    expect(expectedTokens({ type: 'calls' }, node('function:src/app.ts:run'), node('function:src/helper.ts:helper')))
      .toEqual(['helper']);
    expect(expectedTokens({ type: 'imports' }, node('file:src/app.ts'), node('file:src/helper.ts')))
      .toEqual(['helper', 'src']);
    expect(expectedTokens({ type: 'related' }, node('file:src/app.ts'), node('file:src/helper.ts'), { source: 'model' }))
      .toEqual(['app.ts', 'helper.ts', 'app.ts', 'helper.ts']);
    expect(findToken(reader, 'src/app.ts', 4, ['helper'])).toBe(4);
    expect(findToken(reader, 'src/app.ts', 4, ['Runner'])).toBeNull();
  });

  it('passes a model-cited judgement edge whose line mentions an endpoint', () => {
    const root = fixtureProject();
    const graph = cleanGraph();
    graph.edges.push({
      source: 'function:src/app.ts:run', target: 'function:src/helper.ts:helper',
      type: 'related', direction: 'bidirectional', weight: 0.5,
      provenance: 'extracted', evidence: [{ file: 'src/app.ts', line: 4, source: 'model' }],
    });
    expect(validate(root, graph).report.counts.edgeContradicted).toBe(0);
  });

  it('contradicts a model-cited judgement edge whose line mentions neither endpoint', () => {
    const root = fixtureProject();
    const graph = cleanGraph();
    graph.edges.push({
      source: 'function:src/app.ts:run', target: 'function:src/helper.ts:helper',
      type: 'related', direction: 'bidirectional', weight: 0.5,
      provenance: 'extracted', evidence: [{ file: 'src/app.ts', line: 2, source: 'model' }],
    });
    const { report } = validate(root, graph);
    expect(report.counts.edgeContradicted).toBe(1);
    expect(report.findings.edgeContradicted[0].type).toBe('related');
  });

  it('leaves inferred edges alone and counts an extracted edge with no evidence', () => {
    const root = fixtureProject();
    const graph = cleanGraph();
    graph.edges.find((e) => e.type === 'exports').evidence = [];
    const { report } = validate(root, graph);

    expect(report.counts.edgesWithoutEvidence).toBe(1);
    expect(report.counts.edgeContradicted).toBe(0);
    expect(report.counts.edgesInferred).toBe(1);
  });
});

describe('validate-graph — referential integrity and domain steps', () => {
  it('keeps the checks the inline validator makes', () => {
    const root = fixtureProject();
    const graph = cleanGraph();
    graph.nodes.push({ id: 'function:src/app.ts:run', type: 'function', name: 'run', filePath: 'src/app.ts', lineRange: [3, 5], summary: 'dup', tags: [], complexity: 'simple' });
    graph.nodes.push({ id: 'file:src/orphan.ts', type: 'file', name: 'orphan.ts', filePath: 'src/orphan.ts', summary: '', tags: [], complexity: 'simple' });
    graph.edges.push({ source: 'file:src/app.ts', target: 'file:src/nowhere.ts', type: 'imports', direction: 'forward', weight: 0.7, provenance: 'inferred', evidence: [] });
    graph.tour.push({ order: 2, title: 'Bad', description: '', nodeIds: ['file:src/nowhere.ts'] });

    const { report } = validate(root, graph);
    const joined = report.issues.join('\n');
    expect(joined).toMatch(/Duplicate node ID 'function:src\/app\.ts:run'/);
    expect(joined).toMatch(/target 'file:src\/nowhere\.ts' not found/);
    expect(joined).toMatch(/File node 'file:src\/orphan\.ts' not in any layer/);
    expect(joined).toMatch(/Tour step\[1\] refs missing node/);
    expect(report.warnings.join('\n')).toMatch(/has no edges \(orphan\)/);
  });

  it('counts a step with no resolvable nodeIds, and accepts an inferred one', () => {
    const root = fixtureProject();
    const graph = cleanGraph();
    graph.nodes.push(
      { id: 'step:submit', type: 'step', name: 'Submit', summary: '', tags: [], complexity: 'simple' },
      { id: 'step:ghost', type: 'step', name: 'Ghost', summary: '', tags: [], complexity: 'simple', nodeIds: ['function:nope'] },
      { id: 'step:honest', type: 'step', name: 'Honest', summary: '', tags: [], complexity: 'simple', provenance: 'inferred' },
      { id: 'step:anchored', type: 'step', name: 'Anchored', summary: '', tags: [], complexity: 'simple', nodeIds: ['function:src/app.ts:run'] },
    );
    const { report, validated } = validate(root, graph);

    expect(report.counts.stepUnanchored).toBe(2);
    expect(report.findings.stepUnanchored.map((f) => f.nodeId).sort()).toEqual(['step:ghost', 'step:submit']);
    expect(validated.gaps.find((g) => g.kind === 'step-unanchored').count).toBe(2);
  });
});

describe('validate-graph — CLI', () => {
  it('writes a deterministic report and a marked graph, exiting 0 with findings', () => {
    const root = fixtureProject();
    const inter = join(root, '.excavator', 'intermediate');
    mkdirSync(inter, { recursive: true });
    const graph = cleanGraph();
    graph.nodes.find((n) => n.id === 'class:src/app.ts:Runner').lineRange = [1, 11];
    writeFileSync(join(inter, 'annotated-graph.json'), JSON.stringify(graph));

    const first = spawnSync('node', [VALIDATE, root], { encoding: 'utf-8' });
    expect(first.status, first.stderr).toBe(0);
    const reportBytes = readFileSync(join(inter, 'validation.json'));
    const second = spawnSync('node', [VALIDATE, root], { encoding: 'utf-8' });
    expect(second.status).toBe(0);

    const sha = (buf) => createHash('sha256').update(buf).digest('hex');
    expect(sha(readFileSync(join(inter, 'validation.json')))).toBe(sha(reportBytes));
    expect(second.stderr).toBe(first.stderr);

    const report = JSON.parse(reportBytes.toString());
    expect(report.counts.anchorMismatch).toBe(1);
    expect(first.stderr).toMatch(/anchor-mismatch=1/);

    const validated = JSON.parse(readFileSync(join(inter, 'validated-graph.json'), 'utf-8'));
    expect(validated.nodes.find((n) => n.id === 'class:src/app.ts:Runner').verification).toBe('contradicted');
    // the input graph is not modified in place
    const input = JSON.parse(readFileSync(join(inter, 'annotated-graph.json'), 'utf-8'));
    expect(input.nodes.find((n) => n.id === 'class:src/app.ts:Runner').verification).toBeUndefined();
  });

  it('fails loudly when the graph is missing', () => {
    const root = fixtureProject();
    const r = spawnSync('node', [VALIDATE, root], { encoding: 'utf-8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/graph not found/);
  });
});

describe('validate-graph — imports evidence spans the whole statement', () => {
  function multilineGraph(fromPath) {
    const graph = cleanGraph();
    graph.nodes.push({
      id: `file:${fromPath}`, type: 'file', name: basename(fromPath), filePath: fromPath,
      summary: '', tags: [], complexity: 'simple',
    });
    graph.layers[0].nodeIds.push(`file:${fromPath}`);
    graph.edges.push({
      source: `file:${fromPath}`, target: 'file:src/helper.ts', type: 'imports',
      direction: 'forward', weight: 0.7, provenance: 'extracted',
      // cites the `import {` line, which is what the extractor reports
      evidence: [{ file: fromPath, line: 1, source: 'import-map' }],
    });
    return graph;
  }

  it('confirms a 3-line import whose evidence cites the first line', () => {
    const root = fixtureProject();
    const { report } = validate(root, multilineGraph('src/multiline.ts'));
    expect(report.counts.edgeContradicted).toBe(0);
    expect(report.counts.edgeConfirmed).toBe(5);
  });

  it('still contradicts when the specifier is genuinely absent from the statement', () => {
    const root = fixtureProject();
    const { report } = validate(root, multilineGraph('src/decoy.ts'));
    expect(report.counts.edgeContradicted).toBe(1);
    expect(report.findings.edgeContradicted[0].edgeKey).toBe(
      'imports|file:src/decoy.ts|file:src/helper.ts',
    );
  });

  it('stops at the end of the statement instead of scanning into later code', () => {
    const root = fixtureProject();
    const reader = createSourceReader(root);
    // decoy.ts names `helper` on line 6, after its statement ends on line 4.
    // A window that ran on would confirm an import that does not exist.
    expect(findTokenInImportStatement(reader, 'src/decoy.ts', 1, ['helper'])).toBeNull();
    expect(reader.line('src/decoy.ts', 6)).toContain('helper');
    // the multi-line case still resolves, on the line the specifier list is on
    expect(findTokenInImportStatement(reader, 'src/multiline.ts', 1, ['helper'])).toBe(2);
    expect(endsImportStatement("} from './helper';")).toBe(true);
    expect(endsImportStatement("const x = require('./y');")).toBe(true);
    expect(endsImportStatement('  a,')).toBe(false);
    expect(IMPORT_WINDOW_LINES).toBeGreaterThan(1);
  });


  it('keeps the single-line rule for every other edge type', () => {
    const root = fixtureProject();
    const graph = cleanGraph();
    // the callee is named on line 4; citing line 3 must still contradict
    graph.edges.find((e) => e.type === 'calls').evidence = [
      { file: 'src/app.ts', line: 3, source: 'tree-sitter' },
    ];
    expect(validate(root, graph).report.counts.edgeContradicted).toBe(1);
  });
});

describe('validate-graph — source reads are confined to the project root', () => {
  /** A file OUTSIDE the fixture root, which no check may ever read. */
  function outsideSecret(root) {
    const outside = join(dirname(root), 'outside-secret.ts');
    writeFileSync(outside, 'export function helper() { /* not in the project */ }\n');
    return outside;
  }

  function graphNaming(filePath) {
    const graph = cleanGraph();
    graph.nodes.push({
      id: `function:${filePath}:helper`, type: 'function', name: 'helper',
      filePath, lineRange: [1, 1], summary: 'claims to be here', tags: [], complexity: 'simple',
    });
    graph.layers[0].nodeIds.push(`function:${filePath}:helper`);
    return graph;
  }

  it('refuses a parent-relative path, counts it, and does not confirm it', () => {
    const root = fixtureProject();
    outsideSecret(root);
    const { validated, report } = validate(root, graphNaming('../outside-secret.ts'));

    expect(report.counts.pathOutOfScope).toBe(1);
    // the anchor is NOT confirmed — the clean graph's three anchors only
    expect(report.counts.anchorConfirmed).toBe(3);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.sourceMissing).toBe(0);
    expect(report.outOfScopePaths).toEqual(['../outside-secret.ts']);

    const node = validated.nodes.find((n) => n.filePath === '../outside-secret.ts');
    expect(node.verification).toBe('unverified');
    const gap = validated.gaps.find((g) => g.kind === 'path-out-of-scope');
    expect(gap.count).toBe(1);
    expect(gap.samples[0]).toContain('function:../outside-secret.ts:helper');
  });

  it('refuses an absolute path outright', () => {
    const root = fixtureProject();
    const { validated, report } = validate(root, graphNaming('/etc/hosts'));

    expect(report.counts.pathOutOfScope).toBe(1);
    expect(report.counts.anchorConfirmed).toBe(3);
    expect(validated.nodes.find((n) => n.filePath === '/etc/hosts').verification).toBe('unverified');
    expect(validated.gaps.find((g) => g.kind === 'path-out-of-scope').count).toBe(1);
  });

  it('refuses an edge whose evidence file is outside the root', () => {
    const root = fixtureProject();
    outsideSecret(root);
    const graph = cleanGraph();
    graph.edges.find((e) => e.type === 'calls').evidence = [
      { file: '../outside-secret.ts', line: 1, source: 'tree-sitter' },
    ];
    const { validated, report } = validate(root, graph);

    expect(report.counts.pathOutOfScope).toBe(1);
    expect(report.counts.edgeConfirmed).toBe(3);
    expect(report.counts.edgeContradicted).toBe(0);
    expect(validated.edges.find((e) => e.type === 'calls').verification).toBe('unverified');
  });

  it('still verifies a legitimate nested path', () => {
    const root = fixtureProject();
    mkdirSync(join(root, 'src', 'deep', 'deeper'), { recursive: true });
    writeFileSync(join(root, 'src/deep/deeper/mod.ts'), 'export function nested() {\n  return 1;\n}\n');
    const graph = graphNaming('src/deep/deeper/mod.ts');
    const node = graph.nodes.find((n) => n.filePath === 'src/deep/deeper/mod.ts');
    node.name = 'nested';
    node.id = 'function:src/deep/deeper/mod.ts:nested';
    graph.layers[0].nodeIds = graph.layers[0].nodeIds.map((id) =>
      id === 'function:src/deep/deeper/mod.ts:helper' ? node.id : id);
    const { report } = validate(root, graph);

    expect(report.counts.pathOutOfScope).toBe(0);
    expect(report.counts.anchorConfirmed).toBe(4);
    expect(report.counts.anchorMismatch).toBe(0);
  });

  it('refuses a symlink that resolves outside the root', () => {
    const root = fixtureProject();
    const outside = outsideSecret(root);
    symlinkSync(outside, join(root, 'src', 'link-out.ts'));
    const { report } = validate(root, graphNaming('src/link-out.ts'));

    expect(report.counts.pathOutOfScope).toBe(1);
    expect(report.counts.anchorConfirmed).toBe(3);
  });

  it('verifies in-scope files even when the root itself is reached through a symlink', () => {
    // The instrument check: on macOS the temp root is /var/... which is a
    // symlink to /private/var/.... Comparing a realpath'd file against a
    // symlinked root would refuse EVERY path and report a perfectly clean
    // graph as entirely out of scope.
    const root = fixtureProject();
    const { report } = validate(root, cleanGraph());
    expect(report.counts.pathOutOfScope).toBe(0);
    expect(report.counts.anchorConfirmed).toBe(3);
    expect(report.counts.edgeConfirmed).toBe(4);
  });

  it('resolveWithinRoot answers each shape directly', () => {
    const root = fixtureProject();
    expect(resolveWithinRoot(root, '../outside-secret.ts')).toBeNull();
    expect(resolveWithinRoot(root, '/etc/hosts')).toBeNull();
    expect(resolveWithinRoot(root, 'src/../../escape.ts')).toBeNull();
    expect(resolveWithinRoot(root, '')).toBeNull();
    expect(resolveWithinRoot(root, 'src/app.ts')).toContain('src/app.ts');
    // in scope but absent: readable-or-not is a separate finding
    expect(resolveWithinRoot(root, 'src/absent.ts')).toContain('src/absent.ts');
  });
});
