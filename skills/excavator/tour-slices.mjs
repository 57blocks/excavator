/**
 * tour-slices.mjs
 *
 * Cuts a tour into what the verifier is shown (openspec: changes/tour-product,
 * capability `learning-tour`, requirement "sentence verification", design D3).
 * For each step: the title as one sentence (`<order>.t`), the description and the
 * language lesson split into sentences (`<order>.d<n>`, `<order>.l<n>`), and the source
 * text of every node the step cites. The title is never split: it is judged whole. The verifier gets only that, in `slices/round-<r>/step-<n>.json`: no
 * candidate set, no summary, no other step, no reason of the author.
 *
 * Source text comes from the source snapshot (HEAD, never the working tree), by the
 * node's `lineRange`; a file node, which has none, shows its first lines. A node
 * shows at most 120 lines and a step at most 400; what is cut is counted and written
 * at the end of the snippet, so the verifier can answer `unverified` rather than
 * guess. A node whose file cannot be read gets an empty snippet that says why.
 *
 * A file node's snippet also carries an `outline`: one line per node the knowledge graph
 * says the file `contains` (`<type> <name> [<start>-<end>]`), sorted by line. It is a
 * structural fact read from the graph, with no summary text, so a sentence about what
 * the file defines can be checked past its first 120 lines. Outline lines count toward
 * the step's 400 lines, spent in this order: function and class snippets, then every file
 * node's outline, then the file heads from what is left; what does not fit is counted
 * and written as the last outline line. The graph is read only when a cited node is a file node, and must be the one
 * the candidates were made from (same facts digest).
 *
 * Round 1 slices every step. Round 2 slices the steps round 1 sent back (listed in
 * `rewrite.json`) and requires the others to be unchanged. Slicing a round removes
 * the files that depend on it (its own verdicts, later rounds, the resolved tour).
 */

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from './knowledge-graph-store.mjs';
import { canonicalSourcePath } from './project-paths.mjs';
import { resolveSourceSnapshot } from './source-snapshot.mjs';
import { writeAtomic } from './tour-candidates.mjs';
import { checkDraft } from './tour-check.mjs';
import {
  REWRITE_FILE, RESOLVED_FILE, TourInputError, readCandidates, readDraft, readJsonFile, roundFile, slicesDir, stepFile, verdictsDir,
} from './tour-layout.mjs';
import { splitSentences } from './tour-sentences.mjs';

export const SNIPPET_LIMITS = Object.freeze({ nodeLines: 120, stepLines: 400 });
export const SLICE_FORMAT = 'excavator-tour-slice/1';
export const ROUND_FORMAT = 'excavator-tour-round/1';

/** The sentences of a step, each with its id: the title, then the description, then the language lesson. */
export function stepSentences(step) {
  const sentences = [{ id: `${step.order}.t`, kind: 'title', text: step.title }];
  sentences.push(...splitSentences(step.description).map((text, i) => ({ id: `${step.order}.d${i + 1}`, kind: 'description', text })));
  if (step.languageLesson !== undefined) {
    sentences.push(...splitSentences(step.languageLesson).map((text, i) => ({ id: `${step.order}.l${i + 1}`, kind: 'languageLesson', text })));
  }
  return sentences;
}

const lineMarker = (count) => `[... ${count} more line${count === 1 ? '' : 's'} not shown]`;
const outlineMarker = (count) => `[... ${count} more outline ${count === 1 ? 'entry' : 'entries'} not shown]`;

