// unused-code, the report half: the decisions the host skill made are applied to
// the candidate set; what is left is the unused code, grouped, with a confidence
// per node from fixed rules. Pure-function tests build candidate products in
// memory (every field the real product carries, a types table, a digest) and call
// `buildUnusedReport`; CLI tests run the script on temp project directories,
// including a chain through the real `candidates` subcommand.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { writeKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { writeStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import {
  UNUSED_CANDIDATES_FORMAT,
  UNUSED_CODE_FILE,
  UNUSED_CODE_FORMAT,
  UNUSED_DECISIONS_FILE,
  assertReportConservation,
  buildUnusedReport,
} from '../../skills/excavator/unused-code.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../skills/excavator/unused-code.mjs');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// ---------------------------------------------------------------------------
// In-memory candidate products
// ---------------------------------------------------------------------------

const FACTS = 'facts-digest-1';
const OWNER = 'class:src/X.java:X';
const idOf = (name) => `function:src/X.java:X#${name}()`;
const idsOf = (...names) => names.map(idOf);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A types-table row: a class nothing outside the repository touches, with no annotations. */
const ownerType = (over = {}) => ({
  name: 'X',
  file: 'src/X.java',
  annotations: [],
  outsideSupertypes: { own: [], ancestors: [], descendants: [], unknown: 0 },
  referencedBy: { references: 0, injects: 0, mentions: 0, samples: [] },
  annotationClassLiterals: { count: 0, samples: [] },
  ...over,
});
const typeWith = (supertypes) => ownerType({ outsideSupertypes: { own: [], ancestors: [], descendants: [], unknown: 0, ...supertypes } });

/**
 * A candidates product from a compact spec. `nodes` maps a function name to the
 * feature fields it overrides (the default is a clean private Java method of
 * `X`); `calls` are [referrer, referenced] name pairs; every name in an `islands`
 * list shares one component, every other name has its own. `entry` follows the
 * component rule of the real product: no reference from another component.
 */
function world({ nodes, calls = [], islands = [], types = { [OWNER]: ownerType() }, factsDigest = FACTS }) {
  const names = Object.keys(nodes).sort(compare);
  const componentOf = new Map();
  let next = 0;
  for (const island of islands) {
    for (const name of island) componentOf.set(name, next);
    next += 1;
  }
  for (const name of names) if (!componentOf.has(name)) componentOf.set(name, next++);

  const referrers = new Map(names.map((name) => [name, []]));
  const hasOutsideReferrer = new Set();
  for (const [from, to] of calls) {
    referrers.get(to).push({ id: idOf(from), edge: 'calls', reverse: false });
    if (componentOf.get(from) !== componentOf.get(to)) hasOutsideReferrer.add(componentOf.get(to));
  }
  const candidates = names.map((name) => ({
    id: idOf(name),
    name,
    language: 'java',
    file: 'src/X.java',
    lineRange: [1, 2],
    owner: OWNER,
    visibility: 'private',
    modifiers: [],
    annotations: [],
    entry: !hasOutsideReferrer.has(componentOf.get(name)),
    component: componentOf.get(name),
    referrers: referrers.get(name).sort((a, b) => compare(a.id, b.id)),
    census: { elsewhere: 0, samples: [], sameNameDeclarationsOnly: false },
    ...nodes[name],
  }));
  return {
    format: UNUSED_CANDIDATES_FORMAT,
    factsDigest,
    sourceRevision: 'rev-1',
    counts: { candidates: candidates.length },
    conservation: { candidates: candidates.length, holds: true },
    census: {},
    types,
    candidates,
  };
}

const decision = (kind, names, extra = {}) => ({ kind, reason: `why ${kind}`, query: '.candidates[] | .id', ids: idsOf(...names), ...extra });
const entry = (...names) => decision('entry', names);
const testEntry = (...names) => decision('test-entry', names);
const document = (list, factsDigest = FACTS) => ({ factsDigest, decisions: list });

const DECISIONS_DIGEST = 'd'.repeat(64);
const report = (candidates, list = [], { decisions = document(list), factsDigest = FACTS } = {}) => buildUnusedReport({
  candidates, decisions, decisionsDigest: DECISIONS_DIGEST, factsDigest,
});
const nodeOf = (result, name) => {
  const hit = result.unused.filter((node) => node.id === idOf(name));
  expect(hit, `unused node ${name}`).toHaveLength(1);
  return hit[0];
};
const codes = (node) => node.signals.map((s) => s.signal);
const clone = (value) => structuredClone(value);

// ---------------------------------------------------------------------------
// Decisions (spec: entry judgment by the host skill)
// ---------------------------------------------------------------------------

