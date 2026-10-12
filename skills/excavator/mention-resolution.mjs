/**
 * mention-resolution.mjs
 *
 * Cross-file resolution of name mentions (openspec: changes/name-mention-facts,
 * capability `fact-graph`, design D4-D6). The lexer (text-mentions.mjs) records
 * what a non-code file writes: class-name-shaped tokens and path-shaped
 * tokens. This module decides, for each candidate, which repository class or
 * file it names - and when it cannot say, which visible bucket it lands in.
 *
 * Pure and build-free: it compares tokens against the manifest's file paths and
 * the repository's Java type declarations only. It never reads a file and never
 * touches the filesystem, so a `../` that climbs out of the repository simply
 * resolves to nothing.
 *
 * Every candidate has exactly one fate:
 *   class-name: edge | ambiguous | unindexed (a Kotlin/Scala type) | external
 *   path:       edge | ambiguous | unresolved | self
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
  const pathTotal = path.edge + path.ambiguous + path.unresolved + path.self;
  if (pathTotal !== path.candidates) {
    throw new Error(`mention-resolution: ${path.candidates} path candidate(s) but ${pathTotal} outcome(s)`);
  }
  const readBack = {
    'mention-ambiguous': [fqn.ambiguous + path.ambiguous, gapCounts.ambiguous],
    'mention-target-unindexed': [fqn.unindexed, gapCounts.unindexed],
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
function resolveClassName(token, typesByFqn, otherJvm, mutations) {
  const segments = token.replace(/\$/g, '.').split('.');
  const lengths = [];
  for (let k = segments.length; k >= 2; k--) lengths.push(k);
  // Tripwire seam: the shortest prefix instead of the longest.
  if (mutations.shortestPrefix) lengths.reverse();

  for (const k of lengths) {
    const declarations = typesByFqn.get(segments.slice(0, k).join('.'));
    if (declarations) return { kind: 'repo', declarations };
  }
  for (const k of lengths) {
    const pkg = segments.slice(0, k - 1).join('.');
    const name = segments[k - 1];
    if (otherJvm.isType(pkg, name)) return { kind: 'unindexed', type: `${pkg}.${name}` };
  }
  return { kind: 'external' };
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

/** The manifest's files and the web roots among them. */
function createPathIndex(manifestPaths) {
  const paths = [...manifestPaths];
  const pathSet = new Set(paths);
  const byBasename = new Map();
  const webRoots = new Set();
  for (const path of paths) {
    const base = path.slice(path.lastIndexOf('/') + 1);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(path);
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
  /** Every manifest path matching `glob` - from the start of the path, or as a segment-aligned suffix. */
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

  /** Every manifest path ending with `tail` at a segment boundary. */
  function matchSuffix(tail) {
    const base = tail.slice(tail.lastIndexOf('/') + 1);
    return (byBasename.get(base) ?? []).filter((path) => path === tail || path.endsWith(`/${tail}`));
  }

  return { pathSet, webRootOf, matchGlob, matchSuffix };
}

/**
 * Resolve one path candidate to the files it names, by the first rule that
 * has a hit: web root, mentioning file's directory, web-root fallback, then a
 * suffix match. A `classpath:` / `classpath*:` token goes to the suffix rule
 * alone: it is relative to the classpath, not to the mentioning file.
 *
 * @returns {{ resolution: string, hits: string[] }}
 */
function resolvePath(candidate, file, index, mutations) {
  const { path: written, prefix, pattern } = candidate;
  const wildcard = written.includes('*');
  const classpath = prefix === 'classpath' || prefix === 'classpath*';

  const lookup = (rel, rule) => {
    const target = joinInside(rel.base, rel.rest);
    if (target === null) return null;
    const hits = wildcard ? index.matchGlob(target, false) : index.pathSet.has(target) ? [target] : [];
    return hits.length > 0 ? { resolution: pattern ? 'pattern' : rule, hits } : null;
  };

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

  const tail = stripLeadingRelative(posix.normalize(stripLeadingRelative(written)));
  const hits = !tail || tail === '.'
    ? []
    : wildcard ? index.matchGlob(tail, true) : index.matchSuffix(tail);
  return { resolution: pattern ? 'pattern' : 'suffix', hits };
}

// ---------------------------------------------------------------------------
// Resolution of a whole set of mention sites
// ---------------------------------------------------------------------------

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

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
 *   fileIdOf: (path: string) => string,
 *   languageOf?: (path: string) => string|undefined,
 *   mutations?: { firstDeclaration?: boolean, noWebRootRule?: boolean, shortestPrefix?: boolean },
 * }} args
 *   `sites` has one row per scanned non-code file, each with the lexer's
 *   candidate lists. `javaTypes` is every Java top-level type declaration
 *   with its class node id (null where the id is shared with another
 *   declaration). `mutations` is a test seam for the mutation tripwires
 *   (task 2.4); production callers leave it empty.
 * @returns {{
 *   edges: object[],
 *   gaps: Array<{ kind: string, scope: string, sample: string }>,
 *   coverage: object,
 * }}
 */
export function resolveMentions({ sites, manifestPaths, javaTypes, otherJvm, fileIdOf, languageOf = () => undefined, mutations = {} }) {
  const index = createPathIndex(manifestPaths);
  const typesByFqn = new Map();
  for (const type of javaTypes) {
    if (!typesByFqn.has(type.fqn)) typesByFqn.set(type.fqn, []);
    typesByFqn.get(type.fqn).push(type);
  }

  const edges = [];
  const gaps = [];
  const files = {};
  const fqn = { candidates: 0, edge: 0, ambiguous: 0, unindexed: 0, external: 0 };
  const path = { candidates: 0, edge: 0, ambiguous: 0, unresolved: 0, self: 0 };
  const seen = new Set();

  for (const site of sites) {
    const file = site.file;
    if (!index.pathSet.has(file)) throw new Error(`mention-resolution: mention site for a file outside the manifest: ${file}`);
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
    const gap = (kind, candidate, named) => {
      gaps.push({ kind, scope: language, sample: `${file}:${candidate.line} ${candidate.token} -> [${named.join(', ')}]` });
    };

    for (const candidate of site.fqn ?? []) {
      fqn.candidates += 1;
      const found = resolveClassName(candidate.token, typesByFqn, otherJvm, mutations);
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
        // A pattern names every file it matches, itself excepted.
        const others = hits.filter((hit) => hit !== file);
        if (others.length === 0) {
          path.self += 1;
        } else {
          path.edge += 1;
          for (const hit of others) mention(fileIdOf(hit), candidate, resolution);
        }
      } else if (hits.length > 1) {
        path.ambiguous += 1;
        gap('mention-ambiguous', candidate, [...hits].sort(compareText));
      } else if (hits[0] === file) {
        path.self += 1;
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

  return { edges, gaps, coverage: { status: 'ran', files, fqn, path } };
}