/** The nodes of each file node cited by the draft, as sorted outline lines: Map(fileNodeId -> string[]). */
function readOutlines(dataDir, candidatesById, factsDigest, citedIds) {
  const wanted = new Set(citedIds.filter((id) => candidatesById.get(id).type === 'file'));
  if (wanted.size === 0) return new Map();
  const graphPath = join(dataDir, KNOWLEDGE_GRAPH_FILE);
  let graph;
  try {
    graph = readKnowledgeGraph(graphPath);
  } catch (error) {
    throw new TourInputError(`the outline of a cited file needs ${KNOWLEDGE_GRAPH_FILE}, which cannot be read: ${error.message}`);
  }
  const digest = graph.project?.factsDigest ?? null;
  if (digest !== factsDigest) {
    throw new TourInputError(`candidates.json was made from facts ${factsDigest ?? 'not recorded'} but ${KNOWLEDGE_GRAPH_FILE} has ${digest ?? 'none recorded'}; run \`tour.mjs candidates\` again`);
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const contained = new Map([...wanted].map((id) => [id, []]));
  for (const edge of graph.edges) {
    if (edge?.type === 'contains' && contained.has(edge.source)) contained.get(edge.source).push(edge.target);
  }
  const outlines = new Map();
  for (const [fileId, targets] of contained) {
    const entries = [...new Set(targets)].map((id) => ({ id, node: nodes.get(id) }));
    const key = (entry) => (Array.isArray(entry.node?.lineRange) ? entry.node.lineRange[0] : Number.POSITIVE_INFINITY);
    entries.sort((a, b) => (key(a) === key(b) ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : key(a) < key(b) ? -1 : 1));
    outlines.set(fileId, entries.map(({ id, node }) => {
      if (!node) return `unresolved ${id}`;
      const range = Array.isArray(node.lineRange) ? `[${node.lineRange[0]}-${node.lineRange[1]}]` : '[no line range]';
      return `${node.type} ${node.name} ${range}`;
    }));
  }
  return outlines;
}

/** One node's snippet within `budget` lines: { snippet, shown } with `shown` the lines it used. */
function cutSnippet(candidate, snapshot, budget) {
  const base = { nodeId: candidate.id, filePath: candidate.filePath, startLine: null, endLine: null, truncatedLines: 0 };
  let text;
  try {
    text = snapshot.readFile(canonicalSourcePath(candidate.filePath)).toString('utf-8');
  } catch (error) {
    return { snippet: { ...base, text: '', note: `the source could not be read: ${error.message}` }, shown: 0 };
  }
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const range = Array.isArray(candidate.lineRange) ? candidate.lineRange : null;
  const start = range ? Math.max(1, range[0]) : 1;
  const end = range ? Math.min(lines.length, range[1]) : lines.length;
  if (start > lines.length) {
    return { snippet: { ...base, text: '', note: `the node's lines start after the end of the file (${lines.length} lines)` }, shown: 0 };
  }
  const wanted = Math.max(0, end - start + 1);
  const allowed = Math.max(0, Math.min(SNIPPET_LIMITS.nodeLines, budget));
  const shown = Math.min(wanted, allowed);
  const cut = wanted - shown;
  const body = lines.slice(start - 1, start - 1 + shown).join('\n');
  const snippet = {
    ...base,
    startLine: shown > 0 ? start : null,
    endLine: shown > 0 ? start + shown - 1 : null,
    text: cut > 0 ? `${body}${shown > 0 ? '\n' : ''}${lineMarker(cut)}` : body,
    truncatedLines: cut,
  };
  if (shown === 0 && budget <= 0) snippet.note = `the step's ${SNIPPET_LIMITS.stepLines}-line budget was used up by earlier nodes`;
  return { snippet, shown };
}

/**
 * The snippets of a step in the order of its nodeIds, within the step's line budget, which is spent in three passes:
 * function and class snippets first (each at most 120 lines), then the outline of every file node, then the opening
 * lines of the file nodes from what is left (in citation order, each at most 120). An outline says more about a long
 * file per line than its head does, so it is not left to whatever the heads did not use.
 */
function cutStepSnippets(step, candidatesById, snapshot, outlines) {
  let budget = SNIPPET_LIMITS.stepLines;
  const snippets = new Array(step.nodeIds.length);
  const isFile = (id) => candidatesById.get(id).type === 'file';
  step.nodeIds.forEach((id, i) => {
    if (isFile(id)) return;
    const { snippet, shown } = cutSnippet(candidatesById.get(id), snapshot, budget);
    budget -= shown;
    snippets[i] = snippet;
  });
  const outlined = new Map();
  step.nodeIds.forEach((id, i) => {
    if (!isFile(id)) return;
    const all = outlines.get(id);
    const fit = Math.max(0, Math.min(all.length, budget));
    const outline = all.slice(0, fit);
    const truncatedOutline = all.length - fit;
    if (truncatedOutline > 0) outline.push(outlineMarker(truncatedOutline));
    budget -= fit;
    outlined.set(i, { outline, truncatedOutline });
  });
  step.nodeIds.forEach((id, i) => {
    if (!isFile(id)) return;
    const { snippet, shown } = cutSnippet(candidatesById.get(id), snapshot, budget);
    budget -= shown;
    snippets[i] = { ...snippet, ...outlined.get(i) };
  });
  return snippets;
}

/** The outline lines of a snippet that are entries, not the truncation marker. */
const shownOutline = (snippet) => (snippet.outline ? snippet.outline.length - (snippet.truncatedOutline > 0 ? 1 : 0) : 0);

const sameStep = (a, b) => a.title === b.title && a.description === b.description && a.languageLesson === b.languageLesson
  && a.nodeIds.length === b.nodeIds.length && a.nodeIds.every((id, i) => id === b.nodeIds[i]);

/** Remove the products that a re-slice of `round` makes stale. */
function clearFrom(tourDir, round) {
  rmSync(join(tourDir, slicesDir(round)), { recursive: true, force: true });
  rmSync(join(tourDir, verdictsDir(round)), { recursive: true, force: true });
  rmSync(join(tourDir, RESOLVED_FILE), { force: true });
  if (round === 1) {
    rmSync(join(tourDir, REWRITE_FILE), { force: true });
    rmSync(join(tourDir, roundFile(2)), { force: true });
    rmSync(join(tourDir, slicesDir(2)), { recursive: true, force: true });
    rmSync(join(tourDir, verdictsDir(2)), { recursive: true, force: true });
  }
}

/**
 * Slice `round` of the draft. Throws TourInputError when the draft fails the structure
 * rules, the candidates are from another source revision, or round 2 is asked for
 * without a round 1 that sent steps back (or with an unsent step changed).
 * @returns {{ round: number, steps: object[] }} the round index that was written
 */
export function sliceDraft({ root, dataDir, tourDir, draftPath }, round) {
  if (round !== 1 && round !== 2) throw new TourInputError('the round must be 1 or 2');
  const candidates = readCandidates(tourDir);
  const draft = readDraft(draftPath);
  const candidatesById = new Map(candidates.candidates.map((candidate) => [candidate.id, candidate]));
  const issues = checkDraft(draft, new Set(candidatesById.keys()));
  if (issues.length > 0) throw new TourInputError(`the draft fails the structure check; run \`tour.mjs check\` (${issues.length} problem(s), first: ${issues[0]})`);

  let sent = draft.steps;
  if (round === 2) {
    const rewrite = readJsonFile(join(tourDir, REWRITE_FILE), 'rewrite.json (written by `verdicts --round 1`)');
    const first = readJsonFile(join(tourDir, roundFile(1)), 'round-1.json');
    const orders = new Set(rewrite.steps.map((step) => step.order));
    const firstByOrder = new Map(first.steps.map((step) => [step.order, step]));
    const changed = draft.steps.filter((step) => !orders.has(step.order) && !(firstByOrder.has(step.order) && sameStep(step, firstByOrder.get(step.order)))).map((step) => step.order);
    if (changed.length !== 0 || draft.steps.length !== first.steps.length) {
      throw new TourInputError(`the draft changed after round 1 in step(s) that were not sent back (${changed.join(', ') || 'the step list'}); only the steps in rewrite.json may change`);
    }
    sent = draft.steps.filter((step) => orders.has(step.order));
  }

  const snapshot = resolveSourceSnapshot(root);
  if (snapshot.revision !== candidates.sourceRevision) {
    throw new TourInputError(`candidates.json was made at ${candidates.sourceRevision} but the source is now ${snapshot.revision}; run \`tour.mjs candidates\` again`);
  }

  const outlines = readOutlines(dataDir, candidatesById, candidates.factsDigest, sent.flatMap((step) => step.nodeIds));

  clearFrom(tourDir, round);
  mkdirSync(join(tourDir, slicesDir(round)), { recursive: true });
  mkdirSync(join(tourDir, verdictsDir(round)), { recursive: true });
  const steps = sent.map((step) => {
    const sentences = stepSentences(step);
    const snippets = cutStepSnippets(step, candidatesById, snapshot, outlines);
    const input = join(slicesDir(round), stepFile(step.order));
    const output = join(verdictsDir(round), stepFile(step.order));
    writeAtomic(join(tourDir, input), `${JSON.stringify({ format: SLICE_FORMAT, step: step.order, sentences: sentences.map(({ id, text }) => ({ id, text })), snippets }, null, 2)}\n`);
    return {
      order: step.order,
      title: step.title,
      description: step.description,
      ...(step.languageLesson === undefined ? {} : { languageLesson: step.languageLesson }),
      nodeIds: step.nodeIds,
      sentences,
      input,
      output,
      snippetLines: snippets.reduce((total, snippet) => total + (snippet.startLine === null ? 0 : snippet.endLine - snippet.startLine + 1) + shownOutline(snippet), 0),
      truncatedLines: snippets.reduce((total, snippet) => total + snippet.truncatedLines + (snippet.truncatedOutline ?? 0), 0),
    };
  });
  const index = { format: ROUND_FORMAT, round, contentLanguage: draft.contentLanguage ?? 'en', steps };
  writeAtomic(join(tourDir, roundFile(round)), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}
