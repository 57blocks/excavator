#!/usr/bin/env node
/**
 * make-semantic-project.mjs
 *
 * Builds a copy of the synthetic sample project whose `.excavator/` carries
 * all three semantic products, each written by its real writer (never
 * hand-built JSON):
 *
 *   - `semantic-cache.json` through `commitSemanticCacheEntry`: two entries
 *     committed against the first analysis, then one file changes and the
 *     project is analyzed again, so one entry is fresh and one is stale;
 *   - `semantic-graph.json` through `buildSemanticGraph` + `writeSemanticGraph`
 *     against the FIRST analysis's factsDigest, so it no longer matches the
 *     re-analyzed graph header (a digest mismatch);
 *   - `domain-graph.json` through `annotateDomain` (the domain anchoring
 *     writer, which stamps the freshness keys publish-annotations carries)
 *     against the final graph: one domain, one flow, two ordered steps; the
 *     second step names an id that is not in the graph, which the writer
 *     moves to `unresolvedNodeIds`.
 *
 * Holds no real project content. Usage:
 *   node tests/view/fixtures/make-semantic-project.mjs <outDir>
 */

import { appendFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLazyAnalysis } from '../../../skills/excavator/lazy-analyze.mjs';
import { commitSemanticCacheEntry } from '../../../skills/excavator/semantic-cache.mjs';
import { buildSemanticGraph, collectFactNodeIds, writeSemanticGraph } from '../../../skills/excavator/semantic-graph.mjs';
import { readKnowledgeGraph } from '../../../skills/excavator/knowledge-graph-store.mjs';
import { annotateDomain } from '../../../skills/excavator-domain/annotate-domain.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SAMPLE_PROJECT = join(repoRoot, 'tests/view/fixtures/sample-project');
const FIXED_NOW = '2026-01-01T00:00:00.000Z';

export const SEMANTIC_IDS = Object.freeze({
  fresh: 'function:src/main.ts:run(name)',
  stale: 'function:src/util/format.ts:formatGreeting(name,times)',
  unsummarized: 'function:src/util/format.ts:shout(text)',
  missingAnchor: 'function:src/nowhere.ts:ghost()',
});

export const SEMANTIC_TEXT = Object.freeze({
  fresh: 'Builds a counter, increments it once and formats the greeting for the given name.',
  stale: 'Formats a greeting banner for a name repeated a number of times.',
});

/** @param {string} dataDir */
function manifestHashes(dataDir) {
  const manifest = JSON.parse(readFileSync(join(dataDir, 'source-manifest.json'), 'utf-8'));
  return { manifest, hash: new Map(manifest.entries.map((e) => [e.path, e.contentHash])) };
}

async function analyze(project) {
  const result = await runLazyAnalysis({ projectRoot: project, now: () => FIXED_NOW });
  if (result.saveError) throw new Error(`lazy analysis failed to save: ${result.saveError}`);
}

async function commit(project, nodeId, filePath, summary, tags, hash) {
  const result = await commitSemanticCacheEntry({
    projectRoot: project,
    nodeId,
    filePath,
    fields: { summary, tags, semanticSourceHash: hash, model: 'fixture-model', generatedAt: FIXED_NOW },
    verifyNodePath: true,
  });
  if (!result.ok) throw new Error(`semantic cache commit for ${nodeId} failed: ${result.status}`);
}

/**
 * @param {string} outDir an empty or absent directory; the project is copied into it
 * @returns {Promise<{ project: string, dataDir: string, staleFactDigest: string, factsDigest: string }>}
 */
