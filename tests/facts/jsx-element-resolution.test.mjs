// jsx-element-references, task 2.3: every JSX element resolves through the
// file's import bindings and the target module's exports to one edge or one
// of five visible gaps.
import { describe, expect, it } from 'vitest';
import {
  JSX_ELEMENTS_NOT_RUN, JSX_GAP_KINDS, assertJsxConservation, resolveJsxElements,
} from '../../skills/excavator/jsx-element-resolution.mjs';

// A tiny project: `decls` lists top-level functions/classes per file as
// [name, startLine, endLine]; the node id is `path#name` (a second entry of
// the same name gets `#2`).
function project({ rows, resolvedSources, unresolved = {}, decls = {} }) {
  const declIndex = new Map();
  const functions = new Map();
  for (const [path, list] of Object.entries(decls)) {
    for (const [name, start, end, type = 'function'] of list) {
      const key = `${path}|${name}`;
      const ids = declIndex.get(key) ?? [];
      const id = ids.length === 0 ? `${path}#${name}` : `${path}#${name}#${ids.length + 1}`;
      ids.push({ id, owner: null, lineRange: [start, end], type });
      declIndex.set(key, ids);
      if (type === 'function') functions.set(path, [...(functions.get(path) ?? []), { id, lineRange: [start, end] }]);
    }
  }
  return resolveJsxElements({
    rows,
    importMap: resolvedSources === undefined ? { unresolved } : { resolvedSources, unresolved },
    topLevelDecls: (path, name) => declIndex.get(`${path}|${name}`) ?? [],
    functionsOf: (path) => functions.get(path) ?? [],
    languageOf: (path) => (path.endsWith('.js') ? 'javascript' : 'typescript'),
  });
}

const imp = (source, bindings) => ({ source, specifiers: bindings.map(([local]) => local), line: 1, bindings: bindings.map(([local, imported]) => ({ local, imported })) });
const reexport = (source, pairs) => ({ source, specifiers: [], line: 1, reexports: pairs.map(([exported, imported]) => ({ exported, imported })) });
const page = (imports, names, extra = {}) => ({
  path: 'src/page.tsx',
  imports,
  jsx: { elements: names.map((name) => (typeof name === 'string' ? { name, line: 5 } : { line: 5, ...name })), intrinsic: 0 },
  ...extra,
});
const PAGE_DECLS = { 'src/page.tsx': [['Page', 3, 9]] };
const outcome = (result) => (result.edges.length === 1 ? { edge: result.edges[0].target } : { gap: result.gaps[0]?.kind });

