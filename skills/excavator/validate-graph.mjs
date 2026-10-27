#!/usr/bin/env node
/**
 * validate-graph.mjs
 *
 * Analysis phase 6b (added). UA's Phase 6 inline validator stays exactly as it
 * is; this runs after it and does the one thing that validator cannot: it
 * OPENS THE SOURCE and checks that the graph's anchors and evidence lines
 * really say what the graph claims.
 *
 * Checks
 *   1. anchors — for every function/class node, the line at `lineRange[0]`
 *      (±1), or the first line after its leading annotations and comments,
 *      must contain the node's `name` (an anonymous declaration: a
 *      class/struct/def keyword). Otherwise: gap `anchor-mismatch`, node
 *      `verification: "contradicted"`. Leading lines longer than the scan bound
 *      leave the node `unverified` under `construct-too-long`, never confirmed and
 *      never contradicted. An anchor is exact when the name is on `lineRange[0]`
 *      itself or on the first line after the leading lines; one that only passes
 *      within one line is still an anchor but is not exact.
 *   2. evidence — for every `extracted` edge, the cited line must contain the
 *      expected token: the callee name (`calls`), the target module segment
 *      (`imports`), the symbol name (`exports`), the declared name
 *      (`contains`, or what the entry's own `token` says its line holds, as
 *      for `mentions`, `references`, `injects` and `routes`); for a
 *      model-cited entry, either endpoint's name or file name. `imports` is
 *      checked across the whole statement (a multi-line ES import names its
 *      specifier several lines below its start); every other type is checked
 *      on the cited line alone. One more way is read from the graph, not from
 *      the text: an edge an extractor wrote that cites a declaration (not a
 *      `calls` edge, and not an entry that names its own token) is confirmed
 *      when the cited line is the first line of the range of an endpoint whose
 *      name is the expected token and whose own anchor is exact. Otherwise: gap
 *      `edge-contradicted`, edge `verification: "contradicted"`.
 *   3. `inferred` edges pass — being marked as judgement IS the honest state.
 *   4. referential integrity — the same checks UA's inline validator makes
 *      (required node fields, duplicate ids, dangling endpoints, layer and
 *      file nodes in a layer and orphan warnings).
 *   5. domain steps — a `step` node needs `nodeIds` that exist in the graph,
 *      or `provenance: "inferred"`. Otherwise: gap `step-unanchored`.
 *
 * A source file that cannot be read is counted (`source-missing`), never
 * treated as a contradiction: "we could not look" is not "the graph is wrong".
 * A path that names something OUTSIDE the project root is refused without
 * being read and counted under `path-out-of-scope`; the node or edge is marked
 * `unverified`. The graph is model-authored, so its paths are untrusted input
 * to a file read, and a read that escapes the analysed tree must never be
 * able to come back as a confirmation.
 *
 * Usage:
 *   node validate-graph.mjs <projectRoot>
 *     [--graph <annotated-graph.json>] [--out <validated-graph.json>]
 *     [--report <validation.json>] [--samples <n>]
 *
 * Exit code is 0 whenever the run completed: findings are data, not a crash.
 * Determinism: no timestamps, all findings sorted, samples capped.
 */

import { createRequire } from 'node:module';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { compareGaps } from './coverage-ledger.mjs';
import { readKnowledgeGraph, writeKnowledgeGraph } from './knowledge-graph-store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@excavator/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}
const { resolveDataDir } = core;

/** Tolerance, in lines, when confirming a declaration anchor. */
export const ANCHOR_TOLERANCE = 1;

/** How far an `imports` evidence check may scan for the statement's end. */
export const IMPORT_WINDOW_LINES = 12;

/**
 * How far the leading-line skip may read before it gives up. The longest legitimate construct measured on a real project
 * was 22 lines; this leaves an order of magnitude and keeps the worst case of
 * one anchor or edge constant. Passing it yields `unverified`, never a verdict.
 */
export const CONSTRUCT_SCAN_LINES = 400;

