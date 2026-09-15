#!/usr/bin/env node
/**
 * annotate-domain.mjs
 *
 * Domain phase 4.5 (added, after the domain analysis, before the save). A
 * business step is the one node type whose whole value is the claim "this is
 * where that happens in the code" — and until now nothing tied it to a node.
 * This script anchors every `step` to real knowledge-graph node ids:
 *
 *   - ids the model supplied are CHECKED against the knowledge graph. Ones
 *     that resolve stay first, in the model's order; ones that do not are
 *     moved to `unresolvedNodeIds` and counted, so a reconstructed id is
 *     visible instead of sitting in `nodeIds` looking like an anchor.
 *   - ids it did not supply are DERIVED: knowledge-graph nodes on the same
 *     `filePath` whose `lineRange` intersects the step's, or that file's own
 *     node when the step gives no usable range.
 *   - `evidence` is emitted only where a matched node has a real line. A
 *     step anchored to a whole file gets no evidence entry and is counted
 *     under `step-evidence-unavailable`, because `line: 1` would let a later
 *     check "confirm" a claim nobody made.
 *
 * It reads no source files: the knowledge graph already carries the anchors,
 * and inventing a second opinion about them here would be a second source of
 * truth. `step-unanchored` is deliberately NOT written here — that count
 * belongs to the validator, and writing it in both places would double it.
 *
 * Domain freshness keys (added; openspec: changes/full-semantic-isolation,
 * capability `domain-freshness`, design D4). This is also where
 * `domain-graph.json`'s two freshness fields get stamped, at the TOP level
 * of the annotated domain graph: `sourceRevision` (the persisted
 * `source-manifest.json`'s `sourceRevision` at the time Domain ran — the
 * SAME value the fact layer was built against, read directly rather than
 * re-resolved, so a domain graph never claims a newer revision than the
 * knowledge graph it was derived from) and `factDigest` (the knowledge
 * graph's own `project.factsDigest` — the identical value
 * `semantic-graph.mjs`'s factDigest gate reads, so "the fact layer this
 * Domain analysis was anchored against" has exactly one meaning across the
 * codebase). Neither field is invented when its source is unavailable: a
 * project with no `source-manifest.json` yet (never analyzed) or no
 * `knowledge-graph.json` gets NO `sourceRevision`/`factDigest` key at all,
 * which `domain-freshness.mjs`'s gate then correctly reads as "never
 * usable" rather than a fabricated match. See `domain-freshness.mjs` for the
 * consumption side of this contract.
 *
 * Usage:
 *   node annotate-domain.mjs <projectRoot>
 *     [--domain <domain-analysis.json>] [--graph <knowledge-graph.json>]
 *     [--out <path>] [--report <path>] [--samples <n>]
 *
 * `--out` defaults to the domain input path, so the save phase picks the
 * anchored graph up with no change to how it is invoked.
 *
 * Determinism: no timestamps, ids and samples sorted, this script's own gap
 * rows replaced rather than appended, so two runs give the same bytes.
 *
 * Logging: stderr only.
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';

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

/** Gap kinds this script owns and therefore replaces on a re-run. */
export const OWNED_GAP_KINDS = Object.freeze([
  'step-nodeid-unresolved',
  'step-evidence-unavailable',
  'step-file-anchored',
]);

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Is this a range we can intersect? The domain-analyzer's own template shows
 * `lineRange: [0, 0]` as the placeholder for "unknown", so a zero is absence,
 * not line zero.
 */
export function usableRange(range) {
  return (
    Array.isArray(range) &&
    Number.isInteger(range[0]) && Number.isInteger(range[1]) &&
    range[0] >= 1 && range[1] >= range[0]
  );
}

