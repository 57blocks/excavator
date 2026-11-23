// Entry points (openspec: changes/route-entry-points, design D5 and D7).
//
// Core writes, per file, the route registrations (`sites`) and mounts a framework
// rule matched, each with the prefix that is known inside the file and an anchor
// that says where the rest comes from. This stage joins the files: it locates what
// every mount mounts, hands the full path down to the routes anchored on the
// mounted router or route array, and resolves each route's handler to an existing
// node. Nothing here creates a node or an edge; the result is a record stream plus
// coverage and gaps.
//
// Every route lands in exactly one bucket (resolved, path-unresolved,
// prefix-unresolved), every mount in exactly one fate, every entry point's handler
// in exactly one of seven kinds; `assertEntryPointConservation` checks the books.
// A mount-method call that is not a mount (`app.use(cors())`) is a record with
// fate `ignored` and its line, counted in `mounts.ignored`, not in `mounts.total`.
//
// Pure: reads structure rows, the import map and the node index; no disk.

import { resolveBoundCallSite } from './fact-graph-resolve.mjs';

export const ENTRY_POINT_GAP_KINDS = Object.freeze({
  pathUnresolved: 'entry-point-path-unresolved',
  prefixUnresolved: 'entry-point-prefix-unresolved',
  handlerUnresolved: 'entry-point-handler-unresolved',
});

export const ENTRY_POINT_GAP_REASONS = Object.freeze({
  [ENTRY_POINT_GAP_KINDS.pathUnresolved]: 'route registration(s) whose own path, or a path they are registered under inside the file, is not a string literal: the path is kept as written and no path is composed',
  [ENTRY_POINT_GAP_KINDS.prefixUnresolved]: 'route registration(s) on a router or route array that no mount of the repository reaches with a resolvable path (or whose group is a parameter or sits on a mount cycle): the entry point keeps the path written in the file',
  [ENTRY_POINT_GAP_KINDS.handlerUnresolved]: 'entry point(s) whose handler resolved to no single declaration (an unbound name, a callee that is not a plain name, or several candidates)',
});

export const ROUTE_BUCKETS = Object.freeze(['resolved', 'path-unresolved', 'prefix-unresolved']);
export const HANDLER_FATES = Object.freeze(['node', 'module', 'inline', 'external', 'unresolved', 'ambiguous', 'none']);
export const MOUNT_FATES = Object.freeze(['resolved', 'path-unresolved', 'target-unresolved', 'target-external', 'cycle']);

const SEP = String.fromCharCode(31); // cannot appear in a path or a name

const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dirOf = (path) => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

// D4: the join Core uses inside a file, reused across files.
function appendPath(prefix, part) {
  const p = prefix.replace(/\/+$/, '');
  const q = part.replace(/^\/+/, '');
  let r = q === '' ? p : `${p}/${q}`;
  if (!r.startsWith('/')) r = `/${r}`;
  r = r.length > 1 ? r.replace(/\/+$/, '') : r;
  return r === '' ? '/' : r;
}

/**
 * A route's in-file path under a prefix that comes from another file. Core
 * normalizes every literal with a leading slash, so a path written absolute and
 * one written relative are the same string here: both are appended to the
 * prefix, for every join rule.
 */
const joinPaths = (prefix, path) => appendPath(prefix, path);

const groupKey = (file, name) => `${file}${SEP}${name}`;

function emptyFramework() {
  return {
    files: 0,
    sites: 0,
    buckets: { resolved: 0, 'path-unresolved': 0, 'prefix-unresolved': 0 },
    entryPoints: 0,
    handlers: { node: 0, module: 0, inline: 0, external: 0, unresolved: 0, ambiguous: 0, none: 0 },
    mounts: { total: 0, resolved: 0, 'path-unresolved': 0, 'target-unresolved': 0, 'target-external': 0, cycle: 0, ignored: 0 },
  };
}