const CODE_NODE_TYPES = Object.freeze(new Set(['function', 'class']));
const FILE_LEVEL_TYPES = Object.freeze(new Set([
  'file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint',
]));
/** Keywords that stand in for the name of an anonymous declaration. */
const ANONYMOUS_KEYWORDS = Object.freeze(['class', 'struct', 'function', 'def', 'fn', 'interface', 'object']);

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function stripExtension(path) {
  const ext = extname(path);
  return ext ? path.slice(0, -ext.length) : path;
}

/** Is this the model's placeholder for something with no name of its own? */
export function isAnonymousName(name) {
  return typeof name !== 'string' || name.length === 0 || /^anon(@\d+)?$/i.test(name);
}

/**
 * Resolve a graph-provided path INSIDE the project root, or return null.
 *
 * The graph is model-authored data, so its `filePath` values are untrusted
 * input to a file read. Without this, a node claiming
 * `filePath: "../outside.ts"` would be read and — worse — confirmed, which
 * both leaks a read outside the analysed tree and turns a bogus anchor into
 * evidence of correctness. Absolute paths are refused outright; relative ones
 * must resolve inside the root; a path that exists is realpath'd so a symlink
 * cannot step out either.
 */
export function resolveWithinRoot(root, filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  if (isAbsolute(filePath)) return null;
  // The root is canonicalised here too, not only by the caller: comparing a
  // realpath'd file against a symlinked root (macOS /var -> /private/var, or
  // any symlinked checkout) refuses EVERY path — a containment check that
  // fails closed on everything is just as broken as one that fails open.
  const canonicalRoot = canonicalise(resolve(root));
  const resolved = resolve(canonicalRoot, filePath);
  if (resolved !== canonicalRoot && !resolved.startsWith(canonicalRoot + sep)) return null;
  const real = canonicalise(resolved);
  if (real !== canonicalRoot && !real.startsWith(canonicalRoot + sep)) return null;
  return real;
}

/** realpath when the path exists, the path itself when it does not. */
function canonicalise(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Reader with a per-file line cache. Three outcomes, all visible: `ok`,
 * `missing` (in scope, unreadable) and `out-of-scope` (refused, never read).
 */
export function createSourceReader(projectRoot) {
  let root;
  try {
    root = realpathSync(resolve(projectRoot));
  } catch {
    root = resolve(projectRoot);
  }
  const cache = new Map();
  const missing = new Set();
  const outOfScope = new Set();
  return {
    /** 'ok' | 'missing' | 'out-of-scope' — computed once per path. */
    classify(filePath) {
      if (!cache.has(filePath)) {
        const absolute = resolveWithinRoot(root, filePath);
        if (absolute === null) {
          outOfScope.add(filePath);
          cache.set(filePath, { status: 'out-of-scope', lines: null });
        } else {
          try {
            cache.set(filePath, {
              status: 'ok',
              lines: readFileSync(absolute, 'utf-8').split('\n'),
            });
          } catch {
            missing.add(filePath);
            cache.set(filePath, { status: 'missing', lines: null });
          }
        }
      }
      return cache.get(filePath).status;
    },
    /** True when the path is outside the project root and was NOT read. */
    isOutOfScope(filePath) {
      return this.classify(filePath) === 'out-of-scope';
    },
    lines(filePath) {
      this.classify(filePath);
      return cache.get(filePath).lines;
    },
    /** 1-based line text, or null when the file or the line does not exist. */
    line(filePath, lineNumber) {
      const lines = this.lines(filePath);
      if (!lines) return null;
      if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lines.length) return null;
      return lines[lineNumber - 1];
    },
    missingFiles() {
      return [...missing].sort(compareStrings);
    },
    outOfScopePaths() {
      return [...outOfScope].sort(compareStrings);
    },
    root() {
      return root;
    },
  };
}

/**
 * Does any line within ±tolerance of `lineNumber` contain one of `tokens`?
 * Returns the matching line number, or null.
 */
export function findToken(reader, filePath, lineNumber, tokens, tolerance = 0) {
  for (let offset = 0; offset <= tolerance; offset++) {
    for (const candidate of offset === 0 ? [lineNumber] : [lineNumber - offset, lineNumber + offset]) {
      const text = reader.line(filePath, candidate);
      if (text === null) continue;
      if (tokens.some((token) => token && text.includes(token))) return candidate;
    }
  }
  return null;
}

