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

const NOT_FOUND = Object.freeze({ kind: 'not-found' });
const EXTERNAL = Object.freeze({ kind: 'external' });
const UNRESOLVED = Object.freeze({ kind: 'unresolved' });
const AMBIGUOUS = Object.freeze({ kind: 'ambiguous' });
const UNBOUND = Object.freeze({ kind: 'unbound' });

const declsResult = (decls) => (decls.length === 0 ? UNRESOLVED : { kind: 'decls', ids: decls.map((d) => d.id) });

function sameResult(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'namespace') return a.file === b.file;
  if (a.kind === 'decls') return a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]);
  return true;
}

/** One result from several providers of the same name: equal ones collapse,
 *  different ones are ambiguous. */
function combine(results) {
  const distinct = [];
  for (const result of results) if (!distinct.some((d) => sameResult(d, result))) distinct.push(result);
  if (distinct.length === 0) return NOT_FOUND;
  return distinct.length === 1 ? distinct[0] : AMBIGUOUS;
}

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
  const unresolved = importMap.unresolved ?? {};
  const rowByPath = new Map(rows.map((row) => [row.path, row]));
  const bindingsByPath = new Map();
  const bindingsOf = (path) => {
    let bindings = bindingsByPath.get(path);
    if (bindings) return bindings;
    bindings = new Map();
    for (const imp of rowByPath.get(path)?.imports ?? []) {
      for (const binding of imp.bindings ?? []) bindings.set(binding.local, { source: imp.source, imported: binding.imported });
    }
    bindingsByPath.set(path, bindings);
    return bindings;
  };

  // The module a specifier of `path` names, or why there is none.
  const moduleOf = (path, source) => {
    const target = resolvedSources[path]?.[source];
    if (typeof target === 'string') return { file: target };
    return (unresolved[path] ?? []).includes(source) ? EXTERNAL : UNRESOLVED;
  };

  // `export *` cycles end at the module already being looked into; a result
  // computed past such a cut is not memoized, since it depends on the path.
  const memo = new Map();
  const inProgress = new Set();
  let cuts = 0;

  function resolveImported(path, source, imported) {
    const module = moduleOf(path, source);
    if (!module.file) return module;
    if (imported === '*') return { kind: 'namespace', file: module.file };
    const result = resolveExport(module.file, imported);
    return result === NOT_FOUND ? UNRESOLVED : result;
  }

  // A name as the module's own scope binds it: an import, or a top-level
  // function or class.
  function resolveLocal(path, name) {
    const binding = bindingsOf(path).get(name);
    if (binding) return resolveImported(path, binding.source, binding.imported);
    return declsResult(topLevelDecls(path, name));
  }

  function resolveExport(path, name) {
    const key = `${path}\u0000${name}`;
    if (memo.has(key)) return memo.get(key);
    if (inProgress.has(key)) {
      cuts += 1;
      return NOT_FOUND;
    }
    inProgress.add(key);
    const cutsBefore = cuts;
    const result = lookupExport(path, name);
    inProgress.delete(key);
    if (cuts === cutsBefore) memo.set(key, result);
    return result;
  }

  function lookupExport(path, name) {
    const row = rowByPath.get(path);
    if (!row) return NOT_FOUND;
    // 1. Explicit re-exports: `export { a as name } from`, `export * as name from`.
    const forwarded = [];
    for (const imp of row.imports ?? []) {
      for (const re of imp.reexports ?? []) {
        if (re.exported === name && re.exported !== '*') forwarded.push(resolveImported(path, imp.source, re.imported));
      }
    }
    if (forwarded.length > 0) return combine(forwarded);
    // 2. Local exports, by the name the declaration has in this file.
    const local = [];
    for (const exp of row.exports ?? []) {
      const matches = name === 'default' ? (exp.isDefault === true || exp.name === 'default') : (exp.name === name && exp.isDefault !== true);
      if (!matches) continue;
      const localName = exp.local ?? exp.name;
      local.push(localName === 'default' ? UNRESOLVED : resolveLocal(path, localName));
    }
    if (local.length > 0) return combine(local);
    // 3. `export * from`: never the default export.
    if (name === 'default') return NOT_FOUND;
    const provided = [];
    let externalStar = false;
    for (const imp of row.imports ?? []) {
      if (!(imp.reexports ?? []).some((re) => re.exported === '*')) continue;
      const module = moduleOf(path, imp.source);
      if (!module.file) {
        if (module === EXTERNAL) externalStar = true;
        continue;
      }
      const result = resolveExport(module.file, name);
      if (result !== NOT_FOUND) provided.push(result);
    }
    if (provided.length === 0) return externalStar ? EXTERNAL : NOT_FOUND;
    return combine(provided);
  }

  function resolveTag(path, element) {
    if (element.local === true || element.syntaxError === true) return UNBOUND;
    const [root, ...members] = element.name.split('.');
    const binding = bindingsOf(path).get(root);
    let result;
    if (binding) {
      result = resolveImported(path, binding.source, binding.imported);
    } else {
      const decls = topLevelDecls(path, root);
      result = decls.length > 0 ? declsResult(decls) : UNBOUND;
    }
    for (const member of members) {
      if (result.kind !== 'namespace') {
        // A property of a function, class or value: nothing to point at.
        if (result.kind === 'decls') result = UNRESOLVED;
        break;
      }
      const next = resolveExport(result.file, member);
      result = next === NOT_FOUND ? UNRESOLVED : next;
    }
    if (result.kind === 'namespace') return UNRESOLVED;
    if (result.kind === 'decls' && result.ids.length > 1) return AMBIGUOUS;
    return result;
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