describe('resolveJsxElements: import forms', () => {
  it('draws an edge for a named import, with the tag as the token', () => {
    const result = project({
      rows: [page([imp('./button', [['Button', 'Button']])], ['Button']), { path: 'src/button.tsx', exports: [{ name: 'Button', line: 1, isDefault: false }] }],
      resolvedSources: { 'src/page.tsx': { './button': 'src/button.tsx' } },
      decls: { ...PAGE_DECLS, 'src/button.tsx': [['Button', 1, 4]] },
    });
    expect(result.edges).toEqual([{ source: 'src/page.tsx#Page', target: 'src/button.tsx#Button', file: 'src/page.tsx', line: 5, token: 'Button' }]);
    expect(result.gaps).toEqual([]);
    expect(result.coverage).toEqual({ status: 'ran', files: 1, intrinsic: 0, sites: 1, edge: 1, external: 0, unbound: 0, targetUnresolved: 0, ambiguous: 0, callerUnresolved: 0 });
  });

  it('follows a renamed default import to each form of default export', () => {
    const forms = {
      'export default function Button': { name: 'Button', line: 1, isDefault: true },
      'export default Button;': { name: 'default', line: 9, isDefault: true, local: 'Button' },
      'export { Button as default }': { name: 'default', line: 9, local: 'Button' },
    };
    for (const [form, exp] of Object.entries(forms)) {
      const result = project({
        rows: [page([imp('./button', [['Btn', 'default']])], ['Btn']), { path: 'src/button.tsx', exports: [exp] }],
        resolvedSources: { 'src/page.tsx': { './button': 'src/button.tsx' } },
        decls: { ...PAGE_DECLS, 'src/button.tsx': [['Button', 1, 4]] },
      });
      expect(outcome(result), form).toEqual({ edge: 'src/button.tsx#Button' });
      expect(result.edges[0].token).toBe('Btn');
    }
  });

  it('resolves `default` export of a class to the class node', () => {
    const result = project({
      rows: [page([imp('./shell', [['Shell', 'default']])], ['Shell']), { path: 'src/shell.tsx', exports: [{ name: 'default', line: 1, isDefault: true, local: 'Shell' }] }],
      resolvedSources: { 'src/page.tsx': { './shell': 'src/shell.tsx' } },
      decls: { ...PAGE_DECLS, 'src/shell.tsx': [['Shell', 1, 9, 'class']] },
    });
    expect(outcome(result)).toEqual({ edge: 'src/shell.tsx#Shell' });
  });

  it('resolves a member of a namespace import, and nothing else of it', () => {
    const rows = [
      page([imp('./ui', [['UI', '*']])], ['UI.Panel', 'UI.Missing', 'UI']),
      { path: 'src/ui.tsx', exports: [{ name: 'Panel', line: 1, isDefault: false }] },
    ];
    const result = project({ rows, resolvedSources: { 'src/page.tsx': { './ui': 'src/ui.tsx' } }, decls: { ...PAGE_DECLS, 'src/ui.tsx': [['Panel', 1, 3]] } });
    expect(result.edges.map((e) => e.token)).toEqual(['UI.Panel']);
    expect(result.gaps.map((g) => [g.kind, g.sample])).toEqual([
      [JSX_GAP_KINDS.targetUnresolved, 'src/page.tsx:5 -> UI.Missing'],
      [JSX_GAP_KINDS.targetUnresolved, 'src/page.tsx:5 -> UI'],
    ]);
  });

  it('draws an edge to a top-level component of the same file', () => {
    const result = project({ rows: [page([], ['Row'])], resolvedSources: {}, decls: { 'src/page.tsx': [['Page', 3, 9], ['Row', 11, 12]] } });
    expect(outcome(result)).toEqual({ edge: 'src/page.tsx#Row' });
  });
});