/** Tokens whose presence on the cited line would corroborate this edge. */
export function expectedTokens(edge, source, target, evidenceEntry) {
  if (evidenceEntry?.source === 'model') {
    // A model-cited line only has to be about one of the two endpoints.
    return [source?.name, target?.name, source?.filePath && basename(source.filePath), target?.filePath && basename(target.filePath)]
      .filter(Boolean);
  }
  switch (edge.type) {
    case 'calls':
      // The callee's name, unless the entry says what its line writes: a JSX
      // element cites its tag, which an import may have renamed (`<Btn>` for
      // `Button`) or qualified (`<UI.Button>`) (openspec: changes/jsx-element-references).
      return [evidenceEntry?.token ?? target?.name].filter(Boolean);
    case 'exports':
      return [target?.name].filter(Boolean);
    case 'contains':
      // The declared name, unless the entry says what its line holds: the
      // contains edge to an endpoint cites the annotation that names its HTTP
      // method, and the endpoint's name (its route) is not written on that
      // line (openspec: changes/jaxrs-route-facts, D8).
      return [evidenceEntry?.token ?? target?.name].filter(Boolean);
    case 'imports': {
      const path = target?.filePath;
      if (!path) return [target?.name].filter(Boolean);
      return [stripExtension(basename(path)), basename(dirname(path))].filter(Boolean);
    }
    case 'mentions':
    case 'references':
    case 'injects':
    case 'routes':
      // The line names what the mention WROTE: the evidence entry's own token.
      // The target's name is not on that line when a pattern (`spring/*.xml`)
      // or a classpath suffix hit the file (openspec: changes/name-mention-facts);
      // nor is it for a name an expression writes, which a binding resolved to a
      // class of another name (`#{orders.save}` -> `OrderBean`, openspec:
      // changes/name-binding-references); nor is it for a name a descriptor
      // writes in an injection (`ref="orders"` -> `OrderDaoImpl`, `injects`,
      // openspec: changes/xml-injection-references); nor is the endpoint's name
      // (`GET /orders/{id}`) on the line of the annotation a `routes` edge cites
      // (openspec: changes/jaxrs-route-facts).
      return [evidenceEntry?.token].filter(Boolean);
    default:
      return [source?.name, target?.name].filter(Boolean);
  }
}

/**
 * Does this line end the import statement it belongs to? `from`, a trailing
 * `;` or `)`, and a `require(`/`import(` call all mark the point where the
 * module specifier has been named.
 */
