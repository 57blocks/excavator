/**
 * mention-resolution.mjs
 *
 * Cross-file resolution of name mentions (openspec: changes/name-mention-facts,
 * capability `fact-graph`, design D4-D6). The lexer (text-mentions.mjs) records
 * what a non-code file writes: class-name-shaped tokens and path-shaped
 * tokens. This module decides, for each candidate, which repository class or
 * file it names - and when it cannot say, which visible bucket it lands in.
 *
 * Pure and build-free: it compares tokens against the manifest's file paths,
 * the files the scanner skipped and the repository's Java type declarations
 * only. It never reads a file and never touches the filesystem, so a `../`
 * that climbs out of the repository simply resolves to nothing.
 *
 * "Unindexed" means the repository has the thing and the index has no node
 * for it. It is only ever said of something grounded in what the repository
 * holds: a declaration a source file makes by its own `package` and name, a
 * Kotlin/Scala type, a file the scanner skipped. Never of a name that merely
 * looks like one.
 *
 * Every candidate has exactly one fate:
 *   class-name: edge | ambiguous | unindexed (a declaration in the repository
 *               that is not a class node: a Kotlin/Scala type, a Java
 *               annotation type) | external
 *   path:       edge | ambiguous | unresolved | self | unindexed (a file the
 *               scanner skipped: too large, binary, ...)
 * `assertMentionConservation` checks that the fates add up to the candidates.
 * Counts are candidate occurrences; a pattern that matches ten files is one
 * edge site (and ten edges).
 */

import { posix } from 'node:path';

// Edge shape (D6): one edge per (mentioning file, target); the evidence lists
// every mention of that target in that file.
const MENTION_EDGE_WEIGHT = 0.5;

const dirOf = (path) => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

/**
 * The scanner's per-file skip reasons that mean "the file is in the
 * repository, the scanner did not process it". Ignore rules, default filters
 * and sensitive-file rules are policy exclusions and are not targets.
 */
export const TARGET_SKIP_REASONS = Object.freeze(['too-large', 'binary', 'unknown-language', 'read-failed', 'symlink']);

/**
 * Fail-closed check that every candidate landed in exactly one fate, and that
 * the gaps recorded for them add up to the same buckets.
 *
 * @param {{ fqn: Record<string, number>, path: Record<string, number> }} mentions
 *   the `coverage.mentions` section of a run
 * @param {{ ambiguous: number, unindexed: number, unresolved: number }} gapCounts
 *   the counts read back from the recorded gaps
 */
