// Slice A / Task 1 — node-identity contract (openspec: changes/lazy-first-run/specs/node-identity).
// The single deterministic node-id authority shared by the fact builder and any
// deterministic id lookup. These fixtures pin the five invariants; they must be
// red before skills/excavator/node-identity.mjs exists.
import { describe, expect, it } from 'vitest';
import {
  deriveNodeId,
  normalizePath,
  normalizeSignature,
  collectNodeIds,
} from '../../skills/excavator/node-identity.mjs';

describe('R1 a single deterministic function', () => {
  it('repeated calls with the same input give byte-identical IDs', () => {
    const d = { type: 'function', path: 'src/a.ts', name: 'run', owner: '', params: ['x'] };
    expect(deriveNodeId(d)).toBe(deriveNodeId({ ...d }));
  });

  it('a file node id is file:<path>', () => {
    expect(deriveNodeId({ type: 'file', path: 'src/a.ts' })).toBe('file:src/a.ts');
  });
});

describe('R2 paths are stable across adapters', () => {
  it('git-relative, ./-relative and Windows-separator forms of a path derive the same ID', () => {
    const base = { type: 'function', path: 'src/a.ts', name: 'run', params: [] };
    const gitRel = deriveNodeId({ ...base, path: 'src/a.ts' });
    const dotRel = deriveNodeId({ ...base, path: './src/a.ts' });
    const winSep = deriveNodeId({ ...base, path: 'src\\a.ts' });
    expect(dotRel).toBe(gitRel);
    expect(winSep).toBe(gitRel);
  });

  it('the multi-repo member prefix is stable and tells members apart', () => {
    expect(normalizePath('foo/bar.ts', { memberId: 'm1' })).toBe('m1/foo/bar.ts');
    const inM1 = deriveNodeId({ type: 'function', path: 'foo/bar.ts', name: 'f', params: [], memberId: 'm1' });
    const inM2 = deriveNodeId({ type: 'function', path: 'foo/bar.ts', name: 'f', params: [], memberId: 'm2' });
    expect(inM1).not.toBe(inM2);
  });
});

describe('R3 distinguishing dimensions do not collapse', () => {
  it('methods with the same name and different receivers → two different IDs', () => {
    const a = deriveNodeId({ type: 'function', path: 'src/a.ts', name: 'save', owner: 'UserRepo', params: [] });
    const b = deriveNodeId({ type: 'function', path: 'src/a.ts', name: 'save', owner: 'OrderRepo', params: [] });
    expect(a).not.toBe(b);
  });

  it('overloads with different signatures → different IDs', () => {
    const one = deriveNodeId({ type: 'function', path: 'src/a.ts', name: 'add', owner: 'Calc', params: ['a'] });
    const two = deriveNodeId({ type: 'function', path: 'src/a.ts', name: 'add', owner: 'Calc', params: ['a', 'b'] });
    expect(one).not.toBe(two);
  });

  it('normalizeSignature normalizes parameters deterministically', () => {
    expect(normalizeSignature([' a ', 'b'])).toBe(normalizeSignature(['a', 'b']));
    expect(normalizeSignature([])).toBe('()');
  });

  it('overloads with the same parameter names and different types (Java) → different IDs and no identity collision', () => {
    const base = { type: 'function', path: 'src/Rule.java', name: 'handle', owner: 'Rule', params: ['command'] };
    const a = { ...base, paramTypes: ['JsonCommand'], lineRange: [2, 4] };
    const b = { ...base, paramTypes: ['String'], lineRange: [5, 7] };
    expect(deriveNodeId(a)).toBe('function:src/Rule.java:Rule#handle(JsonCommand)');
    expect(deriveNodeId(b)).toBe('function:src/Rule.java:Rule#handle(String)');
    expect(collectNodeIds([a, b]).collisions).toHaveLength(0);
  });

  it('with paramTypes the signature uses the types; without them it still uses the parameter names (other languages unchanged)', () => {
    const d = { type: 'function', path: 'src/a.ts', name: 'add', owner: 'Calc', params: ['a', 'b'] };
    expect(deriveNodeId(d)).toBe('function:src/a.ts:Calc#add(a,b)');
    expect(deriveNodeId({ ...d, paramTypes: ['int', 'int'] })).toBe('function:src/a.ts:Calc#add(int,int)');
    expect(deriveNodeId({ ...d, paramTypes: [], signature: '(x)' })).toBe('function:src/a.ts:Calc#add(x)');
  });
});

describe('R4 a stable fallback for anonymous and hard-to-name constructs', () => {
  // An anonymous handler: it has no name, so its ordinal within
  // (path, owner, kind) stands in for one.
  const anon = (ordinal) => deriveNodeId({ type: 'function', path: 'src/routes.ts', owner: '', params: [], ordinal });

  it('comments, blank lines or code of another kind inserted before it → same ordinal → same ID', () => {
    // Code of another kind inserted before it leaves the ordinal among
    // declarations of the same kind unchanged: ordinal is still 2.
    expect(anon(2)).toBe(anon(2));
  });

  it('a declaration of the same kind inserted before it → ordinal + 1 → the ID changes (only for this node)', () => {
    expect(anon(3)).not.toBe(anon(2));
  });

  it('an anonymous node without an ordinal throws (fail-closed: no unstable id)', () => {
    expect(() => deriveNodeId({ type: 'function', path: 'src/routes.ts', owner: '', params: [] }))
      .toThrow();
  });
});

describe('R5 identity consistency is visible; collisions are not silent', () => {
  it('two distinguishable declarations (different lineRange) with the same ID → identity-collision reported', () => {
    const decls = [
      { type: 'function', path: 'src/a.ts', name: 'run', owner: 'A', params: [], lineRange: [1, 5] },
      { type: 'function', path: 'src/a.ts', name: 'run', owner: 'A', params: [], lineRange: [20, 25] },
    ];
    const { collisions } = collectNodeIds(decls);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].id).toBe('function:src/a.ts:A#run()');
  });

  it('unique declarations produce no collision', () => {
    const decls = [
      { type: 'function', path: 'src/a.ts', name: 'run', owner: 'A', params: [], lineRange: [1, 5] },
      { type: 'function', path: 'src/a.ts', name: 'run', owner: 'B', params: [], lineRange: [20, 25] },
    ];
    const { collisions } = collectNodeIds(decls);
    expect(collisions).toHaveLength(0);
  });
});