/** Strongly connected components (Tarjan), in topological order of the condensation. */
function componentsInOrder(nodes, edgesFrom) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;
  const visit = (start) => {
    // Iterative, so a long mount chain cannot exhaust the call stack.
    const work = [{ node: start, next: 0 }];
    index.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const outs = edgesFrom.get(frame.node) ?? [];
      if (frame.next < outs.length) {
        const to = outs[frame.next++];
        if (!index.has(to)) {
          index.set(to, counter);
          low.set(to, counter);
          counter += 1;
          stack.push(to);
          onStack.add(to);
          work.push({ node: to, next: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.node, Math.min(low.get(frame.node), index.get(to)));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        components.push(component);
      }
    }
  };
  for (const node of nodes) if (!index.has(node)) visit(node);
  return components.reverse();
}

/**
 * @param {{
 *   rows: Array<object>,
 *   importMap: { resolvedSources?: object, resolvedPackages?: object, unresolved?: object },
 *   bindingResolver: { resolveName: (path: string, name: string) => object },
 *   declsByPath: Map<string, Array<{ id: string, name: string, type: string, owner?: string|null, line?: number }>>,
 *   fileNodeIdOf: (path: string) => string,
 * }} input
 */
export function resolveEntryPoints({ rows, importMap, bindingResolver, declsByPath, fileNodeIdOf }) {
  const resolvedSources = importMap?.resolvedSources ?? {};
  const resolvedPackages = importMap?.resolvedPackages ?? {};
  const unresolvedSources = importMap?.unresolved ?? {};
  const rowByPath = new Map(rows.map((row) => [row.path, row]));
  const routeRows = rows.filter((row) => row.routes).sort((a, b) => compareStrings(a.path, b.path));

  const nodeById = new Map();
  for (const [path, decls] of declsByPath) {
    for (const decl of decls) nodeById.set(decl.id, { ...decl, file: path });
  }
  // Go packages are directories: the files directly in one, for the lookups below.
  const goFilesByDir = new Map();
  for (const row of rows) {
    if (row.language !== 'go') continue;
    const dir = dirOf(row.path);
    if (!goFilesByDir.has(dir)) goFilesByDir.set(dir, []);
    goFilesByDir.get(dir).push(row.path);
  }

  // -------------------------------------------------------------------------
  // Mount targets: (file, local name) or a visible reason there is none.
  // -------------------------------------------------------------------------
  const bindingsCache = new Map();
  const bindingsOf = (path) => {
    let bindings = bindingsCache.get(path);
    if (bindings) return bindings;
    bindings = new Map();
    for (const imp of rowByPath.get(path)?.imports ?? []) {
      for (const binding of imp.bindings ?? []) bindings.set(binding.local, { source: imp.source, imported: binding.imported });
    }
    bindingsCache.set(path, bindings);
    return bindings;
  };

  const moduleOf = (path, source) => {
    const target = resolvedSources[path]?.[source];
    if (typeof target === 'string') return { file: target };
    return { fate: (unresolvedSources[path] ?? []).includes(source) ? 'target-external' : 'target-unresolved' };
  };

  // The local name a module's export `name` stands for, following `export { a } from`.
  function exportedLocal(path, name, seen) {
    const key = `${path}${SEP}${name}`;
    if (seen.has(key)) return { fate: 'target-unresolved' };
    seen.add(key);
    const row = rowByPath.get(path);
    if (!row) return { fate: 'target-unresolved' };
    for (const imp of row.imports ?? []) {
      for (const re of imp.reexports ?? []) {
        if (re.exported !== name || re.exported === '*') continue;
        const next = moduleOf(path, imp.source);
        if (!next.file) return next;
        if (re.imported === '*') return { fate: 'target-unresolved' };
        return exportedLocal(next.file, re.imported, seen);
      }
    }
    for (const exp of row.exports ?? []) {
      const matches = name === 'default' ? (exp.isDefault === true || exp.name === 'default') : (exp.name === name && exp.isDefault !== true);
      if (!matches) continue;
      const local = exp.local ?? exp.name;
      return local === 'default' ? { fate: 'target-unresolved' } : { file: path, name: local };
    }
    return { fate: 'target-unresolved' };
  }

  function resolveMountTarget(file, target) {
    if (target.kind === 'local') return { file, name: target.name };
    if (target.kind === 'binding') {
      const binding = bindingsOf(file).get(target.name);
      if (!binding) return { fate: 'target-unresolved' };
      const module = moduleOf(file, binding.source);
      if (!module.file) return module;
      if (binding.imported === '*') return { fate: 'target-unresolved' };
      return exportedLocal(module.file, binding.imported, new Set());
    }
    if (target.kind === 'require') {
      const module = moduleOf(file, target.source);
      if (!module.file) return module;
      const exported = rowByPath.get(module.file)?.routes?.exportsValue;
      if (!exported || exported.factory !== target.called) return { fate: 'target-unresolved' };
      return { file: module.file, name: exported.local };
    }
    return { fate: 'target-unresolved' };
  }

  // -------------------------------------------------------------------------
  // Handlers, once per site.
  // -------------------------------------------------------------------------
  const nodeHandler = (id) => {
    const node = nodeById.get(id);
    return { fate: 'node', nodeId: id, ...(node ? { file: node.file } : {}), ...(node?.line === undefined ? {} : { line: node.line }) };
  };

  function resolveGoHandler(file, text) {
    const parts = text.split('.');
    if (parts.length > 2) return { fate: 'unresolved' };
    let dir;
    let name;
    if (parts.length === 2) {
      const [qualifier, member] = parts;
      const imp = (rowByPath.get(file)?.imports ?? []).find((i) => (i.specifiers ?? []).includes(qualifier));
      if (!imp) return { fate: 'unresolved' };
      dir = resolvedPackages[file]?.[imp.source];
      if (dir === undefined) return { fate: 'external' };
      name = member;
    } else {
      dir = dirOf(file);
      name = parts[0];
    }
    const matches = new Map();
    for (const path of goFilesByDir.get(dir) ?? []) {
      for (const decl of declsByPath.get(path) ?? []) {
        if (decl.type === 'function' && decl.name === name && !decl.owner) matches.set(decl.id, decl);
      }
    }
    if (matches.size === 0) return { fate: 'unresolved' };
    if (matches.size > 1) return { fate: 'ambiguous' };
    return nodeHandler([...matches.keys()][0]);
  }

  function resolveHandler(file, row, handler) {
    if (handler === null) return { fate: 'none' };
    const wrapped = handler.wrappedBy === undefined ? {} : { wrappedBy: handler.wrappedBy };
    let result;
    if (handler.kind === 'inline') {
      result = { fate: 'inline', line: handler.line, endLine: handler.endLine };
    } else if (handler.kind === 'other') {
      result = { fate: 'unresolved', text: handler.text };
    } else if (handler.kind === 'module') {
      const module = moduleOf(file, handler.source);
      if (module.file) result = { fate: 'module', nodeId: fileNodeIdOf(module.file), file: module.file };
      else result = { fate: module.fate === 'target-external' ? 'external' : 'unresolved' };
      result.text = handler.source;
    } else if (row.language === 'go') {
      result = { ...resolveGoHandler(file, handler.text), text: handler.text };
    } else {
      const bound = resolveBoundCallSite(bindingResolver, file, { callee: handler.text });
      if (bound.outcome === 'edge') result = nodeHandler(bound.ids[0]);
      else if (bound.outcome === 'calls-ambiguous') result = { fate: 'ambiguous' };
      else result = { fate: bindingResolver.resolveName(file, handler.text).kind === 'external' ? 'external' : 'unresolved' };
      result.text = handler.text;
    }
    return { ...result, ...wrapped };
  }

  // -------------------------------------------------------------------------
  // Collect sites and mounts, resolve targets and handlers.
  // -------------------------------------------------------------------------
  const frameworks = {};
  const framework = (id) => (frameworks[id] ??= emptyFramework());
  const sites = [];
  const mounts = [];
  const ignoredRecords = [];
  for (const row of routeRows) {
    const touched = new Set(row.routes.ignoredMounts.map((ignored) => ignored.framework));
    for (const site of row.routes.sites) {
      touched.add(site.framework);
      const rule = row.routes.rules[site.framework];
      if (!rule) throw new Error(`entry-point-resolution: ${row.path} has a ${site.framework} route and no rule for it`);
      sites.push({ file: row.path, row, site, rule, handler: resolveHandler(row.path, row, site.handler), index: sites.length });
    }
    for (const mount of row.routes.mounts) {
      touched.add(mount.framework);
      const rule = row.routes.rules[mount.framework];
      if (!rule) throw new Error(`entry-point-resolution: ${row.path} has a ${mount.framework} mount and no rule for it`);
      mounts.push({ file: row.path, mount, rule, target: resolveMountTarget(row.path, mount.target) });
    }
    for (const id of touched) framework(id).files += 1;
    for (const ignored of row.routes.ignoredMounts) {
      framework(ignored.framework).mounts.ignored += 1;
      ignoredRecords.push({ kind: 'mount', framework: ignored.framework, file: row.path, line: ignored.line, fate: 'ignored', text: ignored.text });
    }
  }

  // -------------------------------------------------------------------------
  // Groups and edges. A group is a router or route array of a file, named by
  // (file, local name); a mount and a handler mount each hand the group they
  // target the full path of the thing that mounts it.
  // -------------------------------------------------------------------------
  const sourceOf = (file, anchor) => (anchor.kind === 'root' ? null : `${anchor.kind === 'local' ? 'local' : 'parameter'}${SEP}${groupKey(file, anchor.name)}`);
  const localKeyOf = (file, anchor) => (anchor.kind === 'local' ? groupKey(file, anchor.name) : null);

  const groupsWithRoutes = new Set();
  for (const s of sites) {
    const key = localKeyOf(s.file, s.site.anchor);
    if (key) groupsWithRoutes.add(key);
  }
  for (const m of mounts) {
    const key = localKeyOf(m.file, m.mount.anchor);
    if (key) groupsWithRoutes.add(key);
  }

  const defaultLocalOf = (file) => {
    for (const exp of rowByPath.get(file)?.exports ?? []) {
      if (exp.isDefault === true || exp.name === 'default') {
        const local = exp.local ?? exp.name;
        return local === 'default' ? undefined : local;
      }
    }
    return undefined;
  };

  // Handler mounts: only for rules whose paths nest.
  const handlerEdges = [];
  for (const s of sites) {
    if (s.rule.join !== 'nested' || 'unresolved' in s.site.path) continue;
    let target;
    if (s.handler.fate === 'node') {
      const node = nodeById.get(s.handler.nodeId);
      if (node && (node.type === 'function' || node.type === 'class')) target = groupKey(node.file, node.name);
    } else if (s.handler.fate === 'module') {
      const name = defaultLocalOf(s.handler.file);
      if (name !== undefined) target = groupKey(s.handler.file, name);
    }
    if (target && groupsWithRoutes.has(target)) handlerEdges.push({ site: s, target });
  }

  const mountEdges = mounts.filter((m) => m.target.file && !('unresolved' in m.mount.path)).map((m) => ({
    mount: m, target: groupKey(m.target.file, m.target.name),
  }));

  // Graph over groups, for cycles. Only edges that would propagate are in it.
  const edgesFrom = new Map();
  const nodes = new Set();
  const addEdge = (from, to) => {
    nodes.add(to);
    if (from === null) return;
    nodes.add(from);
    if (!edgesFrom.has(from)) edgesFrom.set(from, []);
    edgesFrom.get(from).push(to);
  };
  for (const e of mountEdges) addEdge(localKeyOf(e.mount.file, e.mount.mount.anchor), e.target);
  for (const e of handlerEdges) addEdge(localKeyOf(e.site.file, e.site.site.anchor), e.target);

  const cyclic = new Set();
  const order = [];
  for (const component of componentsInOrder([...nodes].sort(compareStrings), edgesFrom)) {
    const selfLoop = component.length === 1 && (edgesFrom.get(component[0]) ?? []).includes(component[0]);
    if (component.length > 1 || selfLoop) component.forEach((g) => cyclic.add(g));
    order.push(...component.sort(compareStrings));
  }

  // -------------------------------------------------------------------------
  // Prefixes, in topological order: the set of full paths mounted onto a group.
  // -------------------------------------------------------------------------
  const prefixes = new Map();
  const incoming = new Map();
  const pushIncoming = (target, edge) => {
    if (!incoming.has(target)) incoming.set(target, []);
    incoming.get(target).push(edge);
  };
  for (const e of mountEdges) pushIncoming(e.target, { ...e, kind: 'mount' });
  for (const e of handlerEdges) pushIncoming(e.target, { ...e, kind: 'handler' });

  // The full paths a route (site or mount) takes: its in-file path under every prefix of its group.
  const fullPathsOf = (file, anchor, literal) => {
    if (anchor.kind === 'root') return [joinPaths('', literal)];
    const key = localKeyOf(file, anchor);
    if (key === null || cyclic.has(key)) return [];
    return [...(prefixes.get(key) ?? [])].map((prefix) => joinPaths(prefix, literal));
  };

  for (const group of order) {
    if (cyclic.has(group)) continue;
    const set = new Set();
    for (const edge of incoming.get(group) ?? []) {
      if (edge.kind === 'mount') {
        const { mount, file } = edge.mount;
        for (const path of fullPathsOf(file, mount.anchor, mount.path.literal)) set.add(path);
      } else {
        const { site, file } = edge.site;
        for (const path of fullPathsOf(file, site.anchor, site.path.literal)) set.add(path.replace(/\/\*$/, ''));
      }
    }
    prefixes.set(group, set);
  }

  // -------------------------------------------------------------------------
  // Mount fates.
  // -------------------------------------------------------------------------
  const records = [...ignoredRecords];
  const gaps = [];
  for (const m of mounts) {
    const fw = framework(m.mount.framework);
    let fate;
    if (m.target.fate === 'target-external') fate = 'target-external';
    else if (m.target.fate) fate = 'target-unresolved';
    else if ('unresolved' in m.mount.path) fate = 'path-unresolved';
    else if (cyclic.has(localKeyOf(m.file, m.mount.anchor)) || cyclic.has(groupKey(m.target.file, m.target.name))) fate = 'cycle';
    else fate = 'resolved';
    fw.mounts.total += 1;
    fw.mounts[fate] += 1;
    const unresolvedPath = 'unresolved' in m.mount.path;
    records.push({
      kind: 'mount',
      framework: m.mount.framework,
      file: m.file,
      line: m.mount.line,
      path: unresolvedPath ? null : m.mount.path.literal,
      ...(unresolvedPath ? { pathText: m.mount.path.text } : {}),
      fate,
    });
  }

  // -------------------------------------------------------------------------
  // Routes: one bucket each, entry points per bucket.
  // -------------------------------------------------------------------------
  for (const s of sites) {
    const fw = framework(s.site.framework);
    fw.sites += 1;
    const base = {
      kind: 'entry',
      framework: s.site.framework,
      routeKind: s.rule.kind,
      form: s.site.form,
      method: s.site.method,
    };
    const tail = { file: s.file, line: s.site.line };
    const emit = (path, bucket, pathText) => {
      records.push({
        ...base,
        path,
        ...(pathText === undefined ? {} : { pathText }),
        bucket,
        ...tail,
        handler: { ...s.handler },
        source: 'script',
      });
      fw.entryPoints += 1;
      fw.handlers[s.handler.fate] += 1;
    };
    if ('unresolved' in s.site.path) {
      fw.buckets['path-unresolved'] += 1;
      emit(null, 'path-unresolved', s.site.path.text);
      continue;
    }
    const literal = s.site.path.literal;
    const paths = fullPathsOf(s.file, s.site.anchor, literal);
    if (paths.length > 0) {
      fw.buckets.resolved += 1;
      for (const path of [...new Set(paths)].sort(compareStrings)) emit(path, 'resolved');
    } else {
      fw.buckets['prefix-unresolved'] += 1;
      emit(joinPaths('', literal), 'prefix-unresolved');
    }
  }

  records.sort((a, b) => compareStrings(a.kind, b.kind)
    || compareStrings(a.file, b.file)
    || a.line - b.line
    || compareStrings(a.method ?? '', b.method ?? '')
    || compareStrings(a.path ?? a.pathText ?? '', b.path ?? b.pathText ?? ''));

  // Gaps, in record order, so the bounded samples are deterministic.
  const sampleOf = (r) => `${r.file}:${r.line} ${r.method ? `${r.method} ` : ''}${r.path ?? r.pathText}`;
  for (const r of records) {
    if (r.kind !== 'entry') continue;
    if (r.bucket === 'path-unresolved') gaps.push({ kind: ENTRY_POINT_GAP_KINDS.pathUnresolved, scope: r.framework, sample: sampleOf(r) });
    if (r.bucket === 'prefix-unresolved') gaps.push({ kind: ENTRY_POINT_GAP_KINDS.prefixUnresolved, scope: r.framework, sample: sampleOf(r) });
    if (r.handler.fate === 'unresolved' || r.handler.fate === 'ambiguous') {
      gaps.push({ kind: ENTRY_POINT_GAP_KINDS.handlerUnresolved, scope: r.framework, sample: sampleOf(r) });
    }
  }

  // Bucket counts are per route, entry point counts per path: a route under several prefixes is one site.
  const coverage = { status: 'ran', frameworks: Object.fromEntries(Object.entries(frameworks).sort(([a], [b]) => compareStrings(a, b))) };
  return { records, coverage, gaps };
}

