#!/usr/bin/env node
/**
 * publish-annotations.mjs
 *
 * Save sub-step 7.1 (added). The supplement layer had a hole at the end of the
 * pipeline: phases 2.3 / 2.5 / 6b write their findings into
 * `intermediate/annotated-graph.json` and `validated-graph.json`, but the file
 * a consumer reads is `knowledge-graph.json`, written from the assembled graph
 * — and the SAVE phase then moves `intermediate/` into `.trash-*`. So
 * `coverage`, `gaps`, edge `provenance`/`evidence`, node `verification` /
 * `owner` / `anchorSource`, the digests, and the domain steps' `nodeIds`
 * existed for a few minutes and were thrown away.
 *
 * This script carries exactly those fields across, into the published files:
 *
 *   - node fields matched BY ID, edge fields matched by
 *     `(source, target, type, direction)`;
 *   - root `coverage` and `gaps`, and the `project` extras
 *     (`sourceDigest`, `factsDigest`, `pipelineVersion`, `model`,
 *     `verification`);
 *   - the same for `domain-graph.json` from the annotated domain analysis.
 *
 * What it will NOT do, by construction rather than by care:
 *
 *   - write any field outside the published-field allowlist, so a `summary`,
 *     a `name`, an `id`, a `weight` or a `tags` array cannot be touched;
 *   - add or remove a node or an edge — a supplement-only edge (annotate's
 *     `addedBy: "excavator-annotate"`) is counted under `edge-not-published`
 *     rather than appended, because appending would make this script an
 *     author of the published graph;
 *   - publish `project.gitCommitHash` — the audited copy normalises it, and
 *     the published value is the pipeline's own;
 *   - overwrite an `evidence` array if that would DROP an entry the published
 *     graph already carries (counted under `evidence-not-superset`).
 *
 * It also copies the audit/validation reports to `<dataDir>/excavator/`, which
 * is outside `intermediate/` and therefore survives the SAVE cleanup. That
 * directory is inside `.excavator/`, which the pipeline already treats as a
 * generated root, so nothing needed to be added anywhere for it to be ignored.
 *
 * Usage:
 *   node publish-annotations.mjs <projectRoot>
 *     [--graph <knowledge-graph.json>] [--annotated <path>]
 *     [--domain-graph <domain-graph.json>] [--domain-annotated <path>]
 *     [--reports-dir <dir>] [--report <path>] [--no-reports]
 *
 * A missing input is a printed note and a zero exit, never a crash: this runs
 * at the end of a long analysis, and failing the save because an optional
 * supplement phase was skipped would be the wrong trade.
 *
 * Determinism: field order preserved, no timestamps, `coverage`/`gaps`
 * replaced rather than appended, so running it twice equals running it once.
 *
 * Logging: stderr only.
 */

import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs';

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

/** Node fields the supplement layer owns. Nothing else is ever written. */
export const NODE_FIELDS = Object.freeze([
  'verification', 'owner', 'owners', 'anchorSource', 'provenance',
  'evidence', 'nodeIds', 'unresolvedNodeIds',
]);

/** Edge fields the supplement layer owns. */
export const EDGE_FIELDS = Object.freeze(['provenance', 'evidence', 'verification', 'addedBy']);

/** `project` keys the supplement layer owns. `gitCommitHash` is NOT one. */
export const PROJECT_FIELDS = Object.freeze([
  'sourceDigest', 'factsDigest', 'pipelineVersion', 'model', 'verification',
]);

/** Root keys copied wholesale. */
export const ROOT_FIELDS = Object.freeze(['coverage', 'gaps']);

/** Reports moved out of `intermediate/` so the SAVE cleanup cannot take them. */
export const REPORT_FILES = Object.freeze([
  'audit.json',
  'validation.json',
  'contradicted-summaries.json',
  'summary-verification.json',
  'summary-verify-manifest.json',
  'domain-annotation.json',
]);

function edgeKeyOf(edge) {
  return `${edge?.type}|${edge?.source}|${edge?.target}|${edge?.direction}`;
}

function evidenceKeyOf(entry) {
  return `${entry?.file}|${entry?.line}|${entry?.source}`;
}

/**
 * Would replacing `published` with `annotated` lose an entry? The annotated
 * copy is supposed to be a superset (annotate appends, never drops), so a
 * failure here means an assumption broke and the safe move is to keep what is
 * published.
 */