describe('resolveJsxElements: re-export barrels', () => {
  const barrel = (index, extraRows = [], extraSources = {}, extraDecls = {}) => project({
    rows: [page([imp('./ui', [['Button', 'Button'], ['Card', 'Card'], ['Icons', 'Icons']])], ['Button', 'Card', 'Icons.Star']), index, ...extraRows],
    resolvedSources: {
      'src/page.tsx': { './ui': 'src/ui/index.ts' },
      'src/ui/index.ts': { './button': 'src/ui/button.tsx', './card': 'src/ui/card.tsx', './icons': 'src/ui/icons.tsx' },
      ...extraSources,
    },
    decls: { ...PAGE_DECLS, 'src/ui/button.tsx': [['Button', 1, 3]], 'src/ui/card.tsx': [['Card', 1, 3]], 'src/ui/icons.tsx': [['Star', 1, 3]], ...extraDecls },
  });
  const leafRows = [
    { path: 'src/ui/button.tsx', exports: [{ name: 'Button', line: 1, isDefault: false }] },
    { path: 'src/ui/card.tsx', exports: [{ name: 'Card', line: 1, isDefault: false }] },
    { path: 'src/ui/icons.tsx', exports: [{ name: 'Star', line: 1, isDefault: false }] },
  ];

  it('follows explicit re-exports, `export *` and `export * as`', () => {
    const index = { path: 'src/ui/index.ts', imports: [reexport('./button', [['Button', 'Button']]), reexport('./card', [['*', '*']]), reexport('./icons', [['Icons', '*']])] };
    const result = barrel(index, leafRows);
    expect(result.edges.map((e) => e.target)).toEqual(['src/ui/button.tsx#Button', 'src/ui/card.tsx#Card', 'src/ui/icons.tsx#Star']);
    expect(result.gaps).toEqual([]);
  });

  it('follows an import the barrel exports again by name', () => {
    const index = {
      path: 'src/ui/index.ts',
      imports: [imp('./button', [['Button', 'Button']]), reexport('./card', [['*', '*']]), reexport('./icons', [['Icons', '*']])],
      exports: [{ name: 'Button', line: 2, isDefault: false }],
    };
    expect(barrel(index, leafRows).edges[0].target).toBe('src/ui/button.tsx#Button');
  });

  it('collapses a diamond of `export *` onto one declaration, and calls two providers ambiguous', () => {
    const indexSources = { './button': 'src/ui/button.tsx', './card': 'src/ui/card.tsx', './icons': 'src/ui/icons.tsx' };
    const index = (extra) => ({
      path: 'src/ui/index.ts',
      imports: [reexport('./button', [['Button', 'Button']]), reexport('./card', [['*', '*']]), reexport('./icons', [['Icons', '*']]), reexport(extra, [['*', '*']])],
    });
    // index -> card and index -> again -> card: one declaration.
    const again = { path: 'src/ui/again.ts', imports: [reexport('./card', [['*', '*']])] };
    const diamond = barrel(index('./again'), [...leafRows, again], {
      'src/ui/index.ts': { ...indexSources, './again': 'src/ui/again.ts' },
      'src/ui/again.ts': { './card': 'src/ui/card.tsx' },
    });
    expect(diamond.edges.map((e) => e.target)).toContain('src/ui/card.tsx#Card');
    expect(diamond.gaps).toEqual([]);

    // index -> card and index -> other, each declaring its own Card.
    const other = { path: 'src/ui/other.tsx', exports: [{ name: 'Card', line: 1, isDefault: false }] };
    const twoProviders = barrel(index('./other'), [...leafRows, other], {
      'src/ui/index.ts': { ...indexSources, './other': 'src/ui/other.tsx' },
    }, { 'src/ui/other.tsx': [['Card', 1, 2]] });
    expect(twoProviders.gaps.map((g) => [g.kind, g.sample])).toEqual([[JSX_GAP_KINDS.ambiguous, 'src/page.tsx:5 -> Card']]);
  });

  it('ends an `export *` cycle without a result for the name', () => {
    const rows = [
      page([imp('./a', [['Ghost', 'Ghost']])], ['Ghost']),
      { path: 'src/a.ts', imports: [reexport('./b', [['*', '*']])] },
      { path: 'src/b.ts', imports: [reexport('./a', [['*', '*']])] },
    ];
    const result = project({
      rows,
      resolvedSources: { 'src/page.tsx': { './a': 'src/a.ts' }, 'src/a.ts': { './b': 'src/b.ts' }, 'src/b.ts': { './a': 'src/a.ts' } },
      decls: PAGE_DECLS,
    });
    expect(outcome(result)).toEqual({ gap: JSX_GAP_KINDS.targetUnresolved });
  });

  it('does not forward a default export through `export *`', () => {
    const rows = [
      page([imp('./ui', [['Main', 'default']])], ['Main']),
      { path: 'src/ui/index.ts', imports: [reexport('./main', [['*', '*']])] },
      { path: 'src/ui/main.tsx', exports: [{ name: 'Main', line: 1, isDefault: true }] },
    ];
    const result = project({
      rows,
      resolvedSources: { 'src/page.tsx': { './ui': 'src/ui/index.ts' }, 'src/ui/index.ts': { './main': 'src/ui/main.tsx' } },
      decls: { ...PAGE_DECLS, 'src/ui/main.tsx': [['Main', 1, 2]] },
    });
    expect(outcome(result)).toEqual({ gap: JSX_GAP_KINDS.targetUnresolved });
  });
});

