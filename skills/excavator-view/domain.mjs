/**
 * domain.mjs
 *
 * Reads `domain-graph.json` and judges it (openspec: changes/viewer-app,
 * design D12): the pack's state for it, and the payload `sources.mjs` takes the
 * steps' files from. Identity and freshness are judged
 * here and never on the page:
 *   - `version` and `contentLanguage` must be the ones the Domain skill writes
 *     (`domain-contract.mjs`), and `nodes`, `edges`, `sourceRevision` and
 *     `factDigest` must be there, with every record carrying the fields the page
 *     reads; otherwise the file is unreadable and nothing of it is shown;
 *   - the graph is a different revision when its `sourceRevision` is not the
 *     snapshot's, or its `factDigest` is not the knowledge graph's `factsDigest`
 *     (a step's `nodeIds` are ids into that exact fact graph), and both values
 *     are written down.
 * The payload keeps `nodes`, `edges` and `gaps` as written, and the project
 * block's `description` as `projectDescription` when it is a non-empty string
 * (changes/viewer-learn design D3); it leaves out
 * what the page does not read (the language audit, the rest of the project
 * block, layers, tour).
 *
 * Returns { state: 'absent' }, { state: 'unreadable', reason } or
 * { state: 'ok', bytes, counts, revision, reason }; it never throws for a bad
 * file. No model call.
 */

import { join } from 'node:path';

import { DOMAIN_CONTENT_LANGUAGE, DOMAIN_GRAPH_VERSION } from '../excavator-domain/domain-contract.mjs';
import { parseJsonObject, readRegularFile } from './product-files.mjs';

const DOMAIN_GRAPH_FILE = 'domain-graph.json';
const REQUIRED = [
  ['nodes', Array.isArray],
  ['edges', Array.isArray],
  ['sourceRevision', (value) => typeof value === 'string' && value !== ''],
  ['factDigest', (value) => typeof value === 'string' && value !== ''],
];

const unreadable = (reason) => ({ state: 'unreadable', reason });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The first record of `list` the page could not use, as a sentence; null when all can be. */
function badRecord(list, name, fields) {
  for (let i = 0; i < list.length; i++) {
    if (!isObject(list[i])) return `${DOMAIN_GRAPH_FILE} ${name}[${i}] is not an object`;
    const missing = fields.find((field) => typeof list[i][field] !== 'string');
    if (missing) return `${DOMAIN_GRAPH_FILE} ${name}[${i}] has no string ${missing}`;
  }
  return null;
}

function countOf(nodes, type) {
  return nodes.filter((node) => node.type === type).length;
}

/**
 * @param {string} dataDir the project's `.excavator/`
 * @param {{ factsDigest: string|null }|null} graph the knowledge graph's identity when that product is readable, else null
 * @param {string} snapshotRevision the source snapshot's revision
 */
export function readDomain(dataDir, graph, snapshotRevision) {
  const file = readRegularFile(join(dataDir, DOMAIN_GRAPH_FILE), DOMAIN_GRAPH_FILE);
  if (file.state === 'absent') return { state: 'absent' };
  if (file.state === 'unreadable') return unreadable(file.reason);
  const parsed = parseJsonObject(file.bytes, DOMAIN_GRAPH_FILE);
  if (!parsed.value) return unreadable(parsed.reason);
  const domain = parsed.value;
  if (domain.version !== DOMAIN_GRAPH_VERSION || domain.contentLanguage !== DOMAIN_CONTENT_LANGUAGE) {
    return unreadable(`${DOMAIN_GRAPH_FILE} has version ${JSON.stringify(domain.version ?? null)} and contentLanguage ${JSON.stringify(domain.contentLanguage ?? null)}; the viewer reads version ${DOMAIN_GRAPH_VERSION} and contentLanguage ${DOMAIN_CONTENT_LANGUAGE}`);
  }
  const missing = REQUIRED.filter(([key, valid]) => !valid(domain[key])).map(([key]) => key);
  if (missing.length > 0) return unreadable(`${DOMAIN_GRAPH_FILE} is missing the top-level key(s): ${missing.join(', ')}`);
  const bad = badRecord(domain.nodes, 'nodes', ['id', 'type', 'name']) ?? badRecord(domain.edges, 'edges', ['source', 'target', 'type']);
  if (bad) return unreadable(bad);
  if (graph === null) return unreadable('knowledge-graph.jsonl is not readable, so the domain graph\'s factDigest cannot be compared with the graph\'s factsDigest');

  const notes = [];
  if (domain.factDigest !== graph.factsDigest) {
    notes.push(`${DOMAIN_GRAPH_FILE} was made from other facts than knowledge-graph.jsonl: its factDigest is ${domain.factDigest} and the graph's factsDigest is ${graph.factsDigest ?? 'not recorded'}`);
  }
  const description = isObject(domain.project) && typeof domain.project.description === 'string' && domain.project.description !== '' ? domain.project.description : null;
  const payload = { nodes: domain.nodes, edges: domain.edges, gaps: Array.isArray(domain.gaps) ? domain.gaps : [], ...(description === null ? {} : { projectDescription: description }) };
  return {
    state: 'ok',
    bytes: Buffer.from(JSON.stringify(payload), 'utf-8'),
    counts: {
      domains: countOf(domain.nodes, 'domain'),
      flows: countOf(domain.nodes, 'flow'),
      steps: countOf(domain.nodes, 'step'),
      crossDomain: domain.edges.filter((edge) => edge.type === 'cross_domain').length,
    },
    revision: domain.sourceRevision,
    differs: domain.sourceRevision !== snapshotRevision || notes.length > 0,
    reason: notes.length === 0 ? null : notes.join('; '),
  };
}