export function isEvidenceSuperset(annotated, published) {
  if (!Array.isArray(published) || published.length === 0) return true;
  if (!Array.isArray(annotated)) return false;
  const have = new Set(annotated.map(evidenceKeyOf));
  return published.every((entry) => have.has(evidenceKeyOf(entry)));
}

/**
 * Merge the supplement fields of `annotated` into `published`.
 *
 * Pure over two already-parsed graphs; returns a new published graph plus the
 * counts. Field order is preserved for keys that already exist, so a graph
 * that has been published once does not churn on the next run.
 */
export function mergeAnnotations({ published, annotated }) {
  const merged = JSON.parse(JSON.stringify(published));
  merged.nodes = Array.isArray(merged.nodes) ? merged.nodes : [];
  merged.edges = Array.isArray(merged.edges) ? merged.edges : [];

  const counts = {
    nodesPublished: merged.nodes.length,
    edgesPublished: merged.edges.length,
    nodeFieldsWritten: 0,
    edgeFieldsWritten: 0,
    nodesMatched: 0,
    edgesMatched: 0,
    nodeNotPublished: 0,
    edgeNotPublished: 0,
    edgeKeyAmbiguous: 0,
    evidenceNotSuperset: 0,
    projectFieldsWritten: 0,
    rootFieldsWritten: 0,
  };
  const samples = { nodeNotPublished: [], edgeNotPublished: [], evidenceNotSuperset: [] };
  const note = (list, value) => {
    if (list.length < 5) list.push(value);
  };

  const nodesById = new Map();
  for (const node of merged.nodes) {
    if (node && typeof node === 'object' && node.id !== undefined) nodesById.set(node.id, node);
  }
  const edgesByKey = new Map();
  for (const edge of merged.edges) {
    if (!edge || typeof edge !== 'object') continue;
    const key = edgeKeyOf(edge);
    if (!edgesByKey.has(key)) edgesByKey.set(key, []);
    edgesByKey.get(key).push(edge);
  }

  for (const source of annotated?.nodes ?? []) {
    if (!source || typeof source !== 'object') continue;
    const target = nodesById.get(source.id);
    if (!target) {
      // A node the audit knows and the published graph does not. Never added:
      // the published graph's node set is UA's.
      counts.nodeNotPublished += 1;
      note(samples.nodeNotPublished, String(source.id));
      continue;
    }
    counts.nodesMatched += 1;
    for (const field of NODE_FIELDS) {
      if (!Object.hasOwn(source, field)) continue;
      if (field === 'evidence' && !isEvidenceSuperset(source.evidence, target.evidence)) {
        counts.evidenceNotSuperset += 1;
        note(samples.evidenceNotSuperset, `node ${source.id}`);
        continue;
      }
      target[field] = source[field];
      counts.nodeFieldsWritten += 1;
    }
  }

  for (const source of annotated?.edges ?? []) {
    if (!source || typeof source !== 'object') continue;
    const key = edgeKeyOf(source);
    const targets = edgesByKey.get(key);
    if (!targets || targets.length === 0) {
      counts.edgeNotPublished += 1;
      note(samples.edgeNotPublished, key);
      continue;
    }
    if (targets.length > 1) counts.edgeKeyAmbiguous += 1;
    counts.edgesMatched += 1;
    for (const target of targets) {
      for (const field of EDGE_FIELDS) {
        if (!Object.hasOwn(source, field)) continue;
        if (field === 'evidence' && !isEvidenceSuperset(source.evidence, target.evidence)) {
          counts.evidenceNotSuperset += 1;
          note(samples.evidenceNotSuperset, `edge ${key}`);
          continue;
        }
        target[field] = source[field];
        counts.edgeFieldsWritten += 1;
      }
    }
  }

  for (const field of ROOT_FIELDS) {
    if (!Object.hasOwn(annotated ?? {}, field)) continue;
    merged[field] = annotated[field];
    counts.rootFieldsWritten += 1;
  }

  if (merged.project && typeof merged.project === 'object'
    && annotated?.project && typeof annotated.project === 'object') {
    for (const field of PROJECT_FIELDS) {
      if (!Object.hasOwn(annotated.project, field)) continue;
      merged.project[field] = annotated.project[field];
      counts.projectFieldsWritten += 1;
    }
  }

  return { merged, counts, samples };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    projectRoot: null, graph: null, annotated: null,
    domainGraph: null, domainAnnotated: null,
    reportsDir: null, report: null, writeReports: true,
  };
  const valueFlags = {
    '--graph': 'graph', '--annotated': 'annotated',
    '--domain-graph': 'domainGraph', '--domain-annotated': 'domainAnnotated',
    '--reports-dir': 'reportsDir', '--report': 'report',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-reports') { args.writeReports = false; continue; }
    if (valueFlags[arg]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`publish-annotations: ${arg} requires a value`);
      args[valueFlags[arg]] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`publish-annotations: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`publish-annotations: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) {
    throw new Error(
      'Usage: node publish-annotations.mjs <projectRoot> [--graph <path>] [--annotated <path>] ' +
      '[--domain-graph <path>] [--domain-annotated <path>] [--reports-dir <dir>] [--no-reports]',
    );
  }
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** The most complete supplement copy that exists, in preference order. */
function pickAnnotated(intermediate, override) {
  if (override) return existsSync(resolve(override)) ? resolve(override) : null;
  for (const name of ['validated-graph.json', 'annotated-graph.json']) {
    const candidate = join(intermediate, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function publishPair({ label, publishedPath, annotatedPath }) {
  if (!existsSync(publishedPath)) {
    process.stderr.write(
      `publish-annotations: no ${label} at ${publishedPath} — nothing to publish into\n`,
    );
    return null;
  }
  if (!annotatedPath) {
    process.stderr.write(
      `publish-annotations: no annotated ${label} found — ${label} left exactly as the pipeline wrote it\n`,
    );
    return null;
  }
  const { merged, counts, samples } = mergeAnnotations({
    published: readJson(publishedPath),
    annotated: readJson(annotatedPath),
  });
  writeFileSync(publishedPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  process.stderr.write(
    `publish-annotations: ${label} nodes=${counts.nodesMatched}/${counts.nodesPublished} ` +
    `edges=${counts.edgesMatched}/${counts.edgesPublished} ` +
    `node-fields=${counts.nodeFieldsWritten} edge-fields=${counts.edgeFieldsWritten} ` +
    `root-fields=${counts.rootFieldsWritten} project-fields=${counts.projectFieldsWritten} ` +
    `node-not-published=${counts.nodeNotPublished} edge-not-published=${counts.edgeNotPublished} ` +
    `evidence-not-superset=${counts.evidenceNotSuperset}\n`,
  );
  return { source: basename(annotatedPath), counts, samples };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const dataDir = resolveDataDir(projectRoot);
  const intermediate = join(dataDir, 'intermediate');
  const reportsDir = resolve(args.reportsDir ?? join(dataDir, 'excavator'));

  const knowledge = publishPair({
    label: 'knowledge-graph.json',
    publishedPath: resolve(args.graph ?? join(dataDir, 'knowledge-graph.json')),
    annotatedPath: pickAnnotated(intermediate, args.annotated),
  });

  const domainAnnotated = args.domainAnnotated
    ? (existsSync(resolve(args.domainAnnotated)) ? resolve(args.domainAnnotated) : null)
    : (existsSync(join(intermediate, 'domain-analysis.json'))
      ? join(intermediate, 'domain-analysis.json')
      : null);
  const domain = publishPair({
    label: 'domain-graph.json',
    publishedPath: resolve(args.domainGraph ?? join(dataDir, 'domain-graph.json')),
    annotatedPath: domainAnnotated,
  });

  const copied = [];
  if (args.writeReports) {
    mkdirSync(reportsDir, { recursive: true });
    for (const name of REPORT_FILES) {
      const from = join(intermediate, name);
      if (!existsSync(from)) continue;
      copyFileSync(from, join(reportsDir, name));
      copied.push(name);
    }
    if (copied.length === 0) {
      process.stderr.write(
        'publish-annotations: no audit or validation report found to preserve\n',
      );
    } else {
      process.stderr.write(
        `publish-annotations: preserved ${copied.length} report(s) in ${reportsDir}: ${copied.join(', ')}\n`,
      );
    }
    const reportPath = resolve(args.report ?? join(reportsDir, 'publish.json'));
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify({
      scriptCompleted: true,
      knowledgeGraph: knowledge,
      domainGraph: domain,
      reportsPreserved: copied,
    }, null, 2)}\n`, 'utf-8');
  }

  if (!knowledge && !domain) {
    process.stderr.write(
      'publish-annotations: nothing was published (no published graph had an annotated counterpart)\n',
    );
  }
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
    process.stderr.write(`publish-annotations.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default {
  mergeAnnotations, isEvidenceSuperset,
  NODE_FIELDS, EDGE_FIELDS, PROJECT_FIELDS, ROOT_FIELDS, REPORT_FILES,
};