export function endsImportStatement(text) {
  const trimmed = text.trim();
  return /\bfrom\b/.test(text)
    || trimmed.endsWith(';')
    || trimmed.endsWith(')')
    || /\b(?:require|import)\s*\(/.test(text);
}

/**
 * Scan an import STATEMENT rather than a single line.
 *
 * A multi-line ES import puts the specifier several lines below the line
 * tree-sitter reports as the statement's start:
 *
 *     import {          <- the cited line
 *       a,
 *       b
 *     } from './x';     <- where the specifier actually is
 *
 * Checking only the cited line reported every one of those as contradicted.
 * The scan stops at the first line that ends the statement (checking that
 * line for the token first), so it cannot wander into unrelated code, and it
 * is bounded at `maxLines` regardless.
 */
export function findTokenInImportStatement(reader, filePath, lineNumber, tokens, maxLines = IMPORT_WINDOW_LINES) {
  for (let offset = 0; offset < maxLines; offset++) {
    const candidate = lineNumber + offset;
    const text = reader.line(filePath, candidate);
    if (text === null) return null;
    if (tokens.some((token) => token && text.includes(token))) return candidate;
    if (endsImportStatement(text)) return null;
  }
  return null;
}

/**
 * Which leading-line syntaxes a language has, by the extension of its files.
 * An annotation, an attribute and a comment each exist in some languages only,
 * and the same text is a statement in others: `@log.info(item)` is an instance
 * variable in Ruby, `[a, b] = [b, a]` a swap in JavaScript and Python, `@name`
 * an error-suppressing call in PHP. A file whose language is not listed has no
 * annotation or attribute syntax here, which only reports a contradiction
 * where an annotation is skipped in other languages. Comments are the same:
 * `//` and block comments exist in the C family, `#` comments in the
 * scripting languages, and a continuation line that starts with `*` or `//`
 * is a splat or a floor division in Python and Ruby. Blank lines are the only
 * leading line every language has.
 */
const LEADING_SYNTAX = Object.freeze({
  at: new Set(['.java', '.kt', '.kts', '.scala', '.groovy', '.swift', '.dart', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.pyi']),
  bracketAttribute: new Set(['.cs']),
  hashAttribute: new Set(['.rs', '.php']),
  hashComment: new Set(['.py', '.pyi', '.rb', '.sh', '.bash', '.pl', '.pm', '.r', '.ex', '.exs', '.php']),
  // `//` line comments and block comments: a `//` is a floor division in Python and a regular expression in Ruby
  slashComment: new Set([
    '.java', '.kt', '.kts', '.scala', '.groovy', '.swift', '.dart', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.cs', '.rs', '.php', '.go', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.m', '.mm',
  ]),
});

function leadingSyntax(filePath) {
  const ext = extname(filePath).toLowerCase();
  return {
    at: LEADING_SYNTAX.at.has(ext),
    bracketAttribute: LEADING_SYNTAX.bracketAttribute.has(ext),
    hashAttribute: LEADING_SYNTAX.hashAttribute.has(ext),
    hashComment: LEADING_SYNTAX.hashComment.has(ext),
    slashComment: LEADING_SYNTAX.slashComment.has(ext),
  };
}

/**
 * Read `text` from an opening bracket at `depth` until the brackets close:
 * `(`, `[` and `{` open, their closers close, string literals and a line comment
 * of the file's language are not read. Returns the depth at the end of the text and the index
 * just after the closing character, or -1 while they are still open.
 */
function readBrackets(text, depth, syntax) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (syntax.slashComment && ch === '/' && text[i + 1] === '/') break;
    else if (syntax.hashComment && ch === '#') break;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) {
      depth -= 1;
      if (depth === 0) return { depth, index: i + 1 };
    }
  }
  return { depth, index: -1 };
}

/**
 * The first line of the construct that starts at `startLine`, past its
 * leading lines. A leading line holds nothing but blank space, comments, and
 * annotations, decorators or attributes (whose arguments may span many lines).
 * A line that holds anything else once those are read off its start is the
 * start of the construct: a statement of the language, an annotation followed
 * by a declaration on the same line, a comment followed by code, an array row
 * after a bracket. It only moves forward, so a line of code is never skipped.
 * Returns `{ status: 'ok', line }`, `{ status: 'too-long' }` when the leading
 * lines pass `CONSTRUCT_SCAN_LINES`, or `{ status: 'none' }` at the end of the
 * file.
 */
