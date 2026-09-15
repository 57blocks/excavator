#!/usr/bin/env node
/**
 * domain-freshness.mjs
 *
 * Domain freshness gate (openspec: changes/full-semantic-isolation,
 * capability `domain-freshness`, design D4). `annotate-domain.mjs` stamps
 * `domain-graph.json`'s top level with the current schema,
 * `contentLanguage: "en"`, `sourceRevision`, and `factDigest` — the
 * semantic/source/fact identity that was current when Domain analysis ran (see
 * that module's own doc comment for how those two values are derived). This
 * module is the other half of the contract: given an already-loaded domain
 * graph and the CURRENT fact layer's identity, decide whether that domain
 * graph is still usable, so a consumer never answers from a stale one.
 *
 * A domain graph is usable only when its schema/language identity is
 * canonical and BOTH fact keys match the current fact layer:
 *   - `sourceRevision` — compared against the CURRENT sourceRevision as
 *     resolved by the shared `resolveFreshness` helper
 *     (`skills/excavator/consumer-freshness.mjs`); Domain does not invent
 *     its own sourceRevision comparison, per design D5;
 *   - `factDigest` — compared directly against the current
 *     `knowledge-graph.json`'s `project.factsDigest` (the SAME digest
 *     `semantic-graph.mjs`'s factDigest gate reads). A knowledge graph can
 *     in principle be rebuilt from the same sourceRevision with a different
 *     fact projection (e.g. a pipeline-version bump), and a domain step's
 *     `nodeIds` are ids INTO that specific fact graph, so sourceRevision
 *     alone is not sufficient.
 *
 * MUST NOT call any model, MUST NOT read source files directly (only
 * `domain-graph.json`/`knowledge-graph.json`, and `sourceRevision` only via
 * the shared helper's own SourceSnapshot resolution). domain/flow/step nodes
 * remain hints even when `usable` is true — a consumer answering a
 * business-flow question re-checks against the fact graph / source before
 * treating them as evidence (spec Requirement "a stale Domain graph must not
 * enter an answer", scenario "a fresh Domain graph is only a hint, re-verified
 * against the source before it is used").
 *
 * Usage (CLI):
 *   node domain-freshness.mjs <projectRoot>
 *     prints `{ usable, status, reason }` as JSON to stdout.
 *
 * Programmatic:
 *   import { isDomainGraphUsable, resolveDomainFreshness } from './domain-freshness.mjs';
 *
 * Contract: openspec/changes/full-semantic-isolation/specs/domain-freshness/spec.md
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync } from 'node:fs';

import { resolveFreshness } from '../excavator/consumer-freshness.mjs';
import { hasCanonicalDomainIdentity } from './domain-contract.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

/** Same two-step @excavator/core resolution every sibling script uses. */
async function resolveCore(root) {
  const require = createRequire(resolve(root, 'package.json'));
  try {
    return await import(pathToFileURL(require.resolve('@excavator/core')).href);
  } catch {
    return await import(pathToFileURL(resolve(root, 'packages/core/dist/index.js')).href);
  }
}

/**
 * Pure decision: is `domainGraph` usable against the given current values?
 * No I/O, no model call.
 *
 * @param {{
 *   domainGraph: object|null,
 *   currentSourceRevision: string|null,
 *   currentFactDigest: string|null,
 * }} args
 * @returns {{ usable: boolean, status: 'fresh'|'stale'|'missing'|'noncanonical-language', reason: string }}
 */