/**
 * Every equality of the books (design D7). `gaps` are the recorded gap entries
 * (`{ kind, scope, count }`, a missing count is one).
 *
 * @throws {Error} naming the framework and the two numbers that differ
 */
export function assertEntryPointConservation(coverage, { records, gaps }) {
  const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
  const fail = (id, what, a, b) => {
    throw new Error(`entry-point conservation (${id}): ${what} ${a} != ${b}`);
  };
  const countOf = (kind, scope) => gaps
    .filter((g) => g.kind === kind && g.scope === scope)
    .reduce((n, g) => n + (g.count ?? 1), 0);
  const recordsOf = (kind, id) => records.filter((r) => r.kind === kind && r.framework === id).length;
  for (const r of records) {
    if (!coverage.frameworks[r.framework]) fail(r.framework, 'records of a framework with no coverage', 1, 0);
  }
  for (const [id, fw] of Object.entries(coverage.frameworks)) {
    const buckets = sum(fw.buckets);
    if (fw.sites !== buckets) fail(id, 'sites vs bucket total', fw.sites, buckets);
    const handlers = sum(fw.handlers);
    if (fw.entryPoints !== handlers) fail(id, 'entry points vs handler total', fw.entryPoints, handlers);
    const entries = recordsOf('entry', id);
    if (fw.entryPoints !== entries) fail(id, 'entry points vs entry records', fw.entryPoints, entries);
    const fates = MOUNT_FATES.reduce((n, fate) => n + fw.mounts[fate], 0);
    if (fw.mounts.total !== fates) fail(id, 'mounts vs fate total', fw.mounts.total, fates);
    const mountRecords = recordsOf('mount', id);
    const expectedMountRecords = fw.mounts.total + fw.mounts.ignored;
    if (expectedMountRecords !== mountRecords) fail(id, 'mounts plus ignored mounts vs mount records', expectedMountRecords, mountRecords);
    const pairs = [
      [ENTRY_POINT_GAP_KINDS.pathUnresolved, fw.buckets['path-unresolved']],
      [ENTRY_POINT_GAP_KINDS.prefixUnresolved, fw.buckets['prefix-unresolved']],
      [ENTRY_POINT_GAP_KINDS.handlerUnresolved, fw.handlers.unresolved + fw.handlers.ambiguous],
    ];
    for (const [kind, expected] of pairs) {
      const recorded = countOf(kind, id);
      if (recorded !== expected) fail(id, `${kind} gaps vs ${kind === ENTRY_POINT_GAP_KINDS.handlerUnresolved ? 'unresolved and ambiguous handlers' : 'bucket'}`, recorded, expected);
    }
  }
}
