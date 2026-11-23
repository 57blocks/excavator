#!/usr/bin/env node
/**
 * relations-freshness.mjs
 *
 * Decides whether `.excavator/relations-graph.json` still describes the
 * project as it is, so the skill's terminal queries never answer from a
 * stale graph. Same contract as the domain graph's freshness gate:
 *   - `sourceRevision` must equal the current one, resolved only through the
 *     shared `resolveFreshness` helper (never by running git here);
 *   - `factDigest`, when the graph was made with a knowledge graph, must
 *     equal the current knowledge graph's `project.factsDigest` (node ids are
 *     ids into that graph). A graph made without one carries null and is
 *     checked on the source revision alone.
 * Reads only relations-graph.json and the knowledge graph's header line. No
 * model, no source file.
 *
 * Usage: node relations-freshness.mjs <projectRoot>
 *   prints `{ usable, status, reason }` as JSON.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveFreshness } from '../excavator/consumer-freshness.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraphHeader } from '../excavator/knowledge-graph-store.mjs';
import { GRAPH_FILE, GRAPH_FORMAT } from './merge-relations.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');

/**
 * Pure decision. Returns { usable, status: fresh|stale|missing|unknown-format, reason }.
 */
export function isRelationsGraphUsable({ graph, currentSourceRevision, currentFactDigest }) {
  if (!graph || typeof graph !== 'object') return { usable: false, status: 'missing', reason: 'no relations graph - run /excavator-relations' };
  if (graph.format !== GRAPH_FORMAT) return { usable: false, status: 'unknown-format', reason: `format is ${JSON.stringify(graph.format)}, expected ${GRAPH_FORMAT} - run /excavator-relations again` };
  if (typeof graph.sourceRevision !== 'string' || graph.sourceRevision.length === 0) {
    return { usable: false, status: 'stale', reason: 'the relations graph carries no sourceRevision - run /excavator-relations again' };
  }
  if (typeof currentSourceRevision !== 'string' || currentSourceRevision.length === 0) {
    return { usable: false, status: 'stale', reason: 'the current sourceRevision could not be resolved' };
  }
  if (graph.sourceRevision !== currentSourceRevision) {
    return { usable: false, status: 'stale', reason: `sourceRevision mismatch (relations graph: ${graph.sourceRevision}, current: ${currentSourceRevision}) - run /excavator-relations again` };
  }
  if (typeof graph.factDigest === 'string' && graph.factDigest.length > 0 && graph.factDigest !== currentFactDigest) {
    return { usable: false, status: 'stale', reason: 'factDigest mismatch: the knowledge graph changed since the relations were made; node ids may be stale - run /excavator-relations again' };
  }
  return { usable: true, status: 'fresh', reason: graph.factDigest ? 'sourceRevision and factDigest match' : 'sourceRevision matches (made without a knowledge graph)' };
}

async function resolveCore() {
  const require = createRequire(resolve(pluginRoot, 'package.json'));
  try {
    return await import(pathToFileURL(require.resolve('@excavator/core')).href);
  } catch {
    return import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
  }
}

/** I/O wrapper; never throws. */
export async function resolveRelationsFreshness(projectRoot) {
  const root = resolve(projectRoot);
  let dataDir;
  try {
    dataDir = (await resolveCore()).resolveDataDir(root);
  } catch (error) {
    return { usable: false, status: 'missing', reason: `could not resolve @excavator/core: ${error.message}` };
  }
  const path = join(dataDir, GRAPH_FILE);
  if (!existsSync(path)) return isRelationsGraphUsable({ graph: null });
  let graph;
  try {
    graph = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    return { usable: false, status: 'missing', reason: `relations-graph.json is not valid JSON: ${error.message}` };
  }
  let currentFactDigest = null;
  const kg = join(dataDir, KNOWLEDGE_GRAPH_FILE);
  if (existsSync(kg)) {
    try {
      const digest = readKnowledgeGraphHeader(kg).fields.project?.factsDigest;
      if (typeof digest === 'string') currentFactDigest = digest;
    } catch { /* null: reported as a mismatch when the graph has one */ }
  }
  const { currentSourceRevision } = await resolveFreshness(root);
  return isRelationsGraphUsable({ graph, currentSourceRevision, currentFactDigest });
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
  const [projectRoot] = process.argv.slice(2);
  if (!projectRoot) {
    process.stderr.write('Usage: node relations-freshness.mjs <projectRoot>\n');
    process.exit(1);
  }
  const result = await resolveRelationsFreshness(projectRoot);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export default { isRelationsGraphUsable, resolveRelationsFreshness };