describe('decisions', () => {
  it('one entry decision removes 40 annotation-selected candidates; hits is 40 and none stays in unused', () => {
    const scheduled = Array.from({ length: 40 }, (_, i) => `s${String(i).padStart(2, '0')}`);
    const nodes = Object.fromEntries([...scheduled.map((name) => [name, { annotations: ['Scheduled'] }]), ['plain', {}]]);
    const candidates = world({ nodes });
    const result = report(candidates, [entry(...scheduled)]);
    expect(result.decisions).toEqual([{ ...entry(...scheduled), hits: 40 }]);
    expect(result.unused.map((node) => node.id)).toEqual([idOf('plain')]);
    expect(result.counts).toMatchObject({ candidates: 41, removedByDecision: 40, unused: 1 });
    // Instrument check: the same set without the decision reports all 41.
    expect(report(candidates, []).unused).toHaveLength(41);
  });

  it('removing an entry B removes A that only B references: decisions only remove', () => {
    const candidates = world({ nodes: { a: {}, b: {} }, calls: [['b', 'a']] });
    expect(report(candidates, []).unused.map((n) => n.id)).toEqual(idsOf('a', 'b'));
    const result = report(candidates, [entry('b')]);
    expect(result.unused).toEqual([]);
    expect(result.groups).toEqual([]);
    expect(result.counts).toMatchObject({ removedByDecision: 2, unused: 0, groups: 0 });
  });

  it('a decision may name a node that is not a cluster entry, and removes what only it reaches', () => {
    const candidates = world({ nodes: { b: {}, a: {}, c: {} }, calls: [['b', 'a'], ['a', 'c']] });
    const result = report(candidates, [entry('a')]);
    expect(result.unused.map((n) => n.id)).toEqual(idsOf('b'));
  });

  it('rejects an id that is not a candidate, naming the decision and the id', () => {
    const candidates = world({ nodes: { a: {} } });
    const bad = { ...entry('a'), ids: [idOf('a'), 'function:src/Gone.java:Gone#go()'] };
    expect(() => report(candidates, [bad])).toThrow(/decision 0: function:src\/Gone\.java:Gone#go\(\)/);
    expect(() => report(candidates, [testEntry('a'), bad])).toThrow(/decision 1: function:src\/Gone/);
  });

  it('names up to 20 unknown ids and states the total', () => {
    const candidates = world({ nodes: { a: {} } });
    const ids = Array.from({ length: 25 }, (_, i) => `ghost-${String(i).padStart(2, '0')}`);
    let message = '';
    try {
      report(candidates, [{ ...entry('a'), ids }]);
    } catch (error) {
      message = error.message;
    }
    expect(message).toMatch(/^25 decision id\(s\) are not candidates/);
    expect(message).toContain('ghost-19');
    expect(message).not.toContain('ghost-20');
    expect(message).toMatch(/and 5 more/);
  });

  it('rejects the same id in two decisions, naming both indexes', () => {
    const candidates = world({ nodes: { a: {}, b: {} } });
    expect(() => report(candidates, [entry('a'), entry('b'), testEntry('a')])).toThrow(
      new RegExp(`${idOf('a').replace(/[()#.]/g, '\\$&')} \\(decisions 0 and 2\\)`),
    );
  });

  it('rejects the same id twice inside one decision', () => {
    const candidates = world({ nodes: { a: {} } });
    expect(() => report(candidates, [{ ...entry('a'), ids: [idOf('a'), idOf('a')] }])).toThrow(/twice in decision 0/);
  });

  it('names up to 20 repeated ids and states the total, an id once however often it repeats', () => {
    const names = Array.from({ length: 22 }, (_, i) => `n${String(i).padStart(2, '0')}`);
    const candidates = world({ nodes: Object.fromEntries(names.map((name) => [name, {}])) });
    let message = '';
    try {
      report(candidates, [entry(...names), entry(...names), entry(...names)]);
    } catch (error) {
      message = error.message;
    }
    expect(message).toMatch(/^22 id\(s\) appear more than once/);
    expect(message).toMatch(/and 2 more/);
  });

  it('rejects a decisions document made on another candidate set', () => {
    const candidates = world({ nodes: { a: {} } });
    expect(() => report(candidates, [], { decisions: document([entry('a')], 'other-digest') })).toThrow(
      /decisions were made on another candidate set \(candidates facts-digest-1 vs decisions other-digest\); redo the decisions/,
    );
  });

  it('rejects a candidate set that is stale against the current fact graph, before looking at the decisions', () => {
    const candidates = world({ nodes: { a: {} } });
    expect(() => report(candidates, [], { decisions: 'not even an object', factsDigest: 'facts-digest-2' })).toThrow(
      /the candidate set is stale \(facts facts-digest-2 vs candidates facts-digest-1\); run "unused-code\.mjs candidates" again/,
    );
  });

  it('rejects a candidates product in another format', () => {
    const candidates = { ...world({ nodes: { a: {} } }), format: 'excavator-unused-candidates/0' };
    expect(() => report(candidates, [])).toThrow(/not in format excavator-unused-candidates\/1/);
  });

  it.each([
    ['an unknown key', [{ ...entry('a'), extra: 1 }], /decision 0: unknown key "extra"/],
    ['an unknown key in the second decision', [entry('a'), { ...entry('b'), note: 'x' }], /decision 1: unknown key "note"/],
    ['a kind that is neither entry nor test-entry', [{ ...entry('a'), kind: 'ignore' }], /decision 0: kind must be/],
    ['a missing kind', [{ reason: 'r', query: 'q', ids: idsOf('a') }], /decision 0: kind must be/],
    ['a blank reason', [{ ...entry('a'), reason: '   ' }], /decision 0: reason must be a non-empty string/],
    ['a reason that is not a string', [{ ...entry('a'), reason: 7 }], /decision 0: reason must be a non-empty string/],
    ['a blank query', [entry('b'), { ...entry('a'), query: '' }], /decision 1: query must be a non-empty string/],
    ['an empty ids list', [{ ...entry('a'), ids: [] }], /decision 0: ids must be a non-empty array of strings/],
    ['ids that is not an array', [{ ...entry('a'), ids: idOf('a') }], /decision 0: ids must be a non-empty array of strings/],
    ['an id that is not a string', [{ ...entry('a'), ids: [idOf('a'), 42] }], /decision 0: ids must be a non-empty array of strings \(ids\[1\]/],
    ['a decision that is not an object', [entry('a'), 'a'], /decision 1: must be an object/],
  ])('rejects %s', (_what, list, pattern) => {
    const candidates = world({ nodes: { a: {}, b: {} } });
    expect(() => report(candidates, list)).toThrow(pattern);
  });

  it('rejects a document with an unknown top-level key, a non-array decisions field and a non-object', () => {
    const candidates = world({ nodes: { a: {} } });
    expect(() => report(candidates, [], { decisions: { factsDigest: FACTS, decisions: [], note: 'x' } })).toThrow(/unknown key "note"/);
    expect(() => report(candidates, [], { decisions: { factsDigest: FACTS, decisions: {} } })).toThrow(/"decisions" must be an array/);
    expect(() => report(candidates, [], { decisions: [] })).toThrow(/must hold a JSON object/);
    expect(() => report(candidates, [], { decisions: { decisions: [] } })).toThrow(/another candidate set/);
  });

  it('accepts no decisions at all: every candidate is unused', () => {
    const result = report(world({ nodes: { a: {}, b: {} } }), []);
    expect(result.counts).toMatchObject({ candidates: 2, removedByDecision: 0, testOnly: 0, unused: 2 });
    expect(result.decisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Definition at report level (spec: the definition of unused code)
// ---------------------------------------------------------------------------

describe('unused, test-only and groups', () => {
  it('B unreferenced and A only referenced by B: B is unreferenced, A only-reachable-from-unused with referrer B, one group with entry B', () => {
    const result = report(world({ nodes: { a: {}, b: {} }, calls: [['b', 'a']] }));
    expect(nodeOf(result, 'b')).toMatchObject({ reason: 'unreferenced', referrers: [], group: 0 });
    expect(nodeOf(result, 'a')).toMatchObject({
      reason: 'only-reachable-from-unused', referrers: [{ id: idOf('b'), edge: 'calls', reverse: false }], group: 0,
    });
    expect(result.groups).toEqual([{ group: 0, entries: idsOf('b'), members: idsOf('a', 'b') }]);
    expect(result.counts).toMatchObject({ unused: 2, unreferenced: 1, onlyReachableFromUnused: 1, groups: 1 });
  });

  it('an island A <-> B: both unreferenced, one group, entries [A, B]', () => {
    const result = report(world({ nodes: { a: {}, b: {} }, calls: [['a', 'b'], ['b', 'a']], islands: [['a', 'b']] }));
    expect(result.unused.map((n) => n.reason)).toEqual(['unreferenced', 'unreferenced']);
    expect(result.groups).toEqual([{ group: 0, entries: idsOf('a', 'b'), members: idsOf('a', 'b') }]);
  });

  it('C referenced only by the test method T: a test-entry decision on T makes T and C test-only, not unused', () => {
    const candidates = world({ nodes: { t: {}, c: {}, lone: {} }, calls: [['t', 'c']] });
    const result = report(candidates, [testEntry('t')]);
    expect(result.testOnly).toEqual([
      { id: idOf('c'), name: 'c', language: 'java', file: 'src/X.java', lineRange: [1, 2] },
      { id: idOf('t'), name: 't', language: 'java', file: 'src/X.java', lineRange: [1, 2] },
    ]);
    expect(result.unused.map((n) => n.id)).toEqual(idsOf('lone'));
    expect(result.counts).toMatchObject({ candidates: 3, removedByDecision: 0, testOnly: 2, unused: 1 });
  });

  it('a node reachable from both an entry and a test-entry decision is removed, not test-only', () => {
    const candidates = world({ nodes: { e: {}, t: {}, shared: {}, onlyTest: {} }, calls: [['e', 'shared'], ['t', 'shared'], ['t', 'onlyTest']] });
    const result = report(candidates, [entry('e'), testEntry('t')]);
    expect(result.counts).toMatchObject({ removedByDecision: 2, testOnly: 2, unused: 0 });
    expect(result.testOnly.map((n) => n.id)).toEqual(idsOf('onlyTest', 't'));
  });

  it('numbers groups 0..n-1 by their smallest member id, entries and members sorted', () => {
    const candidates = world({ nodes: { z: {}, a: {}, m: {}, k: {}, j: {} }, calls: [['z', 'a'], ['k', 'j']] });
    const result = report(candidates);
    expect(result.groups).toEqual([
      { group: 0, entries: idsOf('z'), members: idsOf('a', 'z') },
      { group: 1, entries: idsOf('k'), members: idsOf('j', 'k') },
      { group: 2, entries: idsOf('m'), members: idsOf('m') },
    ]);
    expect(nodeOf(result, 'z').group).toBe(0);
    expect(nodeOf(result, 'j').group).toBe(1);
  });

  it('a group lists every one of its entries', () => {
    const result = report(world({ nodes: { a: {}, b: {}, shared: {} }, calls: [['a', 'shared'], ['b', 'shared']] }));
    expect(result.groups).toEqual([{ group: 0, entries: idsOf('a', 'b'), members: idsOf('a', 'b', 'shared') }]);
  });

  it('a non-entry member that is referenced only inside its own component passes the invariants', () => {
    // Z references X; X and Y reference each other. Y is in a non-entry component but only X references it.
    const candidates = world({
      nodes: { z: {}, x: {}, y: {} },
      calls: [['z', 'x'], ['x', 'y'], ['y', 'x']],
      islands: [['x', 'y']],
    });
    expect(candidates.candidates.filter((c) => c.name === 'y')[0]).toMatchObject({ entry: false, referrers: [{ id: idOf('x') }] });
    const result = report(candidates);
    expect(result.groups).toEqual([{ group: 0, entries: idsOf('z'), members: idsOf('x', 'y', 'z') }]);
    expect(result.unused.map((n) => n.reason)).toEqual(['only-reachable-from-unused', 'only-reachable-from-unused', 'unreferenced']);
  });
});

// ---------------------------------------------------------------------------
// Confidence (spec: confidence rules; design D6)
// ---------------------------------------------------------------------------

describe('confidence', () => {
  it('private, no annotations, census 0, owner known with no outside supertype, not referenced: high with no signals', () => {
    const node = nodeOf(report(world({ nodes: { m: {} } })), 'm');
    expect(node).toMatchObject({ confidence: 'high', signals: [] });
  });

  it('private readObject on an owner that implements Serializable: medium, owner-outside-supertype, not visible-with-outside-supertype', () => {
    const candidates = world({ nodes: { readObject: {} }, types: { [OWNER]: typeWith({ own: ['Serializable'] }) } });
    const node = nodeOf(report(candidates), 'readObject');
    expect(node.confidence).toBe('medium');
    expect(node.signals).toContainEqual({ signal: 'owner-outside-supertype', own: ['Serializable'], ancestors: [] });
    expect(codes(node)).not.toContain('visible-with-outside-supertype');
    expect(codes(node)).toEqual(['owner-outside-supertype']);
  });

  it('a public method whose owner web.xml references: low, owner-referenced carries the file and line', () => {
    const sample = { type: 'references', source: 'config:WEB-INF/web.xml', file: 'WEB-INF/web.xml', line: 12 };
    const candidates = world({
      nodes: { handle: { visibility: 'public' } },
      types: { [OWNER]: ownerType({ referencedBy: { references: 1, injects: 0, mentions: 0, samples: [sample] } }) },
    });
    const node = nodeOf(report(candidates), 'handle');
    expect(node.confidence).toBe('low');
    expect(node.signals).toContainEqual({ signal: 'owner-referenced', references: 1, injects: 0, mentions: 0, samples: [sample] });
  });

  it('a name elsewhere is low and carries the count, the samples and the same-name flag', () => {
    const census = { elsewhere: 2, samples: [{ file: 'a.xml', line: 3 }, { file: 'b.xml', line: 4 }], sameNameDeclarationsOnly: true };
    const node = nodeOf(report(world({ nodes: { m: { census } } })), 'm');
    expect(node.confidence).toBe('low');
    expect(node.signals).toEqual([{ signal: 'name-elsewhere', count: 2, samples: census.samples, sameNameDeclarationsOnly: true }]);
  });

  it('an owner named as an annotation class literal is low', () => {
    const literal = { file: 'src/Mapper.java', line: 2 };
    const candidates = world({
      nodes: { m: {} },
      types: { [OWNER]: ownerType({ annotationClassLiterals: { count: 1, samples: [literal] } }) },
    });
    const node = nodeOf(report(candidates), 'm');
    expect(node.confidence).toBe('low');
    expect(node.signals).toEqual([{ signal: 'owner-class-literal', count: 1, samples: [literal] }]);
  });

  it('a public non-static method whose owner, ancestors or descendants touch the outside is low with visible-with-outside-supertype', () => {
    for (const [field, value] of [['own', ['Runnable']], ['ancestors', ['Base']], ['descendants', ['Listener']]]) {
      const candidates = world({ nodes: { run: { visibility: 'public' } }, types: { [OWNER]: typeWith({ [field]: value }) } });
      const node = nodeOf(report(candidates), 'run');
      expect(node.confidence, field).toBe('low');
      expect(node.signals.find((s) => s.signal === 'visible-with-outside-supertype')).toEqual({
        signal: 'visible-with-outside-supertype',
        own: field === 'own' ? value : [],
        ancestors: field === 'ancestors' ? value : [],
        descendants: field === 'descendants' ? value : [],
      });
    }
  });

  it('a package-private method counts as not private for the outside-supertype rule', () => {
    const candidates = world({ nodes: { run: { visibility: 'package' } }, types: { [OWNER]: typeWith({ own: ['Runnable'] }) } });
    expect(nodeOf(report(candidates), 'run').confidence).toBe('low');
  });

  it('a null visibility counts as not private for the outside-supertype rule', () => {
    const candidates = world({ nodes: { run: { visibility: null } }, types: { [OWNER]: typeWith({ own: ['Runnable'] }) } });
    const node = nodeOf(report(candidates), 'run');
    expect(node.confidence).toBe('low');
    expect(codes(node)).toContain('visible-with-outside-supertype');
  });

  it('a public static method on an owner with an outside supertype has no visible-with-outside-supertype signal', () => {
    const candidates = world({
      nodes: { util: { visibility: 'public', modifiers: ['static', 'final'] } },
      types: { [OWNER]: typeWith({ own: ['Runnable'] }) },
    });
    const node = nodeOf(report(candidates), 'util');
    expect(codes(node)).not.toContain('visible-with-outside-supertype');
    expect(node.confidence).toBe('medium');
    expect(codes(node)).toEqual(['not-private', 'owner-outside-supertype']);
  });

  it('a private method on an owner whose descendants touch the outside stays high: only the owner and its ancestors count for high', () => {
    const candidates = world({ nodes: { m: {} }, types: { [OWNER]: typeWith({ descendants: ['Listener'] }) } });
    expect(nodeOf(report(candidates), 'm')).toMatchObject({ confidence: 'high', signals: [] });
  });

  it('visibility null with every other fact clean: medium with visibility-unknown, never high', () => {
    const node = nodeOf(report(world({ nodes: { m: { visibility: null } } })), 'm');
    expect(node).toMatchObject({ confidence: 'medium', signals: [{ signal: 'visibility-unknown' }] });
  });

  it('census null is not high', () => {
    const node = nodeOf(report(world({ nodes: { m: { census: null } } })), 'm');
    expect(node).toMatchObject({ confidence: 'medium', signals: [{ signal: 'census-unknown' }] });
  });

  it('an owner whose own supertypes are unknown is not high', () => {
    const candidates = world({ nodes: { m: {} }, types: { [OWNER]: typeWith({ own: null, unknown: 1 }) } });
    const node = nodeOf(report(candidates), 'm');
    expect(node).toMatchObject({ confidence: 'medium', signals: [{ signal: 'owner-hierarchy-unknown', unknown: 1 }] });
  });

  it('an owner with an unknown supertype among its relatives is not high', () => {
    const candidates = world({ nodes: { m: {} }, types: { [OWNER]: typeWith({ unknown: 1 }) } });
    expect(nodeOf(report(candidates), 'm')).toMatchObject({ confidence: 'medium', signals: [{ signal: 'owner-hierarchy-unknown', unknown: 1 }] });
  });

  it('method annotations unknown, method annotated, owner annotations unknown, owner annotated: each is medium', () => {
    const cases = [
      [{ annotations: null }, [{ signal: 'annotations-unknown' }]],
      [{ annotations: ['PostConstruct'] }, [{ signal: 'annotated', annotations: ['PostConstruct'] }]],
    ];
    for (const [over, signals] of cases) {
      expect(nodeOf(report(world({ nodes: { m: over } })), 'm')).toMatchObject({ confidence: 'medium', signals });
    }
    const unknownOwner = world({ nodes: { m: {} }, types: { [OWNER]: ownerType({ annotations: null }) } });
    expect(nodeOf(report(unknownOwner), 'm')).toMatchObject({ confidence: 'medium', signals: [{ signal: 'owner-annotations-unknown' }] });
    const annotatedOwner = world({ nodes: { m: {} }, types: { [OWNER]: ownerType({ annotations: ['Component'] }) } });
    expect(nodeOf(report(annotatedOwner), 'm')).toMatchObject({
      confidence: 'medium', signals: [{ signal: 'owner-annotated', annotations: ['Component'] }],
    });
  });

  it('a free function (no owner), private and clean: high, and a language-less node needs no types row', () => {
    const candidates = world({ nodes: { tidy: { owner: null, language: 'python' } }, types: {} });
    expect(nodeOf(report(candidates), 'tidy')).toMatchObject({ confidence: 'high', owner: null, signals: [] });
  });

  it('a free function with an outside-supertype owner row elsewhere is judged without owner rules', () => {
    const candidates = world({
      nodes: { tidy: { owner: null, visibility: 'public' } },
      types: { [OWNER]: typeWith({ own: ['Runnable'] }) },
    });
    expect(nodeOf(report(candidates), 'tidy')).toMatchObject({ confidence: 'medium', signals: [{ signal: 'not-private', visibility: 'public' }] });
  });

  it('emits every signal that holds, in table order', () => {
    const census = { elsewhere: 1, samples: [{ file: 'a.xml', line: 1 }], sameNameDeclarationsOnly: false };
    const candidates = world({
      nodes: { m: { visibility: 'public', annotations: ['Scheduled'], census } },
      types: {
        [OWNER]: ownerType({
          annotations: ['Component'],
          outsideSupertypes: { own: ['Runnable'], ancestors: [], descendants: [], unknown: 0 },
          referencedBy: { references: 0, injects: 1, mentions: 0, samples: [] },
          annotationClassLiterals: { count: 1, samples: [] },
        }),
      },
    });
    expect(codes(nodeOf(report(candidates), 'm'))).toEqual([
      'name-elsewhere', 'owner-referenced', 'owner-class-literal', 'visible-with-outside-supertype',
      'not-private', 'annotated', 'owner-annotated', 'owner-outside-supertype',
    ]);
  });

  describe('the cap: never above a node that references it', () => {
    it('member A is high on its own, its only referrer B is medium: A is medium, capped by B', () => {
      const candidates = world({ nodes: { a: {}, b: { visibility: 'public' } }, calls: [['b', 'a']] });
      const result = report(candidates);
      const a = nodeOf(result, 'a');
      expect(a.confidence).toBe('medium');
      expect(a.signals).toEqual([{ signal: 'capped', from: 'high', by: idOf('b') }]);
      expect(nodeOf(result, 'b').signals.map((s) => s.signal)).toEqual(['not-private']);
    });

    it('two levels: entry E is low, M and L are high on their own: both are low, L is capped by M and M by E', () => {
      const census = { elsewhere: 1, samples: [{ file: 'a.xml', line: 1 }], sameNameDeclarationsOnly: false };
      const candidates = world({ nodes: { e: { census }, m: {}, l: {} }, calls: [['e', 'm'], ['m', 'l']] });
      const result = report(candidates);
      expect(nodeOf(result, 'e').confidence).toBe('low');
      expect(nodeOf(result, 'm')).toMatchObject({ confidence: 'low', signals: [{ signal: 'capped', from: 'high', by: idOf('e') }] });
      expect(nodeOf(result, 'l')).toMatchObject({ confidence: 'low', signals: [{ signal: 'capped', from: 'high', by: idOf('m') }] });
    });

    it('an island {X high, Y medium}: both are medium, X is capped by Y, Y is not capped', () => {
      const candidates = world({
        nodes: { x: {}, y: { visibility: 'public' } }, calls: [['x', 'y'], ['y', 'x']], islands: [['x', 'y']],
      });
      const result = report(candidates);
      expect(nodeOf(result, 'x')).toMatchObject({ confidence: 'medium', signals: [{ signal: 'capped', from: 'high', by: idOf('y') }] });
      expect(nodeOf(result, 'y')).toMatchObject({ confidence: 'medium', signals: [{ signal: 'not-private', visibility: 'public' }] });
    });

    it('a member below its referrer is not capped: its own level stands', () => {
      const candidates = world({ nodes: { a: { visibility: 'public' }, b: {} }, calls: [['b', 'a']] });
      const a = nodeOf(report(candidates), 'a');
      expect(a.confidence).toBe('medium');
      expect(codes(a)).toEqual(['not-private']);
    });

    it('capped.by is the smallest referrer id among those at the member\'s level, itself excluded', () => {
      const census = { elsewhere: 1, samples: [], sameNameDeclarationsOnly: false };
      const candidates = world({
        nodes: { a: {}, m: { visibility: 'public' }, n: { visibility: 'public' }, j: { census }, k: { census } },
        calls: [['n', 'a'], ['m', 'a'], ['k', 'a'], ['j', 'a'], ['a', 'a']],
      });
      const a = nodeOf(report(candidates), 'a');
      // j and k are low and give the final level; m and n are medium and are not at that level.
      expect(a.confidence).toBe('low');
      expect(a.signals).toEqual([{ signal: 'capped', from: 'high', by: idOf('j') }]);
    });

    it('the cap is the minimum over every referrer, not the first one', () => {
      const candidates = world({
        nodes: { top1: { visibility: 'public' }, top2: {}, a: {} },
        calls: [['top1', 'a'], ['top2', 'a']],
      });
      expect(nodeOf(report(candidates), 'a')).toMatchObject({ confidence: 'medium', signals: [{ signal: 'capped', from: 'high', by: idOf('top1') }] });
    });

    it('the cap flows through a component that sits between two others', () => {
      // low E -> {P <-> Q island of highs} -> R high: P, Q and R all low.
      const census = { elsewhere: 1, samples: [], sameNameDeclarationsOnly: false };
      const candidates = world({
        nodes: { e: { census }, p: {}, q: {}, r: {} },
        calls: [['e', 'p'], ['p', 'q'], ['q', 'p'], ['q', 'r']],
        islands: [['p', 'q']],
      });
      const result = report(candidates);
      expect(result.unused.map((n) => [n.id.slice(-4, -2), n.confidence])).toEqual([['#e', 'low'], ['#p', 'low'], ['#q', 'low'], ['#r', 'low']]);
      expect(nodeOf(result, 'r').signals).toEqual([{ signal: 'capped', from: 'high', by: idOf('q') }]);
    });
  });

  it('rejects a non-null owner that is not in the types table', () => {
    const candidates = world({ nodes: { m: {} }, types: {} });
    expect(() => report(candidates)).toThrow(/owner class:src\/X\.java:X is not in the types table/);
  });

  it('rejects a types row that is malformed', () => {
    const candidates = world({ nodes: { m: {} } });
    delete candidates.types[OWNER].outsideSupertypes;
    expect(() => report(candidates)).toThrow(/outsideSupertypes is missing or malformed/);
  });
});

// ---------------------------------------------------------------------------
// Product and conservation (spec: product, freshness and query)
// ---------------------------------------------------------------------------

describe('assertReportConservation', () => {
  const sets = { candidateIds: ['a', 'b', 'c'], removed: ['a'], testOnly: ['b'], unused: ['c'] };

  it('accepts a partition', () => {
    expect(() => assertReportConservation(sets)).not.toThrow();
    expect(() => assertReportConservation({ candidateIds: [], removed: [], testOnly: [], unused: [] })).not.toThrow();
  });

  it('throws when two of the sets overlap', () => {
    expect(() => assertReportConservation({ ...sets, unused: ['c', 'a'] })).toThrow(/conservation violated: candidates=3, removedByDecision=1, testOnly=1, unused=2; .*more than one.*a/);
  });

  it('throws when a candidate is in none of the sets', () => {
    expect(() => assertReportConservation({ ...sets, unused: [] })).toThrow(/1 candidate\(s\) in none of the removed, test-only and unused sets: c/);
  });

  it('throws when a set holds an id that is not a candidate', () => {
    expect(() => assertReportConservation({ ...sets, testOnly: ['b', 'ghost'] })).toThrow(/not candidates: ghost/);
  });
});

describe('inputs', () => {
  it('rejects a referrer that is not a candidate', () => {
    const candidates = world({ nodes: { a: {} } });
    candidates.candidates[0].referrers = [{ id: 'function:src/Gone.java:Gone#go()', edge: 'calls', reverse: false }];
    candidates.candidates[0].entry = false;
    expect(() => report(candidates)).toThrow(/names the referrer function:src\/Gone\.java:Gone#go\(\), which is not a candidate/);
  });

  it('rejects a candidate id listed twice', () => {
    const candidates = world({ nodes: { a: {} } });
    candidates.candidates.push(clone(candidates.candidates[0]));
    expect(() => report(candidates)).toThrow(/lists function:src\/X\.java:X#a\(\) twice/);
  });

  it.each(['census', 'visibility', 'modifiers', 'annotations', 'referrers', 'component', 'entry'])('rejects a candidate record without %s', (field) => {
    const candidates = world({ nodes: { a: {} } });
    delete candidates.candidates[0][field];
    expect(() => report(candidates)).toThrow(new RegExp(`${field} is missing or malformed`));
  });

  it('rejects an entry that has a referrer outside its component', () => {
    const candidates = world({ nodes: { a: {}, b: {} }, calls: [['a', 'b']] });
    candidates.candidates.find((c) => c.name === 'b').entry = true;
    expect(() => report(candidates)).toThrow(/is an entry but has a referrer outside its component/);
  });

  it('rejects a non-entry component none of whose members has a referrer outside it', () => {
    const candidates = world({ nodes: { a: {} } });
    candidates.candidates[0].entry = false;
    expect(() => report(candidates)).toThrow(/is not an entry but none of its members has a referrer outside it/);
  });

  it('rejects members of one component that disagree on entry', () => {
    const candidates = world({ nodes: { a: {}, b: {} }, calls: [['a', 'b'], ['b', 'a']], islands: [['a', 'b']] });
    candidates.candidates[0].entry = false;
    expect(() => report(candidates)).toThrow(/share component 0 but disagree on entry/);
  });

  it('rejects a component field that makes the references between components cyclic', () => {
    // P and Q reference each other but carry different components; E references P.
    const candidates = world({ nodes: { e: {}, p: {}, q: {} }, calls: [['e', 'p'], ['p', 'q'], ['q', 'p']] });
    expect(() => report(candidates)).toThrow(/the component field is inconsistent/);
  });
});

describe('the product', () => {
  /**
   * a (java) unreferenced, b (java) only referenced by a, c (python, no visibility facts) alone,
   * d (no language, public) alone; e is removed by an entry decision; t is a test entry reaching u.
   */
  const fixture = () => world({
    nodes: {
      a: {},
      b: {},
      c: { language: 'python', visibility: null, owner: null, file: 'tools/c.py' },
      d: { language: null, visibility: 'public', owner: null, file: 'misc/d.txt', lineRange: null },
      e: {},
      t: {},
      u: {},
    },
    calls: [['a', 'b'], ['t', 'u']],
  });
  const list = [entry('e'), testEntry('t')];

  it('has exactly the documented keys in order, with the counts, conservation, residual assumptions and decisions', () => {
    const candidates = fixture();
    const result = report(candidates, list);
    expect(Object.keys(result)).toEqual([
      'format', 'factsDigest', 'decisionsDigest', 'sourceRevision', 'counts', 'conservation',
      'residualAssumptions', 'decisions', 'unused', 'groups', 'testOnly',
    ]);
    expect(result).toMatchObject({ format: UNUSED_CODE_FORMAT, factsDigest: FACTS, decisionsDigest: DECISIONS_DIGEST, sourceRevision: 'rev-1' });
    expect(UNUSED_CODE_FORMAT).toBe('excavator-unused-code/1');
    expect(Object.keys(result.counts)).toEqual([
      'candidates', 'removedByDecision', 'testOnly', 'unused', 'unreferenced', 'onlyReachableFromUnused', 'groups', 'byConfidence', 'byLanguage',
    ]);
    expect(result.counts).toEqual({
      candidates: 7,
      removedByDecision: 1,
      testOnly: 2,
      unused: 4,
      unreferenced: 3,
      onlyReachableFromUnused: 1,
      groups: 3,
      byConfidence: { high: 2, medium: 2, low: 0 },
      byLanguage: {
        java: { unused: 2, high: 2, medium: 0, low: 0 },
        python: { unused: 1, high: 0, medium: 1, low: 0 },
        unknown: { unused: 1, high: 0, medium: 1, low: 0 },
      },
    });
    expect(Object.keys(result.counts.byLanguage)).toEqual(['java', 'python', 'unknown']);
    expect(result.conservation).toEqual({ candidates: 7, removedByDecision: 1, testOnly: 2, unused: 4, holds: true });
    expect(result.residualAssumptions).toEqual([
      'Files the source manifest did not select take no part in the name census.',
      'Reflection on names assembled at run time is invisible.',
      'Code generated at build time and absent from the repository is invisible.',
      'Callers outside the repository show only through visibility: a non-private member may be called from outside.',
    ]);
    expect(result.decisions).toEqual([
      { kind: 'entry', reason: 'why entry', query: '.candidates[] | .id', hits: 1, ids: idsOf('e') },
      { kind: 'test-entry', reason: 'why test-entry', query: '.candidates[] | .id', hits: 1, ids: idsOf('t') },
    ]);
  });

  it('writes each unused node with the documented keys, sorted by id, and the test-only nodes with theirs', () => {
    const result = report(fixture(), list);
    expect(result.unused.map((n) => n.id)).toEqual(idsOf('a', 'b', 'c', 'd'));
    for (const node of result.unused) {
      expect(Object.keys(node)).toEqual([
        'id', 'name', 'language', 'file', 'lineRange', 'owner', 'visibility', 'reason', 'referrers', 'group', 'confidence', 'signals',
      ]);
    }
    expect(nodeOf(result, 'c')).toMatchObject({ language: 'python', file: 'tools/c.py', owner: null, visibility: null, confidence: 'medium' });
    expect(nodeOf(result, 'd')).toMatchObject({ language: null, lineRange: null, visibility: 'public', confidence: 'medium' });
    expect(nodeOf(result, 'b')).toMatchObject({ reason: 'only-reachable-from-unused', group: 0, confidence: 'high' });
    expect(result.groups.map((g) => g.group)).toEqual([0, 1, 2]);
    expect(Object.keys(result.groups[0])).toEqual(['group', 'entries', 'members']);
    expect(result.testOnly.map((n) => n.id)).toEqual(idsOf('t', 'u'));
    expect(Object.keys(result.testOnly[0])).toEqual(['id', 'name', 'language', 'file', 'lineRange']);
  });

  it('is the same bytes whatever the order of the candidates', () => {
    const names = Array.from({ length: 24 }, (_, i) => `n${String(i).padStart(2, '0')}`);
    const nodes = Object.fromEntries(names.map((name, i) => [name, i % 5 === 0 ? { visibility: 'public' } : {}]));
    const calls = names.slice(1).map((name, i) => [names[Math.floor(i / 2)], name]);
    calls.push(['n05', 'n04'], ['n04', 'n05']);
    const candidates = world({ nodes, calls, islands: [['n04', 'n05']] });
    const decisions = [entry('n20'), testEntry('n15')];
    const baseline = JSON.stringify(report(candidates, decisions));

    const reversed = clone(candidates);
    reversed.candidates.reverse();
    expect(JSON.stringify(report(reversed, decisions))).toBe(baseline);

    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 5; round++) {
      const shuffled = clone(candidates);
      for (let i = shuffled.candidates.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled.candidates[i], shuffled.candidates[j]] = [shuffled.candidates[j], shuffled.candidates[i]];
      }
      expect(JSON.stringify(report(shuffled, decisions))).toBe(baseline);
    }
  });

  it('does not change its inputs', () => {
    const candidates = fixture();
    const decisions = document(list);
    const before = JSON.stringify([candidates, decisions]);
    report(candidates, list, { decisions });
    expect(JSON.stringify([candidates, decisions])).toBe(before);
  });

  it('handles an empty candidate set', () => {
    const result = report(world({ nodes: {}, types: {} }));
    expect(result.counts).toMatchObject({ candidates: 0, unused: 0, groups: 0, byLanguage: {} });
    expect(result.unused).toEqual([]);
  });

  it('is linear: a chain of 50,000 nodes with one entry completes quickly and keeps the order', () => {
    const count = 50000;
    const pad = (i) => String(i).padStart(6, '0');
    const nodes = {};
    const calls = [];
    for (let i = 0; i < count; i++) {
      nodes[`c${pad(i)}`] = {};
      if (i > 0) calls.push([`c${pad(i - 1)}`, `c${pad(i)}`]);
    }
    const candidates = world({ nodes, calls });
    const started = Date.now();
    const result = report(candidates, []);
    expect(Date.now() - started).toBeLessThan(10000);
    expect(result.counts).toMatchObject({ unused: count, unreferenced: 1, groups: 1 });
    expect(result.groups[0].entries).toEqual([idOf('c000000')]);
    expect(nodeOf(result, `c${pad(count - 1)}`).confidence).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

describe('report CLI', () => {
  const dirs = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  /** A project dir with a fact graph (only its header digest matters here), a candidates product and a decisions file. */
  function project({ candidates = fixtureProduct(), graphDigest = FACTS, decisions = document([entry('e')]), decisionsText = null, writeCandidates = true } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'unused-code-report-'));
    dirs.push(root);
    const data = join(root, '.excavator');
    mkdirSync(join(data, 'intermediate'), { recursive: true });
    writeKnowledgeGraph(join(data, 'intermediate', 'fact-graph.jsonl'), {
      nodes: [], edges: [], coverage: [], gaps: [], factsDigest: graphDigest,
    });
    if (writeCandidates) writeFileSync(join(data, 'unused-candidates.json'), JSON.stringify(candidates));
    const decisionsPath = join(data, UNUSED_DECISIONS_FILE);
    if (decisionsText !== null) writeFileSync(decisionsPath, decisionsText);
    else if (decisions !== null) writeFileSync(decisionsPath, JSON.stringify(decisions));
    // The script works on the canonical root, so messages carry canonical paths.
    return { root, data, decisionsPath: join(realpathSync(root), '.excavator', UNUSED_DECISIONS_FILE), out: join(data, UNUSED_CODE_FILE) };
  }
  const fixtureProduct = () => world({ nodes: { a: {}, b: {}, e: {} }, calls: [['a', 'b']] });
  const run = (args, options = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8', ...options });
  const read = (path) => JSON.parse(readFileSync(path, 'utf-8'));

  it('writes the product, prints one JSON line with its path and counts, and leaves no temporary file', () => {
    const { root, data, out } = project();
    const result = run(['report', root]);
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const printed = JSON.parse(lines[0]);
    expect(Object.keys(printed)).toEqual(['product', 'counts']);
    expect(printed.product).toBe(join(realpathSync(root), '.excavator', 'unused-code.json'));
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).toMatch(/2 unused \(2 high, 0 medium, 0 low\) in 1 groups; 1 removed by decision, 0 test-only of 3 candidates/);

    const written = read(out);
    expect(written.counts).toEqual(printed.counts);
    expect(written.counts).toMatchObject({ candidates: 3, removedByDecision: 1, unused: 2, groups: 1 });
    expect(readdirSync(data).filter((name) => name.includes('.tmp-'))).toEqual([]);
    // The CLI product is the pure function's product, byte for byte.
    const expected = buildUnusedReport({
      candidates: read(join(data, 'unused-candidates.json')),
      decisions: read(join(data, UNUSED_DECISIONS_FILE)),
      decisionsDigest: sha256(readFileSync(join(data, UNUSED_DECISIONS_FILE))),
      factsDigest: FACTS,
    });
    expect(readFileSync(out, 'utf-8')).toBe(`${JSON.stringify(expected)}\n`);
  });

  it('writes the sha256 of the decisions file bytes as decisionsDigest, not of its parsed content', () => {
    const text = `${JSON.stringify(document([entry('e')]), null, 4)}\n\n`;
    const { root, out } = project({ decisionsText: text });
    expect(run(['report', root]).status).toBe(0);
    expect(read(out).decisionsDigest).toBe(sha256(Buffer.from(text, 'utf-8')));
    expect(read(out).decisionsDigest).not.toBe(sha256(JSON.stringify(document([entry('e')]))));
  });

  it('rejects an id that is not a candidate: exit code 1, the id in the message, no product written', () => {
    const { root, out } = project({ decisions: document([{ ...entry('e'), ids: [idOf('e'), 'function:src/Gone.java:Gone#go()'] }]) });
    const result = run(['report', root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^unused-code\.mjs failed: .*function:src\/Gone\.java:Gone#go\(\)/);
    expect(result.stdout).toBe('');
    expect(existsSync(out)).toBe(false);
  });

  it('rejects a candidate set whose digest differs from the fact graph header: exit code 1, nothing written', () => {
    const { root, out } = project({ graphDigest: 'newer-facts' });
    const result = run(['report', root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/the candidate set is stale \(facts newer-facts vs candidates facts-digest-1\)/);
    expect(existsSync(out)).toBe(false);
  });

  it('rejects decisions made on another candidate set: exit code 1, nothing written', () => {
    const { root, out } = project({ decisions: document([entry('e')], 'other-facts') });
    const result = run(['report', root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/another candidate set/);
    expect(existsSync(out)).toBe(false);
  });

  it('leaves an existing product untouched when the run fails', () => {
    const { root, out } = project({ graphDigest: 'newer-facts' });
    writeFileSync(out, 'previous');
    expect(run(['report', root]).status).toBe(1);
    expect(readFileSync(out, 'utf-8')).toBe('previous');
  });

  it('--decisions overrides the default file, resolved against the working directory', () => {
    // The default file was made on another candidate set, so using it fails: the override must be what is read.
    const { root, out } = project({ decisions: document([entry('e')], 'stale-decisions') });
    expect(run(['report', root]).status).toBe(1);
    const elsewhere = mkdtempSync(join(tmpdir(), 'unused-code-decisions-'));
    dirs.push(elsewhere);
    writeFileSync(join(elsewhere, 'mine.json'), JSON.stringify(document([entry('e')])));
    const result = run(['report', root, '--decisions', 'mine.json'], { cwd: elsewhere });
    expect(result.status, result.stderr).toBe(0);
    expect(read(out).decisionsDigest).toBe(sha256(readFileSync(join(elsewhere, 'mine.json'))));
    expect(read(out).counts.removedByDecision).toBe(1);
  });

  it('a missing decisions file: exit code 1 with the message naming the path, nothing written', () => {
    const { root, decisionsPath, out } = project({ decisions: null });
    const result = run(['report', root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`no decisions file at ${decisionsPath}; the excavator-unused-code skill writes it`);
    expect(existsSync(out)).toBe(false);
    const cwd = realpathSync(dirname(root));
    const named = run(['report', root, '--decisions', 'nowhere.json'], { cwd });
    expect(named.status).toBe(1);
    expect(named.stderr).toContain(`no decisions file at ${join(cwd, 'nowhere.json')}`);
  });

  it('a missing candidates product: exit code 1, tells to run candidates first', () => {
    const { root, out } = project({ writeCandidates: false });
    const result = run(['report', root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/missing .*unused-candidates\.json; run "unused-code\.mjs candidates" first/);
    expect(existsSync(out)).toBe(false);
  });

  it('a missing fact graph: exit code 1, names the file', () => {
    const { root, data, out } = project();
    rmSync(join(data, 'intermediate', 'fact-graph.jsonl'));
    const result = run(['report', root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/fact-graph\.jsonl/);
    expect(existsSync(out)).toBe(false);
  });

  it('a decisions file that is not JSON: exit code 1, names the file', () => {
    const { root, decisionsPath, out } = project({ decisionsText: '{ not json' });
    const result = run(['report', root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${decisionsPath}: not valid JSON`);
    expect(existsSync(out)).toBe(false);
  });

  it('a candidates product in another format: exit code 1', () => {
    const { root, out } = project({ candidates: { ...fixtureProduct(), format: 'something-else' } });
    const result = run(['report', root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not in format excavator-unused-candidates\/1/);
    expect(existsSync(out)).toBe(false);
  });

  it('prints usage and exits 1 for a missing root, a dangling or unknown option and extra arguments', () => {
    const { root } = project();
    for (const args of [['report'], ['report', '--decisions', 'x.json'], ['report', root, '--decisions'], ['report', root, 'extra'],
      ['report', root, '--decisions', 'a', 'b'], ['report', root, '--decisions=a'], ['report', root, '--other', 'a'], ['candidates', root, '--decisions', 'a']]) {
      const result = run(args);
      expect(result.status, JSON.stringify(args)).toBe(1);
      expect(result.stderr).toContain('Usage: node unused-code.mjs candidates <projectRoot>');
      expect(result.stderr).toContain('node unused-code.mjs report <projectRoot> [--decisions <file>]');
      expect(result.stdout).toBe('');
    }
  });

  describe('through the real candidates subcommand', () => {
    const CALC = ['class Calc {', '  private void recalc() {}', '  public void dead() { helper(); }', '  private void helper() {}', '}'].join('\n');
    const fnNode = (name, line) => ({ id: `function:src/Calc.java:Calc#${name}()`, type: 'function', name, filePath: 'src/Calc.java', lineRange: [line, line] });
    const fnRow = (name, line, visibility) => ({ name, startLine: line, endLine: line, visibility, modifiers: [], annotations: [] });

    function chain() {
      const root = mkdtempSync(join(tmpdir(), 'unused-code-chain-'));
      dirs.push(root);
      const data = join(root, '.excavator');
      mkdirSync(join(data, 'intermediate'), { recursive: true });
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'Calc.java'), CALC);
      const cls = { id: 'class:src/Calc.java:Calc', type: 'class', name: 'Calc', filePath: 'src/Calc.java', lineRange: [1, 5] };
      const nodes = [cls, fnNode('recalc', 2), fnNode('dead', 3), fnNode('helper', 4)];
      writeKnowledgeGraph(join(data, 'intermediate', 'fact-graph.jsonl'), {
        nodes,
        edges: [
          ...nodes.slice(1).map((n) => ({ source: cls.id, target: n.id, type: 'contains' })),
          { source: nodes[2].id, target: nodes[3].id, type: 'calls' },
        ],
        coverage: [],
        gaps: [],
        factsDigest: 'chain-digest',
      });
      writeStructureAll(join(data, 'intermediate', 'structure-all.jsonl'), {
        scriptCompleted: true,
        results: [{
          path: 'src/Calc.java',
          language: 'java',
          functions: [fnRow('recalc', 2, 'private'), fnRow('dead', 3, 'public'), fnRow('helper', 4, 'private')],
          classes: [{ name: 'Calc', startLine: 1, supertypes: [], annotations: [] }],
          classLiterals: [],
        }],
      });
      writeFileSync(join(data, 'source-manifest.json'), JSON.stringify({
        sourceRevision: 'git:chain', entries: [{ path: 'src/Calc.java', contentHash: sha256(CALC) }],
      }));
      return { root, data };
    }

    it('reads what candidates wrote: the decision removes recalc, dead stays medium and helper is capped by it', () => {
      const { root, data } = chain();
      const made = run(['candidates', root]);
      expect(made.status, made.stderr).toBe(0);
      const candidates = read(join(data, 'unused-candidates.json'));
      expect(candidates.format).toBe(UNUSED_CANDIDATES_FORMAT);
      const calcId = (name) => `function:src/Calc.java:Calc#${name}()`;
      writeFileSync(join(data, UNUSED_DECISIONS_FILE), JSON.stringify({
        factsDigest: candidates.factsDigest,
        decisions: [{ kind: 'entry', reason: 'called by the scheduler', query: '.candidates[] | select(.name == "recalc") | .id', ids: [calcId('recalc')] }],
      }));

      const result = run(['report', root]);
      expect(result.status, result.stderr).toBe(0);
      const written = read(join(data, 'unused-code.json'));
      expect(written.sourceRevision).toBe('git:chain');
      expect(written.counts).toMatchObject({ candidates: 3, removedByDecision: 1, unused: 2, unreferenced: 1, onlyReachableFromUnused: 1, groups: 1 });
      expect(written.unused.map((n) => [n.name, n.reason, n.confidence])).toEqual([
        ['dead', 'unreferenced', 'medium'],
        ['helper', 'only-reachable-from-unused', 'medium'],
      ]);
      expect(written.unused[1].signals).toEqual([{ signal: 'capped', from: 'high', by: calcId('dead') }]);
      expect(written.groups).toEqual([{ group: 0, entries: [calcId('dead')], members: [calcId('dead'), calcId('helper')] }]);

      // Instrument: without the decision, recalc is one more high-confidence unused node.
      writeFileSync(join(data, UNUSED_DECISIONS_FILE), JSON.stringify({ factsDigest: candidates.factsDigest, decisions: [] }));
      expect(run(['report', root]).status).toBe(0);
      const undecided = read(join(data, 'unused-code.json'));
      expect(undecided.counts).toMatchObject({ unused: 3, removedByDecision: 0, byConfidence: { high: 1, medium: 2, low: 0 } });
    });

    it('candidates still prints usage for its own bad argument shapes and works as before', () => {
      const { root, data } = chain();
      for (const args of [['candidates'], ['candidates', root, 'extra']]) {
        const result = run(args);
        expect(result.status, JSON.stringify(args)).toBe(1);
        expect(result.stderr).toMatch(/Usage: node unused-code\.mjs candidates <projectRoot>/);
      }
      const result = run(['candidates', root]);
      expect(result.status, result.stderr).toBe(0);
      expect(Object.keys(JSON.parse(result.stdout))).toEqual(['product', 'counts', 'census']);
      expect(existsSync(join(data, 'unused-code.json'))).toBe(false);
    });
  });
});