export function isDomainGraphUsable({ domainGraph, currentSourceRevision, currentFactDigest }) {
  if (!domainGraph || typeof domainGraph !== 'object') {
    return { usable: false, status: 'missing', reason: 'no domain graph to check' };
  }

  if (!hasCanonicalDomainIdentity(domainGraph)) {
    return {
      usable: false,
      status: 'noncanonical-language',
      reason: 'noncanonical-language: domain graph lacks the current schema with contentLanguage=en — re-run /excavator-domain',
    };
  }

  const domainSourceRevision = domainGraph.sourceRevision;
  if (typeof domainSourceRevision !== 'string' || domainSourceRevision.length === 0) {
    return {
      usable: false, status: 'stale',
      reason: 'domain graph carries no sourceRevision (produced before domain-freshness, or never stamped) — re-run /excavator-domain',
    };
  }

  const domainFactDigest = domainGraph.factDigest;
  if (typeof domainFactDigest !== 'string' || domainFactDigest.length === 0) {
    return {
      usable: false, status: 'stale',
      reason: 'domain graph carries no factDigest — re-run /excavator-domain',
    };
  }

  if (typeof currentSourceRevision !== 'string' || currentSourceRevision.length === 0) {
    return { usable: false, status: 'stale', reason: 'current sourceRevision could not be resolved' };
  }
  if (domainSourceRevision !== currentSourceRevision) {
    return {
      usable: false, status: 'stale',
      reason: `sourceRevision mismatch (domain graph: ${domainSourceRevision}, current: ${currentSourceRevision}) — the fact layer has moved since Domain last ran; re-run /excavator-domain`,
    };
  }

  if (typeof currentFactDigest !== 'string' || currentFactDigest.length === 0) {
    return { usable: false, status: 'stale', reason: 'no current knowledge-graph.json / factsDigest to compare against' };
  }
  if (domainFactDigest !== currentFactDigest) {
    return {
      usable: false, status: 'stale',
      reason: `factDigest mismatch (domain graph: ${domainFactDigest.slice(0, 12)}…, current: ${currentFactDigest.slice(0, 12)}…) — the fact projection changed since Domain last ran; re-run /excavator-domain`,
    };
  }

  return { usable: true, status: 'fresh', reason: 'sourceRevision and factDigest both match the current fact layer' };
}

/**
 * The I/O wrapper: reads `domain-graph.json` and `knowledge-graph.json` from
 * `projectRoot`'s data directory, resolves the current sourceRevision via
 * the shared `resolveFreshness` helper, and applies {@link isDomainGraphUsable}.
 * Never throws.
 *
 * @param {string} projectRoot
 * @returns {Promise<{
 *   usable: boolean,
 *   status: 'fresh'|'stale'|'missing'|'noncanonical-language',
 *   reason: string,
 *   domainGraph: object|null,
 * }>}
 */
export async function resolveDomainFreshness(projectRoot) {
  const root = resolve(projectRoot);

  let core;
  try {
    core = await resolveCore(pluginRoot);
  } catch (err) {
    return { usable: false, status: 'missing', reason: `could not resolve @excavator/core: ${err.message}`, domainGraph: null };
  }
  const dataDir = core.resolveDataDir(root);

  const domainPath = join(dataDir, 'domain-graph.json');
  if (!existsSync(domainPath)) {
    return { usable: false, status: 'missing', reason: 'no domain-graph.json — run /excavator-domain first', domainGraph: null };
  }
  let domainGraph;
  try {
    domainGraph = JSON.parse(readFileSync(domainPath, 'utf-8'));
  } catch (err) {
    return { usable: false, status: 'missing', reason: `domain-graph.json is not valid JSON: ${err.message}`, domainGraph: null };
  }

  const graphPath = join(dataDir, 'knowledge-graph.json');
  let currentFactDigest = null;
  if (existsSync(graphPath)) {
    try {
      const knowledgeGraph = JSON.parse(readFileSync(graphPath, 'utf-8'));
      if (typeof knowledgeGraph?.project?.factsDigest === 'string') {
        currentFactDigest = knowledgeGraph.project.factsDigest;
      }
    } catch {
      // leave currentFactDigest null — isDomainGraphUsable reports this as
      // "no current knowledge-graph.json / factsDigest to compare against".
    }
  }

  const freshness = await resolveFreshness(root);
  const { usable, status, reason } = isDomainGraphUsable({
    domainGraph,
    currentSourceRevision: freshness.currentSourceRevision,
    currentFactDigest,
  });

  return { usable, status, reason, domainGraph };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const [projectRoot] = process.argv.slice(2);
  if (!projectRoot) {
    process.stderr.write('Usage: node domain-freshness.mjs <projectRoot>\n');
    process.exit(1);
  }
  const { domainGraph, ...result } = await resolveDomainFreshness(projectRoot);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.stderr.write(`domain-freshness: usable=${result.usable} status=${result.status} (${result.reason})\n`);
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
    process.stderr.write(`domain-freshness.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default { isDomainGraphUsable, resolveDomainFreshness };