function intersects(a, b) {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** Index the knowledge graph by id and by file path. */
export function indexKnowledge(knowledgeGraph) {
  const byId = new Map();
  const byFile = new Map();
  for (const node of knowledgeGraph?.nodes ?? []) {
    if (!node || typeof node !== 'object' || node.id === undefined) continue;
    byId.set(node.id, node);
    if (typeof node.filePath !== 'string' || node.filePath.length === 0) continue;
    if (!byFile.has(node.filePath)) byFile.set(node.filePath, []);
    byFile.get(node.filePath).push(node);
  }
  for (const list of byFile.values()) {
    list.sort((a, b) => {
      const aStart = usableRange(a.lineRange) ? a.lineRange[0] : 0;
      const bStart = usableRange(b.lineRange) ? b.lineRange[0] : 0;
      return aStart - bStart || compareStrings(String(a.id), String(b.id));
    });
  }
  return { byId, byFile };
}

/**
 * Knowledge-graph nodes that implement a step, by file and line intersection.
 *
 * Declarations that overlap the step's range are the answer when there are
 * any. Otherwise the file's own node stands in — that is a weaker anchor
 * ("somewhere in this file"), so it is reported separately rather than
 * counted as the same thing.
 */
export function deriveStepNodes(step, index) {
  const path = typeof step?.filePath === 'string' ? step.filePath : null;
  if (!path) return { nodes: [], viaFile: false };
  const candidates = index.byFile.get(path) ?? [];
  if (candidates.length === 0) return { nodes: [], viaFile: false };

  if (usableRange(step.lineRange)) {
    const overlapping = candidates.filter(
      (node) => usableRange(node.lineRange) && intersects(step.lineRange, node.lineRange),
    );
    if (overlapping.length > 0) return { nodes: overlapping, viaFile: false };
  }

  const fileNodes = candidates.filter((node) => !usableRange(node.lineRange));
  if (fileNodes.length > 0) return { nodes: fileNodes, viaFile: true };
  return { nodes: [], viaFile: false };
}

/** Evidence entries for matched nodes that actually carry a line. */
function evidenceFor(nodes) {
  const seen = new Set();
  const evidence = [];
  for (const node of nodes) {
    if (!usableRange(node.lineRange)) continue;
    const key = `${node.filePath}|${node.lineRange[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push({ file: node.filePath, line: node.lineRange[0], source: 'rule' });
  }
  return evidence;
}

/**
 * The whole annotation. Pure over two already-parsed graphs.
 *
 * @param {{
 *   domainGraph: object, knowledgeGraph: object|null, sampleLimit?: number,
 *   sourceRevision?: string|null,
 * }} args `sourceRevision` is the persisted source-manifest.json's
 *   `sourceRevision` at call time (the CLI reads it; a direct unit-test call
 *   may omit it, in which case no `sourceRevision`/`factDigest` key is
 *   stamped at all — see the module doc's "Domain freshness keys" section).
 */
export function annotateDomain({ domainGraph, knowledgeGraph, sampleLimit = 5, sourceRevision = null }) {
  const annotated = clone(domainGraph);
  annotated.nodes = Array.isArray(annotated.nodes) ? annotated.nodes : [];

  const index = indexKnowledge(knowledgeGraph);
  const counts = {
    knowledgeNodes: index.byId.size,
    stepsTotal: 0,
    stepsWithModelIds: 0,
    modelIdsResolved: 0,
    modelIdsUnresolved: 0,
    stepsDerived: 0,
    idsDerived: 0,
    stepsFileAnchored: 0,
    stepsAnchored: 0,
    stepsUnanchored: 0,
    stepsWithEvidence: 0,
    stepsWithoutEvidence: 0,
    stepsMarkedInferred: 0,
  };
  const samples = { unresolved: [], unanchored: [], fileAnchored: [], noEvidence: [] };
  const push = (list, value) => {
    if (list.length < sampleLimit) list.push(value);
  };

  for (const node of annotated.nodes) {
    if (!node || typeof node !== 'object' || node.type !== 'step') continue;
    counts.stepsTotal += 1;
    if (node.provenance === 'inferred') counts.stepsMarkedInferred += 1;

    // Ids a previous run moved to `unresolvedNodeIds` are re-checked, not
    // forgotten: they may exist now, and re-reading them is what makes a
    // second run over the same inputs produce the same counts instead of
    // losing the ones it already moved aside.
    const modelIds = [];
    for (const id of [
      ...(Array.isArray(node.nodeIds) ? node.nodeIds : []),
      ...(Array.isArray(node.unresolvedNodeIds) ? node.unresolvedNodeIds : []),
    ]) {
      if (id === undefined || id === null) continue;
      if (!modelIds.includes(id)) modelIds.push(id);
    }
    if (modelIds.length > 0) counts.stepsWithModelIds += 1;

    const resolvedIds = [];
    const unresolvedIds = [];
    for (const id of modelIds) {
      if (index.byId.has(id)) {
        if (!resolvedIds.includes(id)) resolvedIds.push(id);
      } else if (!unresolvedIds.includes(id)) {
        unresolvedIds.push(id);
      }
    }
    counts.modelIdsResolved += resolvedIds.length;
    counts.modelIdsUnresolved += unresolvedIds.length;
    for (const id of unresolvedIds) push(samples.unresolved, `${node.id} -> ${id}`);

    const derived = deriveStepNodes(node, index);
    const derivedIds = derived.nodes
      .map((match) => match.id)
      .filter((id) => !resolvedIds.includes(id));
    if (derivedIds.length > 0) {
      counts.stepsDerived += 1;
      counts.idsDerived += derivedIds.length;
    }

    const finalIds = [...resolvedIds, ...derivedIds];
    const anchorNodes = finalIds.map((id) => index.byId.get(id)).filter(Boolean);
    // A property of the OUTCOME, not of how the ids got here: a step whose
    // every anchor is a whole file is anchored weakly whether the model named
    // that file node or this script derived it. Deriving the count from the
    // final set is also what keeps it stable across a second run.
    if (finalIds.length > 0 && anchorNodes.every((match) => !usableRange(match.lineRange))) {
      counts.stepsFileAnchored += 1;
      push(samples.fileAnchored, String(node.id));
    }

    if (finalIds.length > 0) {
      node.nodeIds = finalIds;
      counts.stepsAnchored += 1;
    } else {
      // Nothing resolves and nothing derives. `nodeIds` is left exactly as
      // the model wrote it (possibly absent) and NOT marked inferred here:
      // the validator's `step-unanchored` is the visible bucket for this, and
      // silencing it from the inside would be the one thing this script must
      // not do.
      counts.stepsUnanchored += 1;
      push(samples.unanchored, String(node.id));
    }

    if (unresolvedIds.length > 0) node.unresolvedNodeIds = unresolvedIds;
    else if (node.unresolvedNodeIds !== undefined) delete node.unresolvedNodeIds;

    const evidence = evidenceFor(anchorNodes);
    if (evidence.length > 0) {
      node.evidence = evidence;
      counts.stepsWithEvidence += 1;
    } else if (finalIds.length > 0) {
      counts.stepsWithoutEvidence += 1;
      push(samples.noEvidence, String(node.id));
    }
  }

  const kept = (Array.isArray(annotated.gaps) ? annotated.gaps : []).filter(
    (gap) => !OWNED_GAP_KINDS.includes(gap?.kind),
  );
  const gaps = [...kept];
  const addGap = (kind, count, reason, sampleList) => {
    if (count <= 0) return;
    gaps.push({ kind, scope: 'domain', reason, count, samples: sampleList.slice().sort(compareStrings) });
  };
  addGap('step-nodeid-unresolved', counts.modelIdsUnresolved,
    `${counts.modelIdsUnresolved} step nodeId(s) name a node that is not in the knowledge graph`,
    samples.unresolved);
  addGap('step-evidence-unavailable', counts.stepsWithoutEvidence,
    `${counts.stepsWithoutEvidence} anchored step(s) have no node with a line to cite`,
    samples.noEvidence);
  addGap('step-file-anchored', counts.stepsFileAnchored,
    `${counts.stepsFileAnchored} step(s) are anchored to a whole file rather than a declaration`,
    samples.fileAnchored);
  gaps.sort((a, b) => compareStrings(a.kind, b.kind) || compareStrings(a.scope, b.scope));
  annotated.gaps = gaps;

  // Domain freshness keys (design D4) — stamped only when their source value
  // is actually known. A caller that omits `sourceRevision` (an existing
  // unit test, or a standalone run with no source-manifest.json yet) gets NO
  // `sourceRevision`/`factDigest` key at all rather than a fabricated one;
  // `domain-freshness.mjs`'s gate treats an absent key as "never usable".
  if (typeof sourceRevision === 'string' && sourceRevision.length > 0) {
    annotated.sourceRevision = sourceRevision;
  }
  if (typeof knowledgeGraph?.project?.factsDigest === 'string' && knowledgeGraph.project.factsDigest.length > 0) {
    annotated.factDigest = knowledgeGraph.project.factsDigest;
  }

  const report = {
    scriptCompleted: true,
    counts,
    samples: {
      unresolvedNodeIds: samples.unresolved.slice().sort(compareStrings),
      unanchoredSteps: samples.unanchored.slice().sort(compareStrings),
      fileAnchoredSteps: samples.fileAnchored.slice().sort(compareStrings),
      stepsWithoutEvidence: samples.noEvidence.slice().sort(compareStrings),
    },
    conserves: counts.stepsAnchored + counts.stepsUnanchored === counts.stepsTotal,
  };

  return { annotated, report };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { projectRoot: null, domain: null, graph: null, out: null, report: null, sampleLimit: 5 };
  const valueFlags = {
    '--domain': 'domain', '--graph': 'graph', '--out': 'out', '--report': 'report',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--samples') {
      const value = Number.parseInt(argv[i + 1], 10);
      if (!Number.isInteger(value) || value < 0) throw new Error('annotate-domain: --samples requires a non-negative integer');
      args.sampleLimit = value;
      i++;
      continue;
    }
    if (valueFlags[arg]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`annotate-domain: ${arg} requires a value`);
      args[valueFlags[arg]] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`annotate-domain: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`annotate-domain: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) {
    throw new Error(
      'Usage: node annotate-domain.mjs <projectRoot> [--domain <path>] [--graph <path>] ' +
      '[--out <path>] [--report <path>] [--samples <n>]',
    );
  }
  return args;
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`annotate-domain: ${label} not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const dataDir = resolveDataDir(projectRoot);
  const intermediate = join(dataDir, 'intermediate');
  const domainPath = resolve(args.domain ?? join(intermediate, 'domain-analysis.json'));
  const graphPath = resolve(args.graph ?? join(dataDir, 'knowledge-graph.json'));
  const outPath = resolve(args.out ?? domainPath);
  const reportPath = resolve(args.report ?? join(intermediate, 'domain-annotation.json'));

  const domainGraph = readJson(domainPath, 'domain analysis');
  // Without a knowledge graph there is nothing to anchor TO. That is not an
  // error — the standalone path builds the domain graph from a lightweight
  // scan — but every step then comes back unanchored, said out loud rather
  // than looking anchored.
  const knowledgeGraph = existsSync(graphPath)
    ? JSON.parse(readFileSync(graphPath, 'utf-8'))
    : null;
  if (!knowledgeGraph) {
    process.stderr.write(
      `Warning: annotate-domain: no knowledge graph at ${graphPath} — steps cannot be anchored to node ids\n`,
    );
  }

  // Domain freshness (design D4): read the sourceRevision the FACT LAYER was
  // built against — the persisted source-manifest.json — rather than
  // re-resolving a live SourceSnapshot here. A domain graph's stamped
  // sourceRevision then means exactly "the source state the knowledge graph
  // it was derived from reflects", which is what `domain-freshness.mjs`'s
  // gate compares against later. A missing/corrupt manifest (a project never
  // analyzed, or an older Lazy/Full project) is not fatal — it just means no
  // sourceRevision gets stamped, and the domain graph is correctly never
  // "usable" downstream.
  const manifestPath = join(dataDir, 'source-manifest.json');
  let sourceRevision = null;
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (typeof manifest?.sourceRevision === 'string' && manifest.sourceRevision.length > 0) {
        sourceRevision = manifest.sourceRevision;
      }
    } catch {
      // Corrupt manifest — leave sourceRevision null, surfaced downstream as
      // "not stamped" rather than crashing Domain analysis over it.
    }
  }

  const { annotated, report } = annotateDomain({
    domainGraph, knowledgeGraph, sampleLimit: args.sampleLimit, sourceRevision,
  });

  writeJson(outPath, annotated);
  writeJson(reportPath, report);

  const c = report.counts;
  process.stderr.write(
    `annotate-domain: steps=${c.stepsTotal} anchored=${c.stepsAnchored} unanchored=${c.stepsUnanchored} ` +
    `model-ids-resolved=${c.modelIdsResolved} model-ids-unresolved=${c.modelIdsUnresolved} ` +
    `derived=${c.idsDerived} file-anchored=${c.stepsFileAnchored} ` +
    `with-evidence=${c.stepsWithEvidence}\n`,
  );
  if (!report.conserves) {
    process.stderr.write('Warning: annotate-domain: step buckets do not account for every step\n');
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
    process.stderr.write(`annotate-domain.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default {
  annotateDomain, deriveStepNodes, indexKnowledge, usableRange, OWNED_GAP_KINDS,
};
