/**
 * name-reference-resolution.mjs
 *
 * Cross-file resolution of the names expressions write (openspec: changes/
 * name-binding-references, capability `fact-graph`, design D3-D8, D10). The
 * lexers (el-expressions.mjs, xml-name-bindings.mjs) record what pages write
 * and what descriptors declare; this module reads the annotation bindings from
 * the structure rows, divides the repository into deployment units, and decides
 * for each root name which class it names - and when it cannot say, which
 * visible bucket it lands in.
 *
 * Pure and build-free: it reads the catalog, the lexers' output and the
 * structure rows only. It never reads a file.
 *
 * The scope of a name is the deployment unit (D5): a page sees the bindings of
 * its own unit, in the namespaces its expression language sees there. A binding
 * anywhere else is never used to make an edge - it is the `elsewhere` bucket.
 * Nothing falls through to a wider match: no other unit, no other namespace, no
 * first candidate.
 *
 * Every root name has exactly one fate, in this order (D7):
 *   local       declared locally in its file or expression
 *   implicit    an implicit object of the expression language
 *   then, over the bindings in its unit and visible namespaces whose name is
 *   the root or a dotted prefix of its member chain (`#{admin.track.x}`: admin,
 *   admin.track, admin.track.x - dotted names only exist for binders that say
 *   the resolver reads them as namespaces; two different names matching is an
 *   ambiguity). A binding with a name and no target that only configures a
 *   component declared elsewhere gives way to a binding with a known target:
 *   edge        all bind the same repository class node
 *   bundle      all are resource bundles
 *   external    all bind the same class outside the repository
 *   unindexed   all bind the same repository class that has no node
 *   unknown     all have no target
 *   ambiguous   anything else
 *   elsewhere   no such binding, but another unit or namespace has such a name
 *   unbound     no binding anywhere
 * `assertNameReferenceConservation` checks that the fates add up to the root
 * names, and that the gaps recorded for the five gap buckets add up to them.
 *
 * Annotation identity follows Java's scope rules (D3), not the simple name: a
 * `@Named` the file imports from Guice, or one the repository declares in the
 * class's own package, is not the catalog's.
 */

import { DEFAULT_NAME_RULES } from './name-binding-catalog.mjs';
import { indexJavaTypes, resolveClassName } from './mention-resolution.mjs';

/** Same weight as `mentions`: both are extracted from one cited line. */
const REFERENCE_EDGE_WEIGHT = 0.5;

/** The ten fates of a root name, in the order D7 decides them. */
export const NAME_REFERENCE_BUCKETS = Object.freeze([
  'local', 'implicit', 'edge', 'bundle', 'external', 'unindexed', 'unknown', 'ambiguous', 'elsewhere', 'unbound',
]);

/** The buckets that are gaps, and the gap kind each one records. */
export const NAME_REFERENCE_GAP_KINDS = Object.freeze({
  unindexed: 'name-reference-target-unindexed',
  unknown: 'name-reference-target-unknown',
  ambiguous: 'name-reference-ambiguous',
  elsewhere: 'name-reference-elsewhere',
  unbound: 'name-reference-unbound',
});

const EL_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * May this name go into the binding table? An EL identifier does. A dotted name
 * of which every segment is one does only for a binder whose resolver reads
 * dotted names as namespaces (`namespacedNames`); for any other binder it
 * cannot be reached from EL, which looks a name up whole.
 */
const isBindableName = (name, binder) =>
  EL_IDENTIFIER.test(name) || (binder.namespacedNames && name.includes('.') && name.split('.').every((segment) => EL_IDENTIFIER.test(segment)));

/** The names a root with this member chain can reach: the root, and each dotted prefix of the chain. */
function candidateNames(root) {
  const segments = (root.chain ?? root.token).split('.');
  return segments.map((_, i) => segments.slice(0, i + 1).join('.'));
}
const DOTTED_NAME = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const lastSegment = (name) => name.slice(name.lastIndexOf('.') + 1);
const dirOf = (path) => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

/**
 * Fail-closed check that every root name landed in exactly one bucket, and that
 * the gaps recorded for the gap buckets add up to them.
 *
 * @param {{ roots: Record<string, number>, rootCount: number }} coverage
 *   the `coverage.nameReferences` section of a run
 * @param {{ unindexed: number, unknown: number, ambiguous: number, elsewhere: number, unbound: number }} gapCounts
 *   the counts read back from the recorded gaps
 */