export async function makeSemanticProject(outDir) {
  const project = resolve(outDir);
  mkdirSync(project, { recursive: true });
  cpSync(SAMPLE_PROJECT, project, { recursive: true });
  const dataDir = join(project, '.excavator');

  // First analysis: the cache entries and the semantic graph are written against it.
  await analyze(project);
  const first = manifestHashes(dataDir);
  await commit(project, SEMANTIC_IDS.fresh, 'src/main.ts', SEMANTIC_TEXT.fresh, ['entry-point', 'greeting'], first.hash.get('src/main.ts'));
  await commit(project, SEMANTIC_IDS.stale, 'src/util/format.ts', SEMANTIC_TEXT.stale, ['formatting'], first.hash.get('src/util/format.ts'));

  const firstGraph = readKnowledgeGraph(join(dataDir, 'knowledge-graph.jsonl'));
  const staleFactDigest = firstGraph.project.factsDigest;
  const built = buildSemanticGraph({
    factDigest: staleFactDigest,
    factNodeIds: collectFactNodeIds(firstGraph),
    layers: [
      {
        id: 'layer:entry', name: 'Entry', description: 'The entry point that composes the other modules.',
        nodeIds: ['file:src/main.ts', SEMANTIC_IDS.fresh],
      },
      {
        id: 'layer:support', name: 'Support', description: 'Formatting and counting helpers used by the entry point.',
        nodeIds: ['file:src/util/format.ts', SEMANTIC_IDS.stale, SEMANTIC_IDS.unsummarized, 'class:src/counter.ts:Counter'],
      },
    ],
    relations: [
      {
        id: 'relation:entry-uses-format', type: 'depends-on', source: SEMANTIC_IDS.fresh, target: SEMANTIC_IDS.stale,
        description: 'The entry point formats its result with the greeting helper.',
      },
    ],
    model: 'fixture-model',
    generatedAt: FIXED_NOW,
  });
  if (!built.semanticGraph) throw new Error('the fixture semantic graph failed the language audit');
  writeSemanticGraph(dataDir, built.semanticGraph);

  // The source changes and the project is analyzed again: format.ts's content
  // hash moves (its cache entry goes stale) and so does the graph's factsDigest.
  appendFileSync(join(project, 'src/util/format.ts'), '\nexport function whisper(text: string): string {\n  return text.toLowerCase();\n}\n');
  await analyze(project);

  const graph = readKnowledgeGraph(join(dataDir, 'knowledge-graph.jsonl'));
  const { manifest } = manifestHashes(dataDir);
  const domainAnalysis = {
    version: '1.0.0',
    project: { name: 'view-sample-project', description: 'Greets a user by name.' },
    nodes: [
      {
        id: 'domain:greeting', type: 'domain', name: 'Greeting', summary: 'Produces greetings for named users.',
        tags: ['greeting'], complexity: 'simple',
        domainMeta: { entities: ['Greeting'], businessRules: ['A greeting names its user.'], crossDomainInteractions: [] },
      },
      {
        id: 'flow:greet-user', type: 'flow', name: 'Greet a user', summary: 'Counts the visit and formats a greeting.',
        tags: ['greeting'], complexity: 'simple', domainMeta: { entryPoint: 'run(name)', entryType: 'manual' },
      },
      {
        id: 'step:greet-user:count-visit', type: 'step', name: 'Count the visit', summary: 'Increments the visit counter.',
        tags: ['counter'], complexity: 'simple', filePath: 'src/main.ts', lineRange: [4, 8],
        nodeIds: [SEMANTIC_IDS.fresh],
      },
      {
        id: 'step:greet-user:format-greeting', type: 'step', name: 'Format the greeting', summary: 'Formats the greeting text.',
        tags: ['formatting'], complexity: 'simple', filePath: 'src/util/format.ts', lineRange: [1, 4],
        nodeIds: [SEMANTIC_IDS.stale, SEMANTIC_IDS.missingAnchor],
      },
    ],
    edges: [
      { source: 'domain:greeting', target: 'flow:greet-user', type: 'contains_flow', direction: 'forward', weight: 1.0 },
      // Listed out of order on purpose: the step order is the flow_step weight.
      { source: 'flow:greet-user', target: 'step:greet-user:format-greeting', type: 'flow_step', direction: 'forward', weight: 0.5 },
      { source: 'flow:greet-user', target: 'step:greet-user:count-visit', type: 'flow_step', direction: 'forward', weight: 0.1 },
    ],
    layers: [],
    tour: [],
  };
  const { annotated } = annotateDomain({ domainGraph: domainAnalysis, knowledgeGraph: graph, sourceRevision: manifest.sourceRevision });
  if (!annotated) throw new Error('the fixture domain graph failed the language audit');
  writeFileSync(join(dataDir, 'domain-graph.json'), `${JSON.stringify(annotated, null, 2)}\n`);

  return { project, dataDir, staleFactDigest, factsDigest: graph.project.factsDigest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    process.stderr.write('Usage: node tests/view/fixtures/make-semantic-project.mjs <outDir>\n');
    process.exit(64);
  }
  const made = await makeSemanticProject(out);
  process.stdout.write(`${JSON.stringify(made)}\n`);
}