export function assertMentionConservation(mentions, gapCounts) {
  const { fqn, path } = mentions;
  const fqnTotal = fqn.edge + fqn.ambiguous + fqn.unindexed + fqn.external;
  if (fqnTotal !== fqn.candidates) {
    throw new Error(`mention-resolution: ${fqn.candidates} class-name candidate(s) but ${fqnTotal} outcome(s)`);
  }
  const pathTotal = path.edge + path.ambiguous + path.unresolved + path.self + path.unindexed;
  if (pathTotal !== path.candidates) {
    throw new Error(`mention-resolution: ${path.candidates} path candidate(s) but ${pathTotal} outcome(s)`);
  }
  const readBack = {
    'mention-ambiguous': [fqn.ambiguous + path.ambiguous, gapCounts.ambiguous],
    'mention-target-unindexed': [fqn.unindexed + path.unindexed, gapCounts.unindexed],
    'path-mention-unresolved': [path.unresolved, gapCounts.unresolved],
  };
  for (const [kind, [counted, recorded]] of Object.entries(readBack)) {
    if (counted !== recorded) {
      throw new Error(`mention-resolution: ${counted} ${kind} outcome(s) but ${recorded} recorded gap occurrence(s)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Class names (D4)
// ---------------------------------------------------------------------------

/**
 * Longest prefix of at least two segments that names a Java top-level type;
 * `$` is a nesting separator. Nested types are not nodes, so `Outer$Inner`
 * and `Outer.CONSTANT` both name `Outer`.
 */
export function resolveClassName(token, typesByFqn, otherJvm, declaredJavaTypes, mutations) {
  const segments = token.replace(/\$/g, '.').split('.');
  const lengths = [];
  for (let k = segments.length; k >= 2; k--) lengths.push(k);
  // Tripwire seam: the shortest prefix instead of the longest.
  if (mutations.shortestPrefix) lengths.reverse();

  for (const k of lengths) {
    const declarations = typesByFqn.get(segments.slice(0, k).join('.'));
    if (declarations) return { kind: 'repo', declarations };
  }
  // The dictionary is silent about a declaration that is not a class node. One
  // that exists in the repository can only be unknown, never "outside": a
  // Kotlin or Scala type (by source directory and file name), or a Java file
  // the extraction made no class entry for (an annotation type), by the
  // `package` the file declares and its file name.
  for (const k of lengths) {
    const pkg = segments.slice(0, k - 1).join('.');
    const name = segments[k - 1];
    // Tripwire seam: declared Java types not consulted.
    const declared = !mutations.noJavaFileIndex && declaredJavaTypes.isType(pkg, name);
    if (otherJvm.isType(pkg, name) || declared) return { kind: 'unindexed', type: `${pkg}.${name}` };
  }
  return { kind: 'external' };
}

/**
 * The dictionary `resolveClassName` reads: every Java top-level type
 * declaration by its fully-qualified name (a name declared twice has two
 * entries).
 *
 * @param {Array<{ fqn: string, path: string, id: string|null }>} javaTypes
 * @returns {Map<string, Array<{ fqn: string, path: string, id: string|null }>>}
 */
export function indexJavaTypes(javaTypes) {
  const typesByFqn = new Map();
  for (const type of javaTypes) {
    if (!typesByFqn.has(type.fqn)) typesByFqn.set(type.fqn, []);
    typesByFqn.get(type.fqn).push(type);
  }
  return typesByFqn;
}

/**
 * The Java types that source files declare by their own `package` and file
 * name, for files the type dictionary has no entry for.
 *
 * @param {Array<{ file: string, package: string }>} declarations
 * @returns {{ isType(pkg: string, name: string): boolean }}
 */
export function createDeclaredJavaTypeIndex(declarations) {
  const declared = new Set();
  for (const { file, package: pkg } of declarations) {
    const name = file.slice(file.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
    declared.add(`${pkg}.${name}`);
  }
  return { isType: (pkg, name) => declared.has(`${pkg}.${name}`) };
}

// ---------------------------------------------------------------------------
// Paths (D5)
// ---------------------------------------------------------------------------

function stripLeadingRelative(path) {
  let rest = path;
  for (;;) {
    if (rest.startsWith('/')) rest = rest.slice(1);
    else if (rest.startsWith('./')) rest = rest.slice(2);
    else if (rest.startsWith('../')) rest = rest.slice(3);
    else return rest;
  }
}

/** `base/rel` normalized, or null when it climbs out of the repository root. */
function joinInside(base, rel) {
  const tail = rel.replace(/^\/+/, '');
  const joined = posix.normalize(base ? `${base}/${tail}` : tail);
  if (joined === '.' || joined === '..' || joined.startsWith('../') || joined.startsWith('/') || joined.endsWith('/')) return null;
  return joined;
}

const escapeRegex = (text) => text.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');

/** Ant-style glob as a regex source: `*` stays inside a segment, a whole `**` segment spans segments. */
function globSource(glob) {
  const segments = glob.split('/');
  let source = '';
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === '**') {
      source += last ? '.*' : '(?:[^/]+/)*';
      return;
    }
    source += segment.split('*').map(escapeRegex).join('[^/]*') + (last ? '' : '/');
  });
  return source;
}

/**
 * The files a path can name: the manifest's, and the ones the scanner skipped
 * (`skippedFiles`, each with its reason). Web roots come from the manifest's
 * files alone.
 */
function createPathIndex(manifestPaths, skippedFiles) {
  const manifest = [...manifestPaths];
  const manifestSet = new Set(manifest);
  const skippedReason = new Map(skippedFiles.map((entry) => [entry.path, entry.reason]));
  const paths = [...manifest, ...skippedReason.keys()];
  const pathSet = new Set(paths);
  const byBasename = new Map();
  const webRoots = new Set();
  for (const path of paths) {
    const base = path.slice(path.lastIndexOf('/') + 1);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(path);
  }
  for (const path of manifest) {
    // `<dir>/WEB-INF/...` makes <dir> a web root (the repository root is '').
    if (path.startsWith('WEB-INF/')) webRoots.add('');
    for (let i = path.indexOf('/WEB-INF/'); i >= 0; i = path.indexOf('/WEB-INF/', i + 1)) webRoots.add(path.slice(0, i));
  }

  const rootCache = new Map();
  /** The nearest ancestor directory of `file` that is a web root, or null. */
  function webRootOf(file) {
    const start = dirOf(file);
    if (rootCache.has(start)) return rootCache.get(start);
    let found = null;
    for (let dir = start; ; dir = dirOf(dir)) {
      if (webRoots.has(dir)) {
        found = dir;
        break;
      }
      if (dir === '') break;
    }
    rootCache.set(start, found);
    return found;
  }

  const globCache = new Map();
  /** Every known path matching `glob` - from the start of the path, or as a segment-aligned suffix. */
  function matchGlob(glob, suffix) {
    const key = `${suffix ? 's' : 'a'}|${glob}`;
    if (globCache.has(key)) return globCache.get(key);
    const regex = new RegExp(`${suffix ? '(?:^|/)' : '^'}${globSource(glob)}$`);
    const literalDirs = glob.split('/').slice(0, -1).filter(Boolean);
    const literal = [];
    for (const segment of literalDirs) {
      if (segment.includes('*')) break;
      literal.push(segment);
    }
    const anchor = literal.length > 0 && !suffix ? `${literal.join('/')}/` : '';
    const hits = paths.filter((path) => path.startsWith(anchor) && regex.test(path));
    globCache.set(key, hits);
    return hits;
  }

  /** Every known path ending with `tail` at a segment boundary. */
  function matchSuffix(tail) {
    const base = tail.slice(tail.lastIndexOf('/') + 1);
    return (byBasename.get(base) ?? []).filter((path) => path === tail || path.endsWith(`/${tail}`));
  }

  return { manifestSet, pathSet, skippedReason, webRootOf, matchGlob, matchSuffix };
}

/**
 * Resolve one path candidate to the files it names, by the first rule that
 * has a hit: web root, mentioning file's directory, web-root fallback, then -
 * for a classpath token only - a suffix match. A `classpath:` / `classpath*:`
 * token goes to the suffix rule alone: it is relative to the classpath, not to
 * the mentioning file, and "in any classpath root" is what a suffix match says.
 *
 * Every other token is anchored to a base the mention itself implies (the
 * mentioning file's directory, its web root) or it is unresolved. A suffix
 * match would guess a base nobody can see, and finds a same-shaped file in
 * another module or application (a broken `href="style/date.css"`, a path in a
 * changelog, a build file's `META-INF/orm.xml` relative to another directory).
 * Likewise a pattern led by a wildcard (`**` + `/jrcs/diff/**` + `/*.java`)
 * hits under any directory, so a hit under the mentioning file's directory
 * does not show that directory is its base: it is not expanded.
 *
 * A `.` or `..` segment after the leading run of `/`, `./` and `../` is not
 * resolved at all: it may cancel a segment that is no directory (`$VAR/..`),
 * and normalizing it away would be luck.
 *
 * @returns {{ resolution: string, hits: string[] }}
 */
function resolvePath(candidate, file, index, mutations) {
  const { path: written, prefix, pattern } = candidate;
  const wildcard = written.includes('*');
  const classpath = prefix === 'classpath' || prefix === 'classpath*';
  const none = { resolution: pattern ? 'pattern' : 'suffix', hits: [] };

  const tail = stripLeadingRelative(written).replace(/\/{2,}/g, '/');
  if (tail.split('/').some((segment) => segment === '.' || segment === '..')) return none;

  const lookup = (rel, rule) => {
    const target = joinInside(rel.base, rel.rest);
    if (target === null) return null;
    const hits = wildcard ? index.matchGlob(target, false) : index.pathSet.has(target) ? [target] : [];
    return hits.length > 0 ? { resolution: pattern ? 'pattern' : rule, hits } : null;
  };

  // A pattern that starts with a wildcard names no base: it is not expanded
  // from a directory it merely might be relative to. (Classpath patterns are
  // anchored by the classpath.)
  const ledByWildcard = wildcard && !classpath && tail.split('/')[0].includes('*');
  // Tripwire seam: such a pattern expanded under the relative rules too.
  if (ledByWildcard && !mutations.leadingWildcardPatterns) return none;

  if (!classpath) {
    // Tripwire seam: the web-root rules switched off.
    const root = mutations.noWebRootRule ? null : index.webRootOf(file);
    let found = null;
    if (written.startsWith('/')) {
      if (root !== null) found = lookup({ base: root, rest: written }, 'web-root');
    } else {
      found = lookup({ base: dirOf(file), rest: written }, 'relative')
        ?? (root !== null ? lookup({ base: root, rest: written }, 'web-root') : null);
    }
    if (found) return found;
  }

  // Tripwire seam: the suffix fall-through for every token, not only classpath ones.
  if (!tail || !(classpath || mutations.suffixForNonClasspath)) return none;
  return { resolution: none.resolution, hits: wildcard ? index.matchGlob(tail, true) : index.matchSuffix(tail) };
}

// ---------------------------------------------------------------------------
// Resolution of a whole set of mention sites
// ---------------------------------------------------------------------------

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** How many skipped files a gap sample names for a pattern that matched only such files. */
const SKIPPED_SAMPLE_FILES = 5;

function evidenceOrder(a, b) {
  return a.line - b.line
    || compareText(a.token, b.token)
    || compareText(a.resolution, b.resolution)
    || compareText(JSON.stringify(a.context), JSON.stringify(b.context));
}

/**
 * @param {{
 *   sites: Array<{ file: string, language?: string, fqn: object[], path: object[] }>,
 *   manifestPaths: Iterable<string>,
 *   javaTypes: Array<{ fqn: string, path: string, id: string|null }>,
 *   otherJvm: { isType(pkg: string, name: string): boolean },
 *   declaredJavaTypes: { isType(pkg: string, name: string): boolean },
 *   skippedFiles: Array<{ path: string, reason: string }>,
 *   skippedNonCode: Record<string, number>,
 *   fileIdOf: (path: string) => string,
 *   languageOf?: (path: string) => string|undefined,
 *   mutations?: { firstDeclaration?: boolean, noWebRootRule?: boolean, shortestPrefix?: boolean, noJavaFileIndex?: boolean, suffixForNonClasspath?: boolean, leadingWildcardPatterns?: boolean },
 * }} args
 *   `sites` has one row per scanned non-code file, each with the lexer's
 *   candidate lists. `javaTypes` is every Java top-level type declaration
 *   with its class node id (null where the id is shared with another
 *   declaration). `declaredJavaTypes` answers whether a Java source file
 *   declares a type by its own `package` and file name (an annotation type,
 *   which has no class entry). `skippedFiles` are the files the scanner
 *   skipped for a reason in `TARGET_SKIP_REASONS`: a path can name them.
 *   `skippedNonCode` counts, by reason, the non-code files the scanner skipped
 *   and so no stage lexed; it is recorded in the coverage as given.
 *   All three are required. `mutations` is a test seam for the mutation
 *   tripwires (task 2.4); production callers leave it empty.
 * @returns {{
 *   edges: object[],
 *   gaps: Array<{ kind: string, scope: string, sample: string }>,
 *   coverage: object,
 * }}
 */
export function resolveMentions({
  sites, manifestPaths, javaTypes, otherJvm, declaredJavaTypes, skippedFiles, skippedNonCode,
  fileIdOf, languageOf = () => undefined, mutations = {},
}) {
  for (const [name, value] of Object.entries({ declaredJavaTypes, skippedFiles, skippedNonCode })) {
    if (value === undefined || value === null) throw new Error(`mention-resolution: ${name} is required`);
  }
  for (const entry of skippedFiles) {
    if (!TARGET_SKIP_REASONS.includes(entry.reason)) {
      throw new Error(`mention-resolution: skipped file ${entry.path} has a reason that names no repository file: ${entry.reason}`);
    }
  }
  const index = createPathIndex(manifestPaths, skippedFiles);
  const typesByFqn = indexJavaTypes(javaTypes);

  const edges = [];
  const gaps = [];
  const files = {};
  const fqn = { candidates: 0, edge: 0, ambiguous: 0, unindexed: 0, external: 0 };
  const path = { candidates: 0, edge: 0, ambiguous: 0, unresolved: 0, self: 0, unindexed: 0, unindexedHits: 0 };
  const seen = new Set();

  for (const site of sites) {
    const file = site.file;
    if (!index.manifestSet.has(file)) throw new Error(`mention-resolution: mention site for a file outside the manifest: ${file}`);
    if (seen.has(file)) throw new Error(`mention-resolution: more than one mention site row for ${file}`);
    seen.add(file);
    const language = languageOf(file) ?? site.language ?? 'unknown';
    files[language] = (files[language] ?? 0) + 1;

    // Evidence per target, for this file: one edge per (file, target).
    const byTarget = new Map();
    const mention = (targetId, candidate, resolution) => {
      if (!byTarget.has(targetId)) byTarget.set(targetId, []);
      byTarget.get(targetId).push({
        file, line: candidate.line, source: 'lexical', token: candidate.token, context: candidate.context ?? null, resolution,
      });
    };
    const labelOf = (hit) => (index.skippedReason.has(hit) ? `${hit} (${index.skippedReason.get(hit)})` : hit);
    const gap = (kind, candidate, named) => {
      gaps.push({ kind, scope: language, sample: `${file}:${candidate.line} ${candidate.token} -> [${named.join(', ')}]` });
    };

    for (const candidate of site.fqn ?? []) {
      fqn.candidates += 1;
      const found = resolveClassName(candidate.token, typesByFqn, otherJvm, declaredJavaTypes, mutations);
      if (found.kind === 'external') {
        fqn.external += 1;
      } else if (found.kind === 'unindexed') {
        fqn.unindexed += 1;
        gap('mention-target-unindexed', candidate, [found.type]);
      } else {
        // Tripwire seam: a name shared by several declarations resolves to the first.
        const declarations = mutations.firstDeclaration ? found.declarations.slice(0, 1) : found.declarations;
        if (declarations.length === 1 && declarations[0].id != null) {
          fqn.edge += 1;
          mention(declarations[0].id, candidate, 'fqn');
        } else {
          fqn.ambiguous += 1;
          gap('mention-ambiguous', candidate, declarations.map((d) => d.path).sort(compareText));
        }
      }
    }

    for (const candidate of site.path ?? []) {
      path.candidates += 1;
      const { resolution, hits } = resolvePath(candidate, file, index, mutations);
      if (hits.length === 0) {
        path.unresolved += 1;
        gap('path-mention-unresolved', candidate, []);
      } else if (candidate.pattern) {
        // A pattern names every file it matches, itself excepted. A match the
        // scanner skipped is in the repository but has no node: counted, and
        // the whole candidate is unindexed when that is all it matched.
        const skippedHits = hits.filter((hit) => index.skippedReason.has(hit)).sort(compareText);
        const others = hits.filter((hit) => hit !== file && !index.skippedReason.has(hit));
        path.unindexedHits += skippedHits.length;
        if (others.length > 0) {
          path.edge += 1;
          for (const hit of others) mention(fileIdOf(hit), candidate, resolution);
        } else if (skippedHits.length > 0) {
          path.unindexed += 1;
          const shown = skippedHits.slice(0, SKIPPED_SAMPLE_FILES).map(labelOf);
          if (skippedHits.length > shown.length) shown.push(`+${skippedHits.length - shown.length} more`);
          gap('mention-target-unindexed', candidate, shown);
        } else {
          path.self += 1;
        }
      } else if (hits.length > 1) {
        path.ambiguous += 1;
        gap('mention-ambiguous', candidate, [...hits].sort(compareText).map(labelOf));
      } else if (hits[0] === file) {
        path.self += 1;
      } else if (index.skippedReason.has(hits[0])) {
        path.unindexed += 1;
        gap('mention-target-unindexed', candidate, [labelOf(hits[0])]);
      } else {
        path.edge += 1;
        mention(fileIdOf(hits[0]), candidate, resolution);
      }
    }

    for (const [targetId, mentions] of byTarget) {
      const unique = new Map(mentions.map((m) => [JSON.stringify([m.line, m.token, m.context, m.resolution]), m]));
      edges.push({
        source: fileIdOf(file),
        target: targetId,
        type: 'mentions',
        direction: 'forward',
        weight: MENTION_EDGE_WEIGHT,
        evidence: [...unique.values()].sort(evidenceOrder),
        provenance: 'extracted',
      });
    }
  }

  return { edges, gaps, coverage: { status: 'ran', files, skipped: { ...skippedNonCode }, fqn, path } };
}