export function assertNameReferenceConservation(coverage, gapCounts) {
  const { roots, rootCount } = coverage;
  const total = NAME_REFERENCE_BUCKETS.reduce((sum, bucket) => sum + roots[bucket], 0);
  if (total !== rootCount) {
    throw new Error(`name-reference-resolution: ${rootCount} root name(s) but ${total} outcome(s)`);
  }
  for (const [bucket, kind] of Object.entries(NAME_REFERENCE_GAP_KINDS)) {
    if (roots[bucket] !== gapCounts[bucket]) {
      throw new Error(`name-reference-resolution: ${roots[bucket]} ${kind} outcome(s) but ${gapCounts[bucket]} recorded gap occurrence(s)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Deployment units (D5)
// ---------------------------------------------------------------------------

/**
 * The deployment unit of a file: the nearest ancestor directory (its own
 * included) that holds one of the descriptor files, or null - the repository
 * unit - when there is none. The root directory is a unit (`''`) only when it
 * holds a descriptor itself.
 *
 * @param {Iterable<string>} manifestPaths the manifest's files: a descriptor the scan did not keep is no descriptor
 * @param {string[]} descriptorNames file names that make a directory a unit
 * @returns {{ unitOf(path: string): string|null }}
 */
export function createUnitIndex(manifestPaths, descriptorNames) {
  const names = new Set(descriptorNames);
  const unitDirs = new Set();
  for (const path of manifestPaths) {
    if (names.has(path.slice(path.lastIndexOf('/') + 1))) unitDirs.add(dirOf(path));
  }
  const cache = new Map();
  return {
    unitOf(path) {
      const start = dirOf(path);
      if (cache.has(start)) return cache.get(start);
      let unit = null;
      for (let dir = start; ; dir = dirOf(dir)) {
        if (unitDirs.has(dir)) {
          unit = dir;
          break;
        }
        if (dir === '') break;
      }
      cache.set(start, unit);
      return unit;
    },
  };
}

const unitKey = (unit) => (unit === null ? 'repository' : `unit:${unit}`);
const unitLabel = (unit) => (unit === null ? '(repository)' : unit === '' ? '.' : unit);

// ---------------------------------------------------------------------------
// Binding targets
// ---------------------------------------------------------------------------

/**
 * A target is `{ kind, key, labels }`: `key` is what makes two targets the same
 * one, `labels` is what a gap sample names.
 *   node        a repository class with a node
 *   unindexed   a repository class that has no node
 *   external    a class outside the repository
 *   bundle      a resource bundle
 *   unknown     no target text
 *   ambiguous   a class name that several declarations carry
 */
const nodeTarget = (id, path, name) => ({ kind: 'node', key: `node:${id}`, id, labels: [`${path}#${name}`] });
const unindexedTarget = (type) => ({ kind: 'unindexed', key: `unindexed:${type}`, labels: [type] });

function xmlTarget(target, { typesByFqn, otherJvm, declaredJavaTypes }) {
  if (target === null) return { kind: 'unknown', key: 'unknown', labels: ['(no target)'] };
  if (target.kind === 'bundle') return { kind: 'bundle', key: 'bundle', labels: [`bundle ${target.text}`] };
  const found = resolveClassName(target.text, typesByFqn, otherJvm, declaredJavaTypes, {});
  if (found.kind === 'external') return { kind: 'external', key: `external:${target.text}`, labels: [`${target.text} (outside the repository)`] };
  if (found.kind === 'unindexed') return unindexedTarget(found.type);
  const { declarations } = found;
  if (declarations.length === 1) {
    const [declaration] = declarations;
    return declaration.id != null ? nodeTarget(declaration.id, declaration.path, lastSegment(declaration.fqn)) : unindexedTarget(declaration.fqn);
  }
  const labels = declarations.map((d) => `${d.path}#${lastSegment(d.fqn)}`).sort(compareText);
  return { kind: 'ambiguous', key: `ambiguous:${labels.join('|')}`, labels };
}

// ---------------------------------------------------------------------------
// Annotation bindings (D3, D4)
// ---------------------------------------------------------------------------

/** The imports of a Java file that decide what a simple annotation name is. */
function importsOf(row) {
  const singles = new Map(); // simple name -> Set of qualified names
  const onDemand = new Set();
  for (const imp of row.imports ?? []) {
    if (imp.static === true || !DOTTED_NAME.test(imp.source)) continue;
    if (imp.specifiers?.length === 1 && imp.specifiers[0] === '*') {
      onDemand.add(imp.source);
    } else {
      const simple = lastSegment(imp.source);
      if (!singles.has(simple)) singles.set(simple, new Set());
      singles.get(simple).add(imp.source);
    }
  }
  return { singles, onDemand };
}

/**
 * Annotation bindings of every Java type, with the counts of what was not one.
 * A written annotation `W` in package `P` is, in order (D3): the qualified name
 * as written; the single-type import `x.W`; a type the repository declares as
 * `P.W` (which shadows an on-demand import); the one on-demand import `p.*`
 * that provides a catalog annotation `p.W`. Anything else is not confirmed.
 */
function annotationBindings({ catalog, javaRows, classIds, typesByFqn, otherJvm, declaredJavaTypes, unitOf, mutations, tally }) {
  const binderByFqn = new Map();
  const firstBySimple = new Map();
  for (const binder of catalog.annotationBinders) {
    for (const fqn of binder.annotations) {
      binderByFqn.set(fqn, binder);
      if (!firstBySimple.has(lastSegment(fqn))) firstBySimple.set(lastSegment(fqn), binder);
    }
  }

  const declaredInPackage = (pkg, simple) => {
    if (typesByFqn.has(pkg ? `${pkg}.${simple}` : simple)) return true;
    return pkg !== '' && (declaredJavaTypes.isType(pkg, simple) || otherJvm.isType(pkg, simple));
  };

  const bindings = [];
  for (const row of javaRows) {
    const imports = importsOf(row);
    const unit = unitOf(row.path);
    (row.classes ?? []).forEach((cls, index) => {
      if (typeof cls.qualifiedName !== 'string') return;
      const pkg = cls.qualifiedName.endsWith(`.${cls.name}`) ? cls.qualifiedName.slice(0, -(cls.name.length + 1)) : '';
      for (const use of cls.annotationArguments ?? []) {
        let binder = null;
        if (use.name.includes('.')) {
          binder = binderByFqn.get(use.name) ?? null; // written qualified: it is that name
        } else if (firstBySimple.has(use.name)) {
          if (mutations.simpleNameAnnotations) {
            // Tripwire seam: the simple name alone is taken for the catalog's.
            binder = firstBySimple.get(use.name);
          } else if (imports.singles.has(use.name)) {
            const imported = imports.singles.get(use.name);
            binder = imported.size === 1 ? binderByFqn.get([...imported][0]) ?? null : undefined;
          } else if (declaredInPackage(pkg, use.name)) {
            binder = null; // the repository's own type of that name: no binding, and not a failed confirmation
          } else {
            const providers = [...imports.onDemand].filter((p) => binderByFqn.has(`${p}.${use.name}`));
            binder = providers.length === 1 ? binderByFqn.get(`${providers[0]}.${use.name}`) : undefined;
          }
          if (binder === undefined) {
            tally.unconfirmed[use.name] = (tally.unconfirmed[use.name] ?? 0) + 1;
            continue;
          }
        }
        if (binder === null) continue;

        const named = nameOf(binder, use, cls);
        if (named === null) {
          tally.nonLiteralNames += 1;
          continue;
        }
        if (named === undefined) {
          tally.missingNames[binder.id] += 1;
          continue;
        }
        if (!isBindableName(named, binder)) {
          tally.nonIdentifierNames += 1;
          continue;
        }
        const id = classIds.get(row.path)?.[index] ?? null;
        bindings.push({
          unit,
          namespace: binder.namespace,
          name: named,
          binder: binder.id,
          file: row.path,
          line: use.line,
          target: id != null ? nodeTarget(id, row.path, cls.name) : unindexedTarget(cls.qualifiedName),
        });
      }
    });
  }
  return bindings;
}

/**
 * The name an annotation gives its class: the string literal of the first of
 * the binder's name arguments that is written; the binder's default-name rule
 * when it is written empty or not at all. `null`: the argument is not a string
 * literal. `undefined`: no name written and the binder has no default.
 */
function nameOf(binder, use, cls) {
  const written = binder.nameArguments.map((key) => use.arguments.find((argument) => argument.key === key)).find(Boolean);
  if (written && written.value === null) return null;
  if (written && written.value !== '') return written.value;
  return binder.defaultName === null ? undefined : DEFAULT_NAME_RULES[binder.defaultName](cls.name);
}

// ---------------------------------------------------------------------------
// Resolution of the expression files
// ---------------------------------------------------------------------------

function evidenceOrder(a, b) {
  return a.line - b.line || compareText(a.token, b.token) || compareText(a.chain, b.chain) || compareText(a.name, b.name);
}

function bindingOrder(a, b) {
  return compareText(a.file, b.file) || a.line - b.line || compareText(a.binder, b.binder);
}

/**
 * The fate of the bindings a root name found in its unit, as `{ bucket, target?, labels }`.
 * `edge` carries the class node.
 */
function classify(all) {
  // A name that only configures a component gives way when another binding has a target.
  const bindings = all.some((binding) => binding.target.kind !== 'unknown') ? all.filter((binding) => !binding.configures) : all;
  const [first] = bindings;
  const agree = bindings.every((binding) => binding.target.key === first.target.key);
  if (agree && first.target.kind !== 'ambiguous') {
    const bucket = { node: 'edge', bundle: 'bundle', external: 'external', unindexed: 'unindexed', unknown: 'unknown' }[first.target.kind];
    return { bucket, target: first.target, labels: first.target.labels };
  }
  const labels = [...new Set(bindings.flatMap((binding) => binding.target.labels))].sort(compareText);
  return { bucket: 'ambiguous', labels };
}

/**
 * @param {{
 *   sites: { files: object[], bindings: object[], missingNames: Record<string, number>, conditions: object[], outsideFiles: Record<string, number> },
 *   catalog: object,
 *   manifestPaths: Iterable<string>,
 *   javaRows: object[],
 *   classIds: Map<string, Array<string|null>>,
 *   javaTypes: Array<{ fqn: string, path: string, id: string|null }>,
 *   otherJvm: { isType(pkg: string, name: string): boolean },
 *   declaredJavaTypes: { isType(pkg: string, name: string): boolean },
 *   fileIdOf: (path: string) => string,
 *   languageOf?: (path: string) => string|undefined,
 *   mutations?: { ignoreUnits?: boolean, noLocals?: boolean, bindingsBeforeImplicit?: boolean, firstBinding?: boolean, simpleNameAnnotations?: boolean, ignoreSeesConditions?: boolean, shortestPrefix?: boolean },
 * }} args
 *   `sites` is the output of name-reference-sites.mjs. `javaRows` are the
 *   structure rows of the Java files, `classIds` the node ids of their `classes`
 *   entries index for index (null where an id is shared with another declaration
 *   and so names no node). `javaTypes`, `otherJvm` and `declaredJavaTypes` are
 *   the type dictionaries mention-resolution.mjs reads. `mutations` is a test
 *   seam for the mutation tripwires (design D12); production callers leave it
 *   empty.
 * @returns {{
 *   edges: object[],
 *   gaps: Array<{ kind: string, scope: string, sample: string }>,
 *   coverage: object,
 * }}
 */
export function resolveNameReferences({
  sites, catalog, manifestPaths, javaRows, classIds, javaTypes, otherJvm, declaredJavaTypes, fileIdOf, languageOf = () => undefined, mutations = {},
}) {
  const manifest = new Set(manifestPaths);
  const { unitOf } = createUnitIndex(manifest, catalog.unitDescriptors);
  const languages = new Map(catalog.expressionLanguages.map((language) => [language.id, language]));
  const xmlBinders = new Map(catalog.xmlBinders.map((binder) => [binder.id, binder]));
  const typesByFqn = indexJavaTypes(javaTypes);
  const targetContext = { typesByFqn, otherJvm, declaredJavaTypes };

  const allBinders = [...catalog.xmlBinders, ...catalog.annotationBinders];
  const tally = {
    nonLiteralNames: 0,
    nonIdentifierNames: 0,
    missingNames: Object.fromEntries(allBinders.map((binder) => [binder.id, 0])),
    unconfirmed: {},
  };
  const table = annotationBindings({ catalog, javaRows, classIds, typesByFqn, otherJvm, declaredJavaTypes, unitOf, mutations, tally });

  for (const [binderId, count] of Object.entries(sites.missingNames ?? {})) {
    if (!xmlBinders.has(binderId)) throw new Error(`name-reference-resolution: names missing for the binder ${JSON.stringify(binderId)}, which the catalog does not have`);
    tally.missingNames[binderId] += count;
  }
  for (const site of sites.bindings) {
    const binder = xmlBinders.get(site.binder);
    if (!binder) throw new Error(`name-reference-resolution: binding of the binder ${JSON.stringify(site.binder)}, which the catalog does not have`);
    if (!manifest.has(site.file)) throw new Error(`name-reference-resolution: name binding in a file outside the manifest: ${site.file}`);
    if (site.missingTarget !== 'unknown' && site.missingTarget !== 'configures') {
      throw new Error(`name-reference-resolution: binding in ${site.file} says ${JSON.stringify(site.missingTarget)} for a missing target`);
    }
    if (!isBindableName(site.name, binder)) {
      tally.nonIdentifierNames += 1;
      continue;
    }
    table.push({
      unit: unitOf(site.file),
      namespace: binder.namespace,
      name: site.name,
      binder: binder.id,
      file: site.file,
      line: site.line,
      target: xmlTarget(site.target, targetContext),
      // A name with no target that only configures a component declared elsewhere.
      configures: site.target === null && site.missingTarget === 'configures',
    });
  }

  const byName = new Map();
  const bindingCounts = Object.fromEntries(allBinders.map((binder) => [binder.id, 0]));
  const units = new Set();
  for (const binding of table) {
    if (!byName.has(binding.name)) byName.set(binding.name, []);
    byName.get(binding.name).push(binding);
    bindingCounts[binding.binder] += 1;
    units.add(unitKey(binding.unit));
  }

  // What each unit's expression language sees: the namespaces with no condition,
  // and those whose condition a descriptor of the unit meets.
  const conditionMet = new Set(sites.conditions.map((c) => `${unitKey(unitOf(c.file))}|${c.expressionLanguage}|${c.namespace}`));
  const visibleCache = new Map();
  const visibleNamespaces = (unit, language) => {
    const key = `${unitKey(unit)}|${language.id}`;
    if (!visibleCache.has(key)) {
      const visible = new Set();
      for (const entry of language.sees) {
        // Tripwire seam: every namespace visible whatever its condition.
        if (!entry.when || mutations.ignoreSeesConditions || conditionMet.has(`${key}|${entry.namespace}`)) visible.add(entry.namespace);
      }
      visibleCache.set(key, visible);
    }
    return visibleCache.get(key);
  };

  const edges = [];
  const gaps = [];
  const files = {};
  const roots = Object.fromEntries(NAME_REFERENCE_BUCKETS.map((bucket) => [bucket, 0]));
  let rootCount = 0;
  let implicitWithBinding = 0;
  let repositoryUnitFiles = 0;
  let escaped = 0;
  let unterminated = 0;
  let unscanned = 0;
  const rowFiles = new Set();

  for (const site of sites.files) {
    const file = site.file;
    if (!manifest.has(file)) throw new Error(`name-reference-resolution: name-reference site for a file outside the manifest: ${file}`);
    if (rowFiles.has(file)) throw new Error(`name-reference-resolution: more than one row for ${file}`);
    rowFiles.add(file);
    const language = languages.get(site.expressionLanguage);
    if (!language) throw new Error(`name-reference-resolution: ${file} is read with the expression language ${JSON.stringify(site.expressionLanguage)}, which the catalog does not have`);

    const unit = unitOf(file);
    const scope = languageOf(file) ?? site.language ?? 'unknown';
    files[scope] = (files[scope] ?? 0) + 1;
    units.add(unitKey(unit));
    if (unit === null) repositoryUnitFiles += 1;
    escaped += site.escaped;
    unterminated += site.unterminated;
    if (!Number.isInteger(site.unscanned)) throw new Error(`name-reference-resolution: the row of ${file} has no unscanned count`);
    unscanned += site.unscanned;
    const visible = visibleNamespaces(unit, language);
    const implicit = new Set(language.implicitNames);

    const byTarget = new Map(); // class id -> evidence of this file
    const gap = (bucket, root, labels) => {
      gaps.push({ kind: NAME_REFERENCE_GAP_KINDS[bucket], scope, sample: `${file}:${root.line} ${root.token} -> [${labels.join(', ')}]` });
    };

    for (const root of site.roots) {
      rootCount += 1;
      // Tripwire seam: a local name is not told from any other name.
      if (root.local && !mutations.noLocals) {
        roots.local += 1;
        continue;
      }
      const isImplicit = implicit.has(root.token);
      // Tripwire seam: the unit is not a boundary.
      const isVisible = (binding) => (mutations.ignoreUnits || binding.unit === unit) && visible.has(binding.namespace);
      // Tripwire seam: bindings consulted before the implicit objects.
      if (isImplicit && !mutations.bindingsBeforeImplicit) {
        roots.implicit += 1;
        if ((byName.get(root.token) ?? []).some(isVisible)) implicitWithBinding += 1;
        continue;
      }

      const candidates = candidateNames(root);
      const named = candidates.flatMap((candidate) => byName.get(candidate) ?? []);
      let here = named.filter(isVisible);
      const names = [...new Set(here.map((binding) => binding.name))];
      if (names.length > 1 && mutations.shortestPrefix) {
        // Tripwire seam: of several names that match, the shortest wins.
        here = here.filter((binding) => binding.name === candidates.find((candidate) => names.includes(candidate)));
      }
      if (names.length > 1 && !mutations.shortestPrefix) {
        // The resolver that answers first cannot be told statically.
        roots.ambiguous += 1;
        gap('ambiguous', root, [...new Set(here.flatMap((b) => b.target.labels.map((label) => `${b.name} -> ${label}`)))].sort(compareText));
        continue;
      }
      if (here.length > 0) {
        let fate = classify(here);
        let used = here;
        // Tripwire seam: an ambiguous name resolves to its first binding.
        if (fate.bucket === 'ambiguous' && mutations.firstBinding) {
          used = [here[0]];
          fate = classify(used);
        }
        roots[fate.bucket] += 1;
        if (fate.bucket === 'edge') {
          const targetId = fate.target.id;
          if (!byTarget.has(targetId)) byTarget.set(targetId, []);
          byTarget.get(targetId).push({
            file,
            line: root.line,
            source: 'lexical',
            token: root.token,
            chain: root.chain,
            name: used[0].name,
            bindings: used.map((b) => ({ file: b.file, line: b.line, binder: b.binder })).sort(bindingOrder),
          });
        } else if (fate.bucket === 'unknown') {
          gap('unknown', root, [...new Set(used.map((b) => `${b.file}:${b.line}`))].sort(compareText));
        } else if (fate.bucket !== 'bundle' && fate.bucket !== 'external') {
          gap(fate.bucket, root, fate.labels);
        }
        continue;
      }
      if (isImplicit) {
        roots.implicit += 1;
        continue;
      }
      if (named.length > 0) {
        roots.elsewhere += 1;
        gap('elsewhere', root, [...new Set(named.map((b) => `${unitLabel(b.unit)} [${b.namespace}]`))].sort(compareText));
      } else {
        roots.unbound += 1;
        gap('unbound', root, []);
      }
    }

    for (const [targetId, evidence] of byTarget) {
      const unique = new Map(evidence.map((entry) => [JSON.stringify([entry.line, entry.token, entry.chain, entry.name]), entry]));
      edges.push({
        source: fileIdOf(file),
        target: targetId,
        type: 'references',
        direction: 'forward',
        weight: REFERENCE_EDGE_WEIGHT,
        evidence: [...unique.values()].sort(evidenceOrder),
        provenance: 'extracted',
      });
    }
  }

  const coverage = {
    status: 'ran',
    files,
    units: units.size,
    repositoryUnitFiles,
    bindings: bindingCounts,
    nonLiteralNames: tally.nonLiteralNames,
    missingNames: tally.missingNames,
    nonIdentifierNames: tally.nonIdentifierNames,
    unconfirmedAnnotations: Object.fromEntries(Object.entries(tally.unconfirmed).sort(([a], [b]) => compareText(a, b))),
    roots,
    rootCount,
    implicitWithBinding,
    escaped,
    unterminated,
    unscanned,
    outsideFiles: { ...sites.outsideFiles },
  };
  return { edges, gaps, coverage };
}