describe('resolveJsxElements: gaps', () => {
  it('files a package import, and a name no repository `export *` provides beside an external one, as external', () => {
    const rows = [
      page([imp('react-router', [['Link', 'Link']]), imp('./ui', [['Toast', 'Toast']])], ['Link', 'Toast', 'Link.Item']),
      { path: 'src/ui/index.ts', imports: [reexport('toast-kit', [['*', '*']])] },
    ];
    const result = project({
      rows,
      resolvedSources: { 'src/page.tsx': { './ui': 'src/ui/index.ts' } },
      unresolved: { 'src/page.tsx': ['react-router'], 'src/ui/index.ts': ['toast-kit'] },
      decls: PAGE_DECLS,
    });
    expect(result.gaps.map((g) => g.kind)).toEqual([JSX_GAP_KINDS.external, JSX_GAP_KINDS.external, JSX_GAP_KINDS.external]);
    expect(result.coverage.external).toBe(3);
  });

  it('files a specifier the import map neither resolved nor listed as target-unresolved', () => {
    const result = project({ rows: [page([imp('./gone', [['Gone', 'Gone']])], ['Gone'])], resolvedSources: {}, decls: PAGE_DECLS });
    expect(outcome(result)).toEqual({ gap: JSX_GAP_KINDS.targetUnresolved });
  });

  it('files an exported value that is not a function or class, and a property of a component, as target-unresolved', () => {
    const rows = [
      page([imp('./button', [['Button', 'Button'], ['Fancy', 'Fancy']])], ['Fancy', 'Button.Icon']),
      { path: 'src/button.tsx', exports: [{ name: 'Button', line: 1, isDefault: false }, { name: 'Fancy', line: 5, isDefault: false }] },
    ];
    const result = project({ rows, resolvedSources: { 'src/page.tsx': { './button': 'src/button.tsx' } }, decls: { ...PAGE_DECLS, 'src/button.tsx': [['Button', 1, 3]] } });
    expect(result.gaps.map((g) => g.kind)).toEqual([JSX_GAP_KINDS.targetUnresolved, JSX_GAP_KINDS.targetUnresolved]);
  });

  it('files a local, a recovered tag and a name nothing binds as unbound, even when an import has the name', () => {
    const rows = [page([imp('./icon', [['Icon', 'Icon']])], [{ name: 'Icon', local: true }, { name: 'Icon', syntaxError: true }, 'Styled'])];
    const result = project({ rows, resolvedSources: { 'src/page.tsx': { './icon': 'src/icon.tsx' } }, decls: PAGE_DECLS });
    expect(result.gaps.map((g) => g.kind)).toEqual([JSX_GAP_KINDS.unbound, JSX_GAP_KINDS.unbound, JSX_GAP_KINDS.unbound]);
    expect(result.edges).toEqual([]);
  });

  it('files two same-named declarations as ambiguous', () => {
    const result = project({ rows: [page([], ['Row'])], resolvedSources: {}, decls: { 'src/page.tsx': [['Page', 3, 9], ['Row', 11, 12], ['Row', 14, 15]] } });
    expect(outcome(result)).toEqual({ gap: JSX_GAP_KINDS.ambiguous });
  });

  it('files an element no single function contains as caller-unresolved', () => {
    const rows = [page([], [{ name: 'Row', line: 1 }])];
    const result = project({ rows, resolvedSources: {}, decls: { 'src/page.tsx': [['Page', 3, 9], ['Row', 11, 12]] } });
    expect(outcome(result)).toEqual({ gap: JSX_GAP_KINDS.callerUnresolved });
    expect(result.gaps[0].scope).toBe('typescript');
  });

  it('files an element two function nodes contain as caller-unresolved', () => {
    // `const a = () => <Row />, b = () => null;` gives both functions the
    // range of the one declaration.
    const result = project({ rows: [page([], ['Row'])], resolvedSources: {}, decls: { 'src/page.tsx': [['a', 4, 6], ['b', 4, 6], ['Row', 11, 12]] } });
    expect(outcome(result)).toEqual({ gap: JSX_GAP_KINDS.callerUnresolved });
  });

  it('does not run without resolved sources, and says so', () => {
    expect(project({ rows: [page([], ['Row'])], decls: PAGE_DECLS })).toEqual({ coverage: JSX_ELEMENTS_NOT_RUN, edges: [], gaps: [] });
  });
});

describe('assertJsxConservation', () => {
  const coverage = { status: 'ran', files: 1, intrinsic: 2, sites: 3, edge: 1, external: 1, unbound: 1, targetUnresolved: 0, ambiguous: 0, callerUnresolved: 0 };
  const recorded = { 'jsx-external': 1, 'jsx-unbound': 1 };

  it('accepts balanced counts', () => {
    expect(() => assertJsxConservation(coverage, recorded)).not.toThrow();
  });

  it('fails on a dropped site and on a bucket the gaps do not match', () => {
    expect(() => assertJsxConservation({ ...coverage, sites: 4 }, recorded)).toThrow(/sites=4 but edge\+gaps=3/);
    expect(() => assertJsxConservation(coverage, { ...recorded, 'jsx-unbound': 0 })).toThrow(/jsx-unbound: coverage 1, recorded 0/);
  });
});
