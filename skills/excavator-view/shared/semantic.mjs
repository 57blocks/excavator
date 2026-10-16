/**
 * semantic.mjs
 *
 * The three semantic products with their per-item freshness (openspec change
 * `artifact-view`, design D6), read from already-parsed JSON. Freshness
 * reuses the owners' own pure rules so the page can never disagree with the
 * terminal: semantic cache entries go through `freshnessOf`
 * (semantic-cache-freshness.mjs) against the manifest's per-file
 * `contentHash`; the domain graph goes through `isDomainGraphUsable`
 * (domain-usability.mjs) against the manifest's `sourceRevision` and the
 * graph header's `factsDigest`; the semantic graph compares its `factDigest`
 * with the header's `factsDigest`. Pure: the bake and a dropped directory
 * call the same functions.
 */

import { OptionalArtifactError } from './errors.mjs';
import { freshnessOf } from '../../excavator/semantic-cache-freshness.mjs';
import { isDomainGraphUsable } from '../../excavator-domain/domain-usability.mjs';

/**
 * The semantic cache, with each entry's freshness against the manifest.
 *
 * @param {any} cache the parsed `semantic-cache.json`
 * @param {Map<string, string>} nodeFile node id -> file path
 * @param {Map<string, string>} manifestHash file path -> contentHash
 */
export function readSemanticCache(cache, nodeFile, manifestHash) {
  if (cache === null || typeof cache !== 'object' || cache.entries === null || typeof cache.entries !== 'object') {
    throw new OptionalArtifactError('has no "entries" object');
  }
  const entries = [];
  const tally = { fresh: 0, stale: 0, missing: 0, 'noncanonical-language': 0, notInGraph: 0 };
  for (const [nodeId, entry] of Object.entries(cache.entries)) {
    const file = nodeFile.get(nodeId);
    const freshness = file === undefined
      ? 'missing'
      : freshnessOf(entry, manifestHash.get(file) ?? null, cache);
    if (file === undefined) tally.notInGraph += 1;
    tally[freshness] += 1;
    entries.push({
      nodeId,
      summary: entry?.summary ?? null,
      tags: Array.isArray(entry?.tags) ? entry.tags : [],
      model: entry?.model ?? null,
      generatedAt: entry?.generatedAt ?? null,
      verification: entry?.verification ?? null,
      freshness,
      inGraph: file !== undefined,
    });
  }
  return {
    segment: { version: cache.version ?? null, contentLanguage: cache.contentLanguage ?? null, entries },
    summary: { entries: entries.length, nodesInGraph: nodeFile.size, ...tally },
  };
}

/**
 * @param {any} graph the parsed `semantic-graph.json`
 * @param {string|null} headerFactsDigest
 */
export function readSemanticGraph(graph, headerFactsDigest) {
  if (graph === null || typeof graph !== 'object') throw new OptionalArtifactError('is not a JSON object');
  const fresh = typeof graph.factDigest === 'string' && graph.factDigest.length > 0 && graph.factDigest === headerFactsDigest;
  return {
    segment: {
      factDigest: graph.factDigest ?? null,
      headerFactsDigest,
      freshness: fresh ? 'fresh' : 'stale',
      contentLanguage: graph.contentLanguage ?? null,
      layers: Array.isArray(graph.layers) ? graph.layers : [],
      relations: Array.isArray(graph.relations) ? graph.relations : [],
      gaps: graph.gaps ?? null,
    },
    summary: { freshness: fresh ? 'fresh' : 'stale', layers: Array.isArray(graph.layers) ? graph.layers.length : 0 },
  };
}

/**
 * @param {any} domainGraph the parsed `domain-graph.json`
 * @param {string|null} manifestSourceRevision
 * @param {string|null} headerFactsDigest
 */
export function readDomainGraph(domainGraph, manifestSourceRevision, headerFactsDigest) {
  if (domainGraph === null || typeof domainGraph !== 'object') throw new OptionalArtifactError('is not a JSON object');
  const verdict = isDomainGraphUsable({
    domainGraph,
    currentSourceRevision: manifestSourceRevision,
    currentFactDigest: headerFactsDigest,
  });
  return {
    segment: { freshness: verdict.status, reason: verdict.reason, graph: domainGraph },
    summary: { freshness: verdict.status, reason: verdict.reason },
  };
}
