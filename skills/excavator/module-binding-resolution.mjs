// Module bindings (openspec: changes/jsx-element-references,
// changes/import-binding-call-scope).
//
// What a name written in a TS/JS file refers to, by the file's own scope:
// an import binding followed through the import map to its module and that
// module's exports (re-exports, local exports, `export *`), or a top-level
// function or class of the file. Never a same-name search. JSX elements and
// call sites both resolve their names here.
//
// Pure: reads structure rows and the import map, writes nothing.

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
 *   rows: Array<{ path: string, imports?: object[], exports?: object[] }>,
 *   importMap: { resolvedSources?: object, unresolved?: object },
 *   topLevelDecls: (path: string, name: string) => Array<{ id: string }>,
 * }} input
 * @returns {{ resolveName: (path: string, name: string) => object }}
 */
export function createModuleBindingResolver({ rows, importMap, topLevelDecls }) {
  const resolvedSources = importMap?.resolvedSources ?? {};
  const unresolved = importMap?.unresolved ?? {};
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

  /**
   * What `name` (`X` or `X.Y.Z`) written in `path` refers to. The root is
   * looked up in the file's own scope: an import binding, else a top-level
   * function or class, else nothing (`unbound`). Each further segment is
   * read only as an export of a namespace; after a function, class or value
   * it points at nothing. A namespace itself, or several declarations, is
   * not one target.
   * @returns {{ kind: 'decls', ids: string[] } | { kind: 'external' | 'unresolved' | 'ambiguous' | 'unbound' }}
   */
  function resolveName(path, name) {
    const [root, ...members] = name.split('.');
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

  return { resolveName };
}
