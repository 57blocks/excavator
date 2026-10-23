/**
 * tour-report.mjs
 *
 * Writes the tour product `.excavator/tour.json` (openspec: changes/tour-product,
 * capability `learning-tour`, requirement "tour product", design D5). The input is
 * `tour/resolved.json`, which `verdicts --round 2` wrote; this step adds the
 * revision identity and recomputes every count from the steps and the removals, so
 * a count in the product is always one a reader can recount.
 *
 *   { format, contentLanguage, sourceRevision, factDigest, steps, removed, gaps, counts }
 *
 * `factDigest` is the knowledge graph's `factsDigest`, read from the graph header now;
 * `sourceRevision` is the source snapshot's revision now. Both must be the ones the
 * candidates were made from: a graph or source that moved during the run is refused,
 * not stamped over. A `contradicted` sentence is never in `steps`: a resolved tour that
 * holds one is refused. `unverified` and `unchecked` sentences stay, with their verdict.
 * Keys are written in a fixed order, so the same input gives the same bytes.
 *
 * Every step's title is a sentence too (`<order>.t`, kind `title`), counted with the others;
 * a title contradicted twice is in `removed` with kind `title`, and when its step is still
 * there `counts.replacedTitles` counts it: that step's title is the names of its cited nodes.
 * `counts.adviceLines` scans the kept text for advisory wording once more (`tour-advice.mjs`).
 * `reportLines` is the reply the skill prints: the product's path and five of its counts.
 */

import { join } from 'node:path';

import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraphHeader } from './knowledge-graph-store.mjs';
import { resolveSourceSnapshot } from './source-snapshot.mjs';
import { findAdvice } from './tour-advice.mjs';
import { writeAtomic } from './tour-candidates.mjs';
import { RESOLVED_FILE, TourInputError, readCandidates, readJsonFile } from './tour-layout.mjs';
import { RESOLVED_FORMAT } from './tour-verdicts.mjs';

export const TOUR_FORMAT = 'excavator-tour/1';
export const TOUR_FILE = 'tour.json';
const MIN_STEPS = 5;
const VERDICTS = ['verified', 'unverified', 'contradicted', 'unchecked'];
const SAMPLE_LIMIT = 5;

function recount(steps, removed, language) {
  const sentences = steps.flatMap((step) => step.sentences);
  return {
    steps: steps.length,
    sentences: sentences.length,
    ...Object.fromEntries(VERDICTS.map((verdict) => [verdict, sentences.filter((sentence) => sentence.verdict === verdict).length])),
    removedSentences: removed.length,
    // Lines (a title or a sentence) of the kept text that use advisory wording; `check` rejects these before verification, so it is 0 for a checked draft.
    adviceLines: findAdvice(steps, language).length,
    // A step with a removal record and no step left under its original order was removed whole.
    removedSteps: new Set(removed.map((record) => record.step).filter((order) => !steps.some((step) => step.originalOrder === order))).size,
    // A removed title whose step is still there was replaced by the names of the step's cited nodes.
    replacedTitles: removed.filter((record) => record.kind === 'title' && steps.some((step) => step.originalOrder === record.step)).length,
  };
}

function gapsOf(counts, steps, problems, factsDigest, language) {
  const gaps = [];
  if (counts.steps < MIN_STEPS) gaps.push({ kind: 'few-steps', reason: `the tour has ${counts.steps} step(s), fewer than ${MIN_STEPS}`, count: counts.steps });
  if (counts.unchecked > 0) {
    const samples = steps.flatMap((step) => step.sentences).filter((sentence) => sentence.verdict === 'unchecked').map((sentence) => sentence.id).slice(0, SAMPLE_LIMIT);
    gaps.push({ kind: 'unchecked-sentences', reason: `${counts.unchecked} sentence(s) have no verdict`, count: counts.unchecked, samples });
  }
  if (problems.length > 0) {
    gaps.push({ kind: 'verdict-problems', reason: `${problems.length} problem(s) in the verifier's output files`, count: problems.length, samples: problems.slice(0, SAMPLE_LIMIT) });
  }
  if (counts.adviceLines > 0) {
    const samples = findAdvice(steps, language).map((hit) => hit.id === 'title' ? `${hit.step} title` : hit.id).slice(0, SAMPLE_LIMIT);
    gaps.push({ kind: 'advisory-wording', reason: `${counts.adviceLines} line(s) of the tour use advisory wording`, count: counts.adviceLines, samples });
  }
  if (factsDigest === null) gaps.push({ kind: 'no-facts-digest', reason: `${KNOWLEDGE_GRAPH_FILE} records no factsDigest, so a reader cannot tell whether the tour is current`, count: 1 });
  return gaps;
}