export function skipLeadingLines(reader, filePath, startLine) {
  const syntax = leadingSyntax(filePath);
  let depth = 0; // brackets of an annotation that is still open from an earlier line
  let inBlockComment = false;

  // Reads leading constructs off the start of `text`; true when nothing else is on the line.
  const onlyLeading = (text) => {
    let rest = text;
    for (;;) {
      if (inBlockComment) {
        const end = rest.indexOf('*/');
        if (end < 0) return true;
        inBlockComment = false;
        rest = rest.slice(end + 2);
        continue;
      }
      if (depth > 0) {
        const read = readBrackets(rest, depth, syntax);
        depth = read.depth;
        if (read.index < 0) return true;
        rest = rest.slice(read.index);
        continue;
      }
      rest = rest.trimStart();
      if (rest === '') return true;
      if (syntax.slashComment && rest.startsWith('//')) return true;
      if (syntax.hashComment && /^#(?:\s|$|!|#)/.test(rest)) return true;
      if (syntax.slashComment && rest.startsWith('/*')) {
        const end = rest.indexOf('*/', 2);
        if (end < 0) {
          inBlockComment = true;
          return true;
        }
        rest = rest.slice(end + 2);
        continue;
      }
      let brackets = null;
      if (syntax.at && rest.startsWith('@')) {
        // What follows the name has to be leading syntax too: `@interface Foo {}`
        // declares a type and `@name = value` assigns a variable, and both leave
        // something behind on the line.
        const name = /^@+[\w.:]+/.exec(rest);
        if (name === null) return false;
        rest = rest.slice(name[0].length).trimStart();
        if (!rest.startsWith('(')) continue;
        brackets = rest;
      } else if (syntax.hashAttribute && (rest.startsWith('#[') || rest.startsWith('#!['))) {
        brackets = rest.slice(rest.indexOf('['));
      } else if (syntax.bracketAttribute && /^\[\s*[A-Za-z_]/.test(rest)) {
        brackets = rest;
      } else {
        return false;
      }
      const read = readBrackets(brackets, 0, syntax);
      depth = read.depth;
      if (read.index < 0) return true;
      rest = brackets.slice(read.index);
    }
  };

  const limit = startLine + CONSTRUCT_SCAN_LINES;
  for (let line = startLine; ; line++) {
    if (line >= limit) return { status: 'too-long' };
    const text = reader.line(filePath, line);
    if (text === null) return { status: 'none' };
    if (!onlyLeading(text)) return { status: 'ok', line };
  }
}

function sampler(limit) {
  const map = new Map();
  return {
    add(key, sample) {
      if (!map.has(key)) map.set(key, []);
      const list = map.get(key);
      if (list.length < limit) list.push(sample);
    },
    get(key) {
      return (map.get(key) ?? []).slice().sort(compareStrings);
    },
  };
}

/**
 * The whole validation. Pure except for the source reader it is handed, so it
 * is testable against a fixture project without a subprocess.
 */
export function validateAgainstSource({ graph, reader, sampleLimit = 5 }) {
  const validated = JSON.parse(JSON.stringify(graph));
  validated.nodes = Array.isArray(validated.nodes) ? validated.nodes : [];
  validated.edges = Array.isArray(validated.edges) ? validated.edges : [];

  const samples = sampler(sampleLimit);
  const findings = { anchorMismatch: [], edgeContradicted: [], stepUnanchored: [] };
  const issues = [];
  const warnings = [];
  const counts = {
    nodesChecked: 0,
    anchorMismatch: 0,
    anchorConfirmed: 0,
    edgesChecked: 0,
    edgeContradicted: 0,
    edgeConfirmed: 0,
    edgesInferred: 0,
    edgesWithoutEvidence: 0,
    sourceMissing: 0,
    pathOutOfScope: 0,
    constructTooLong: 0,
    stepUnanchored: 0,
  };

  const nodeById = new Map();
  const seenIds = new Map();
  for (let i = 0; i < validated.nodes.length; i++) {
    const node = validated.nodes[i];
    if (!node || typeof node !== 'object') {
      issues.push(`Node[${i}] is not an object`);
      continue;
    }
    if (!node.id) {
      issues.push(`Node[${i}] missing id`);
      continue;
    }
    if (!node.type) issues.push(`Node[${i}] '${node.id}' missing type`);
    if (!node.name) issues.push(`Node[${i}] '${node.id}' missing name`);
    if (typeof node.summary !== 'string') issues.push(`Node[${i}] '${node.id}' missing summary`);
    if (!Array.isArray(node.tags)) issues.push(`Node[${i}] '${node.id}' missing tags`);
    if (seenIds.has(node.id)) {
      issues.push(`Duplicate node ID '${node.id}' at indices ${seenIds.get(node.id)} and ${i}`);
    } else {
      seenIds.set(node.id, i);
    }
    nodeById.set(node.id, node);
  }

  // ── 1. anchors ──────────────────────────────────────────────────────────
  const exactAnchors = new Set();
  for (const node of validated.nodes) {
    if (!node || typeof node !== 'object') continue;
    if (!CODE_NODE_TYPES.has(node.type)) continue;
    if (typeof node.filePath !== 'string' || !Array.isArray(node.lineRange)) continue;
    counts.nodesChecked += 1;

    const startLine = node.lineRange[0];
    if (reader.isOutOfScope(node.filePath)) {
      // Refused, not read, and NOT confirmed: an out-of-scope anchor cannot
      // be evidence of anything.
      counts.pathOutOfScope += 1;
      node.verification = 'unverified';
      samples.add('path-out-of-scope', `${node.id} -> ${node.filePath}`);
      continue;
    }
    if (reader.lines(node.filePath) === null) {
      counts.sourceMissing += 1;
      samples.add('source-missing', node.filePath);
      continue;
    }
    const tokens = isAnonymousName(node.name) ? ANONYMOUS_KEYWORDS : [node.name];
    // A declaration's range starts at its first annotation, so its name is on
    // the first line after the annotations and comments. The name on
    // `lineRange[0]` itself or on that line makes the anchor exact; a name that
    // is only within one line of the start still confirms the anchor, but an
    // edge is not vouched for by it.
    let hit = findToken(reader, node.filePath, startLine, tokens, ANCHOR_TOLERANCE);
    let exact = findToken(reader, node.filePath, startLine, tokens, 0) !== null;
    if (!exact) {
      const lead = skipLeadingLines(reader, node.filePath, startLine);
      if (lead.status === 'ok') {
        const leadHit = findToken(reader, node.filePath, lead.line, tokens, 0);
        if (leadHit !== null) {
          exact = true;
          hit = hit ?? leadHit;
        }
      } else if (lead.status === 'too-long' && hit === null) {
        counts.constructTooLong += 1;
        node.verification = 'unverified';
        samples.add('construct-too-long', `${node.filePath}:${startLine} ${node.id}`);
        continue;
      }
    }
    if (hit === null) {
      counts.anchorMismatch += 1;
      node.verification = 'contradicted';
      const finding = {
        nodeId: node.id,
        filePath: node.filePath,
        line: startLine,
        name: node.name,
        reason: `line ${startLine} (±${ANCHOR_TOLERANCE}) does not contain "${node.name}"`,
      };
      findings.anchorMismatch.push(finding);
      samples.add('anchor-mismatch', `${node.filePath}:${startLine} ${node.id}`);
    } else {
      counts.anchorConfirmed += 1;
      if (exact) exactAnchors.add(node.id);
    }
  }

  // ── 2/3. evidence lines ─────────────────────────────────────────────────
  for (const edge of validated.edges) {
    if (!edge || typeof edge !== 'object') continue;
    if (edge.provenance === 'inferred') {
      counts.edgesInferred += 1;
      continue;
    }
    const evidence = Array.isArray(edge.evidence) ? edge.evidence : [];
    if (evidence.length === 0) {
      counts.edgesWithoutEvidence += 1;
      continue;
    }
    counts.edgesChecked += 1;
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);

    let confirmed = false;
    let sawSource = false;
    let refused = false;
    for (const entry of evidence) {
      if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string') continue;
      if (reader.isOutOfScope(entry.file)) {
        refused = true;
        continue;
      }
      if (reader.lines(entry.file) === null) continue;
      sawSource = true;
      const tokens = expectedTokens(edge, source, target, entry);
      if (tokens.length === 0) continue;
      // `imports` is the one type whose evidence line is the START of a
      // statement that may span several lines; every other type cites the
      // exact line the token is on.
      let found = edge.type === 'imports' && entry.source !== 'model'
        ? findTokenInImportStatement(reader, entry.file, entry.line, tokens)
        : findToken(reader, entry.file, entry.line, tokens, 0);
      // An entry that names the token its line holds (a mention, an injection,
      // a JSX tag) says exactly where that is, and a model's citation is
      // untrusted input. Any other edge that cites a declaration cites where
      // its range starts, which is its first annotation: a fact about the
      // graph, not about how the line reads. The cited line is the first line
      // of an endpoint's own range, and that endpoint's anchor is exact.
      if (found === null && entry.source !== 'model' && entry.token === undefined && edge.type !== 'calls'
        && [target, source].some((n) => n && n.filePath === entry.file && Array.isArray(n.lineRange)
          && n.lineRange[0] === entry.line && tokens.includes(n.name) && exactAnchors.has(n.id))) {
        found = entry.line;
      }
      if (found !== null) {
        confirmed = true;
        break;
      }
    }

    if (refused && !sawSource) {
      counts.pathOutOfScope += 1;
      edge.verification = 'unverified';
      samples.add('path-out-of-scope', `${edge.type}|${edge.source}|${edge.target}`);
      continue;
    }
    if (!sawSource) {
      counts.sourceMissing += 1;
      samples.add('source-missing', evidence[0]?.file ?? '<unknown>');
      continue;
    }
    if (confirmed) {
      counts.edgeConfirmed += 1;
      continue;
    }
    counts.edgeContradicted += 1;
    edge.verification = 'contradicted';
    const key = `${edge.type}|${edge.source}|${edge.target}`;
    findings.edgeContradicted.push({
      edgeKey: key,
      type: edge.type,
      evidence: evidence.map((entry) => ({ file: entry?.file, line: entry?.line, source: entry?.source })),
      reason: `no cited line contains ${JSON.stringify(expectedTokens(edge, source, target, evidence[0]))}`,
    });
    samples.add('edge-contradicted', key);
  }

  // ── 4. referential integrity (UA's inline validator checks) ─────────────
  validated.edges.forEach((edge, i) => {
    if (!edge || typeof edge !== 'object') return;
    if (!nodeById.has(edge.source)) issues.push(`Edge[${i}] source '${edge.source}' not found`);
    if (!nodeById.has(edge.target)) issues.push(`Edge[${i}] target '${edge.target}' not found`);
  });

  const layers = Array.isArray(validated.layers) ? validated.layers : [];
  if (validated.layers && !Array.isArray(validated.layers)) warnings.push('graph.layers is not an array');
  validated.tour = [];

  const assigned = new Map();
  for (const layer of layers) {
    for (const id of layer?.nodeIds ?? []) {
      if (!nodeById.has(id)) issues.push(`Layer '${layer.id}' refs missing node '${id}'`);
      if (assigned.has(id)) issues.push(`Node '${id}' appears in multiple layers`);
      assigned.set(id, layer.id);
    }
  }
  for (const node of validated.nodes) {
    if (node && FILE_LEVEL_TYPES.has(node.type) && !assigned.has(node.id)) {
      issues.push(`File node '${node.id}' not in any layer`);
    }
  }
  const withEdges = new Set();
  for (const edge of validated.edges) {
    if (!edge || typeof edge !== 'object') continue;
    withEdges.add(edge.source);
    withEdges.add(edge.target);
  }
  for (const node of validated.nodes) {
    if (node && !withEdges.has(node.id)) warnings.push(`Node '${node.id}' has no edges (orphan)`);
  }

  // ── 5. domain steps ─────────────────────────────────────────────────────
  for (const node of validated.nodes) {
    if (!node || node.type !== 'step') continue;
    const ids = Array.isArray(node.nodeIds) ? node.nodeIds : [];
    const resolvable = ids.filter((id) => nodeById.has(id));
    if (resolvable.length > 0) continue;
    if (node.provenance === 'inferred') continue;
    counts.stepUnanchored += 1;
    findings.stepUnanchored.push({
      nodeId: node.id,
      reason: ids.length === 0
        ? 'step has no nodeIds and is not marked inferred'
        : 'none of the step\'s nodeIds exist in the graph',
    });
    samples.add('step-unanchored', node.id);
  }

  const order = (a, b) => compareStrings(JSON.stringify(a), JSON.stringify(b));
  findings.anchorMismatch.sort(order);
  findings.edgeContradicted.sort(order);
  findings.stepUnanchored.sort(order);
  issues.sort(compareStrings);
  warnings.sort(compareStrings);

  const gaps = [...(Array.isArray(validated.gaps) ? validated.gaps : [])];
  const addGap = (kind, count, reason, sampleKey) => {
    if (count <= 0) return;
    gaps.push({ kind, scope: 'graph', reason, count, samples: samples.get(sampleKey ?? kind) });
  };
  addGap('anchor-mismatch', counts.anchorMismatch,
    `${counts.anchorMismatch} declaration node(s) whose anchor line does not contain the name`);
  addGap('edge-contradicted', counts.edgeContradicted,
    `${counts.edgeContradicted} edge(s) whose cited line does not contain the expected token`);
  addGap('step-unanchored', counts.stepUnanchored,
    `${counts.stepUnanchored} step node(s) with no resolvable nodeIds and no inferred marking`);
  addGap('source-missing', counts.sourceMissing,
    `${counts.sourceMissing} check(s) skipped because the source file could not be read`);
  addGap('construct-too-long', counts.constructTooLong,
    `${counts.constructTooLong} check(s) left unverified because the leading lines passed ${CONSTRUCT_SCAN_LINES} lines`);
  addGap('path-out-of-scope', counts.pathOutOfScope,
    `${counts.pathOutOfScope} path(s) named outside the project root were refused, not read`);
  gaps.sort(compareGaps);
  validated.gaps = gaps;

  const report = {
    scriptCompleted: true,
    counts,
    findings,
    issues,
    warnings,
    missingFiles: reader.missingFiles().slice(0, sampleLimit),
    outOfScopePaths: reader.outOfScopePaths().slice(0, sampleLimit),
    stats: {
      totalNodes: validated.nodes.length,
      totalEdges: validated.edges.length,
      totalLayers: layers.length,
    },
  };

  return { validated, report };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { projectRoot: null, graph: null, out: null, report: null, sampleLimit: 5 };
  const valueFlags = { '--graph': 'graph', '--out': 'out', '--report': 'report' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--samples') {
      const value = Number.parseInt(argv[i + 1], 10);
      if (!Number.isInteger(value) || value < 0) throw new Error('validate-graph: --samples requires a non-negative integer');
      args.sampleLimit = value;
      i++;
      continue;
    }
    if (valueFlags[arg]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`validate-graph: ${arg} requires a value`);
      args[valueFlags[arg]] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`validate-graph: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`validate-graph: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) {
    throw new Error('Usage: node validate-graph.mjs <projectRoot> [--graph <path>] [--out <path>] [--report <path>]');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const intermediate = join(resolveDataDir(projectRoot), 'intermediate');
  const graphPath = resolve(args.graph ?? join(intermediate, 'annotated-graph.json'));
  const outPath = resolve(args.out ?? join(intermediate, 'validated-graph.json'));
  const reportPath = resolve(args.report ?? join(intermediate, 'validation.json'));

  if (!existsSync(graphPath)) throw new Error(`validate-graph: graph not found: ${graphPath}`);
  // The published graph is line-oriented (knowledge-graph.jsonl); the Full
  // pipeline's intermediate graphs are still whole-document JSON.
  const graph = graphPath.endsWith('.jsonl')
    ? readKnowledgeGraph(graphPath)
    : JSON.parse(readFileSync(graphPath, 'utf-8'));

  const { validated, report } = validateAgainstSource({
    graph,
    reader: createSourceReader(projectRoot),
    sampleLimit: args.sampleLimit,
  });

  mkdirSync(dirname(outPath), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  if (outPath.endsWith('.jsonl')) {
    writeKnowledgeGraph(outPath, validated);
  } else {
    writeFileSync(outPath, JSON.stringify(validated, null, 2), 'utf-8');
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  const c = report.counts;
  process.stderr.write(
    `validate-graph: nodes-checked=${c.nodesChecked} anchor-mismatch=${c.anchorMismatch} ` +
    `edges-checked=${c.edgesChecked} edge-contradicted=${c.edgeContradicted} ` +
    `edges-inferred=${c.edgesInferred} step-unanchored=${c.stepUnanchored} ` +
    `source-missing=${c.sourceMissing} path-out-of-scope=${c.pathOutOfScope} ` +
    `construct-too-long=${c.constructTooLong} issues=${report.issues.length}\n`,
  );
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`validate-graph.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default {
  validateAgainstSource, createSourceReader, resolveWithinRoot, findToken,
  findTokenInImportStatement, endsImportStatement, expectedTokens,
  ANCHOR_TOLERANCE, IMPORT_WINDOW_LINES,
};
