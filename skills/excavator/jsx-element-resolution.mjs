// JSX element references (openspec: changes/jsx-element-references).
//
// A TS/JS JSX element `<X>` or `<X.Y>` renders the component its tag names.
// Each element the extractor recorded becomes exactly one of: a `calls` edge
// from the function containing it to the function or class the tag resolves
// to, or one of five visible gaps. Resolution follows the file's import
// bindings through the import map and the target module's exports
// (re-exports, local exports, `export *`), never a same-name search.
//
// Pure: reads structure rows and the import map, writes nothing.

import { createModuleBindingResolver } from './module-binding-resolution.mjs';

export const JSX_GAP_KINDS = Object.freeze({
  external: 'jsx-external',
  unbound: 'jsx-unbound',
  targetUnresolved: 'jsx-target-unresolved',
  ambiguous: 'jsx-ambiguous',
  callerUnresolved: 'jsx-caller-unresolved',
});

/** Reason text per gap kind, count-agnostic like the fact graph's others. */
export const JSX_GAP_REASONS = Object.freeze({
  'jsx-external': 'JSX element(s) whose tag resolves outside the repository: the import specifier, or an `export *` the lookup reached, names no repository file (a package, or a path that does not exist): no calls edge is drawn',
  'jsx-unbound': 'JSX element(s) whose tag\'s root name no import and no top-level function or class of the file binds: a parameter, a destructured prop or a local of an enclosing function, a top-level value that is not a function or class (`styled.div`, `memo(...)`), a global, or a tag the parser recovered from a syntax error: no calls edge is drawn',
  'jsx-target-unresolved': 'JSX element(s) whose import resolves to a repository file in which the name has no function or class to point at: the module does not export it, exports a value that is not a function or class (`forwardRef(...)`, an anonymous default), the specifier was not resolved, or the tag names a namespace or a property of a value: no calls edge is drawn',
  'jsx-ambiguous': 'JSX element(s) whose tag resolves to more than one declaration (two `export *` provide the name, or the file declares it twice): no calls edge is drawn',
  'jsx-caller-unresolved': 'JSX element(s) whose target resolves but which no single function node contains (module top level, a class method, which has no function node, or overlapping function ranges): no calls edge is drawn',
});

/** The coverage when the import map has no resolved sources to follow. */
export const JSX_ELEMENTS_NOT_RUN = Object.freeze({ status: 'not-run' });

const UNBOUND = Object.freeze({ kind: 'unbound' });

/**
 * @param {{
 *   rows: Array<{ path: string, imports?: object[], exports?: object[], jsx?: { elements: object[], intrinsic: number } }>,
 *   importMap: { resolvedSources?: object, unresolved?: object },
 *   topLevelDecls: (path: string, name: string) => Array<{ id: string }>,
 *   functionsOf: (path: string) => Array<{ id: string, lineRange: [number, number] }>,
 *   languageOf: (path: string) => string,
 * }} input
 * @returns {{ coverage: object, edges: Array<{ source: string, target: string, file: string, line: number, token: string }>,
 *   gaps: Array<{ kind: string, scope: string, sample: string }> }}
 */
export function resolveJsxElements({ rows, importMap, topLevelDecls, functionsOf, languageOf }) {
  const resolvedSources = importMap?.resolvedSources;
  if (!resolvedSources || typeof resolvedSources !== 'object') {
    return { coverage: JSX_ELEMENTS_NOT_RUN, edges: [], gaps: [] };
  }
  const resolver = createModuleBindingResolver({ rows, importMap, topLevelDecls });

  function resolveTag(path, element) {
    if (element.local === true || element.syntaxError === true) return UNBOUND;
    return resolver.resolveName(path, element.name);
  }

  const coverage = {
    status: 'ran', files: 0, intrinsic: 0, sites: 0,
    edge: 0, external: 0, unbound: 0, targetUnresolved: 0, ambiguous: 0, callerUnresolved: 0,
  };
  const bucketOf = { external: 'external', unbound: 'unbound', unresolved: 'targetUnresolved', 'not-found': 'targetUnresolved', ambiguous: 'ambiguous' };
  const edges = [];
  const gaps = [];
  for (const row of rows) {
    if (!row.jsx) continue;
    coverage.files += 1;
    coverage.intrinsic += row.jsx.intrinsic;
    const scope = languageOf(row.path);
    for (const element of row.jsx.elements) {
      coverage.sites += 1;
      const sample = `${row.path}:${element.line} -> ${element.name}`;
      const result = resolveTag(row.path, element);
      if (result.kind !== 'decls') {
        const bucket = bucketOf[result.kind];
        coverage[bucket] += 1;
        gaps.push({ kind: JSX_GAP_KINDS[bucket], scope, sample });
        continue;
      }
      const callers = [];
      for (const fn of functionsOf(row.path)) {
        if (element.line >= fn.lineRange[0] && element.line <= fn.lineRange[1] && !callers.includes(fn.id)) callers.push(fn.id);
      }
      if (callers.length !== 1) {
        coverage.callerUnresolved += 1;
        gaps.push({ kind: JSX_GAP_KINDS.callerUnresolved, scope, sample });
        continue;
      }
      coverage.edge += 1;
      edges.push({ source: callers[0], target: result.ids[0], file: row.path, line: element.line, token: element.name });
    }
  }
  return { coverage, edges, gaps };
}

/**
 * Every element is one edge or one gap: `sites` equals the edge sites plus
 * the five buckets, and each bucket equals the count recorded under its gap
 * kind. Throws otherwise, so a dropped or misfiled element fails the build.
 */
export function assertJsxConservation(coverage, recorded) {
  const buckets = Object.keys(JSX_GAP_KINDS);
  const problems = [];
  const total = coverage.edge + buckets.reduce((sum, bucket) => sum + coverage[bucket], 0);
  if (total !== coverage.sites) problems.push(`sites=${coverage.sites} but edge+gaps=${total}`);
  for (const bucket of buckets) {
    const kind = JSX_GAP_KINDS[bucket];
    if ((recorded[kind] ?? 0) !== coverage[bucket]) problems.push(`${kind}: coverage ${coverage[bucket]}, recorded ${recorded[kind] ?? 0}`);
  }
  if (problems.length > 0) throw new Error(`JSX element conservation violated: ${problems.join('; ')}`);
}