/** The snapshot of `root` without the "Analyzing git:..." notice it prints for a single repo: the skill's reply is this command's output and nothing else. */
function resolveQuietly(root) {
  const write = process.stderr.write;
  process.stderr.write = () => true;
  try {
    return resolveSourceSnapshot(root);
  } finally {
    process.stderr.write = write;
  }
}

const plainStep = (step) => ({
  order: step.order,
  originalOrder: step.originalOrder,
  title: step.title,
  description: step.description,
  nodeIds: step.nodeIds,
  ...(step.languageLesson === undefined ? {} : { languageLesson: step.languageLesson }),
  sentences: step.sentences.map(({ id, kind, text, verdict, reason }) => ({ id, kind, text, verdict, reason })),
});

/** The tour product for the project of `located` ({ root, dataDir, tourDir }). Throws TourInputError when it cannot be stamped. */
export function buildTour({ root, dataDir, tourDir }) {
  const resolved = readJsonFile(join(tourDir, RESOLVED_FILE), 'resolved.json (written by `verdicts --round 2`)');
  if (resolved?.format !== RESOLVED_FORMAT || !Array.isArray(resolved.steps) || !Array.isArray(resolved.removed)) {
    throw new TourInputError(`resolved.json is not a ${RESOLVED_FORMAT} product`);
  }
  const contradicted = resolved.steps.flatMap((step) => step.sentences).filter((sentence) => sentence.verdict === 'contradicted');
  if (contradicted.length > 0) {
    throw new TourInputError(`resolved.json keeps ${contradicted.length} contradicted sentence(s) in its steps (first: ${contradicted[0].id}); run \`verdicts --round 2\` again`);
  }

  const candidates = readCandidates(tourDir);
  const header = readKnowledgeGraphHeader(join(dataDir, KNOWLEDGE_GRAPH_FILE));
  const factsDigest = header.fields.project?.factsDigest ?? null;
  if (factsDigest !== candidates.factsDigest) {
    throw new TourInputError(`candidates.json was made from facts ${candidates.factsDigest ?? 'not recorded'} but ${KNOWLEDGE_GRAPH_FILE} has ${factsDigest ?? 'none recorded'}; run the tour again from \`candidates\``);
  }
  const snapshot = resolveQuietly(root);
  if (snapshot.revision !== candidates.sourceRevision) {
    throw new TourInputError(`candidates.json was made at ${candidates.sourceRevision} but the source is now ${snapshot.revision}; run the tour again from \`candidates\``);
  }

  const steps = resolved.steps.map(plainStep);
  const removed = resolved.removed.map(({ step, id, kind, text, verdict, reason, cause }) => ({ step, id, kind, text, verdict, reason, cause }));
  const contentLanguage = typeof resolved.contentLanguage === 'string' ? resolved.contentLanguage : 'en';
  const counts = recount(steps, removed, contentLanguage);
  return {
    format: TOUR_FORMAT,
    contentLanguage,
    sourceRevision: snapshot.revision,
    factDigest: factsDigest,
    steps,
    removed,
    gaps: gapsOf(counts, steps, Array.isArray(resolved.problems) ? resolved.problems : [], factsDigest, contentLanguage),
    counts,
  };
}

/** Write `.excavator/tour.json`; returns the product and its path. */
export function writeTour(located) {
  const product = buildTour(located);
  const out = join(located.dataDir, TOUR_FILE);
  writeAtomic(out, `${JSON.stringify(product, null, 2)}\n`);
  return { out, product };
}

/** The reply: the product's path and its counts, one fact per line, labelled as written here whatever the content language. */
export function reportLines(out, product) {
  const c = product.counts;
  return [
    out,
    `steps: ${c.steps}`,
    `sentences: ${c.sentences}; verified: ${c.verified}; unverified: ${c.unverified}; contradicted: ${c.contradicted}; unchecked: ${c.unchecked}`,
    `removed: ${c.removedSentences} sentences; ${c.removedSteps} steps`,
    `advice check: ${c.adviceLines} lines`,
  ];
}
