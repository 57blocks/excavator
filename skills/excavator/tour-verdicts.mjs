/**
 * tour-verdicts.mjs
 *
 * Records the verifier's verdicts and settles the tour (openspec: changes/
 * tour-product, capability `learning-tour`, requirement "sentence verification",
 * design D3-D4).
 *
 * A verdict file is `{ verdicts: [{ id, verdict, reason }] }` per step. A sentence
 * with no usable verdict is `unchecked`, never silently verified: its step file may
 * be missing or not JSON, its verdict may be none of the three words, or the id may
 * appear twice (then both are discarded). Ids the step does not have are counted and
 * ignored. Every such case is listed in `problems`.
 *
 *   round 1  reads the round-1 verdicts and writes `rewrite.json`: the steps with a
 *            `contradicted` sentence, each with the sentence and the reason, for the
 *            model to rewrite once.
 *   round 2  settles. A step round 1 did not send back keeps its round-1 text and
 *            verdicts; a sent-back step takes its rewritten text and round-2 verdicts,
 *            and a sentence still `contradicted` is removed from it. A title still
 *            `contradicted` is removed the same way and the step's title becomes the
 *            names of its cited nodes (`tour-titles.mjs`); the step stays. A step left
 *            with no description sentence is removed whole, whatever its title; the
 *            remaining steps are renumbered 1..m and their sentences re-id'd to the
 *            new order (`<order>.t`, `<order>.d<n>`, `<order>.l<n>`). Every
 *            removal is a record in `removed` with the original step and sentence id,
 *            the text, the verdict and reason, the kind (`title`, `description` or
 *            `languageLesson`) and the cause (`contradicted`, or `step-removed` for a
 *            sentence that went with its step). The result is
 *            `resolved.json`, the input of `report`. `unverified` and `unchecked`
 *            sentences stay.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { writeAtomic } from './tour-candidates.mjs';
import {
  REWRITE_FILE, RESOLVED_FILE, TourInputError, readCandidates, readJsonFile, roundFile,
} from './tour-layout.mjs';
import { titleFromNodes } from './tour-titles.mjs';

export const RESOLVED_FORMAT = 'excavator-tour-resolved/1';
export const REWRITE_FORMAT = 'excavator-tour-rewrite/1';
const VERDICTS = ['verified', 'unverified', 'contradicted'];
const MAX_REASON_CHARS = 300;
export const UNCHECKED_REASON = 'no verdict was recorded for this sentence';

/** The verdict of each sentence of one round-index step: { byId: Map(id -> { verdict, reason }), problems: string[] }. */
function readStepVerdicts(tourDir, step) {
  const problems = [];
  const byId = new Map();
  const path = join(tourDir, step.output);
  let parsed = null;
  if (!existsSync(path)) problems.push(`step ${step.order}: no verdict file (${step.output})`);
  else {
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (error) {
      problems.push(`step ${step.order}: the verdict file is not valid JSON (${error.message})`);
    }
  }
  if (parsed !== null && !Array.isArray(parsed?.verdicts)) {
    problems.push(`step ${step.order}: the verdict file has no verdicts array`);
    parsed = null;
  }
  if (parsed === null) return { byId, problems };

  const known = new Set(step.sentences.map((sentence) => sentence.id));
  const seen = new Map();
  for (const entry of parsed.verdicts) {
    const id = typeof entry?.id === 'string' ? entry.id : null;
    if (id === null || !known.has(id)) {
      problems.push(`step ${step.order}: a verdict names ${JSON.stringify(entry?.id ?? null)}, which is not a sentence of the step; ignored`);
      continue;
    }
    seen.set(id, [...(seen.get(id) ?? []), entry]);
  }
  for (const [id, entries] of seen) {
    if (entries.length > 1) {
      problems.push(`step ${step.order}: sentence ${id} has ${entries.length} verdicts; all discarded`);
    } else if (!VERDICTS.includes(entries[0].verdict)) {
      problems.push(`step ${step.order}: sentence ${id} has the verdict ${JSON.stringify(entries[0].verdict ?? null)}, which is not one of ${VERDICTS.join(', ')}; discarded`);
    } else {
      const reason = typeof entries[0].reason === 'string' ? entries[0].reason.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_CHARS) : '';
      byId.set(id, { verdict: entries[0].verdict, reason });
    }
  }
  for (const sentence of step.sentences) {
    if (!byId.has(sentence.id) && !seen.has(sentence.id)) problems.push(`step ${step.order}: sentence ${sentence.id} has no verdict`);
  }
  return { byId, problems };
}

/** The round's steps with a verdict on every sentence (`unchecked` when none was recorded). */
function judgeRound(tourDir, round) {
  const index = readJsonFile(join(tourDir, roundFile(round)), `${roundFile(round)} (written by \`slices\`)`);
  const problems = [];
  const steps = index.steps.map((step) => {
    const { byId, problems: stepProblems } = readStepVerdicts(tourDir, step);
    problems.push(...stepProblems);
    const sentences = step.sentences.map((sentence) => ({
      ...sentence,
      verdict: byId.get(sentence.id)?.verdict ?? 'unchecked',
      reason: byId.get(sentence.id)?.reason ?? UNCHECKED_REASON,
    }));
    return { ...step, sentences };
  });
  return { index, steps, problems };
}

const countBy = (sentences) => Object.fromEntries([...VERDICTS, 'unchecked'].map((verdict) => [verdict, sentences.filter((s) => s.verdict === verdict).length]));

/** Round 1: write rewrite.json. Returns the product written. */
export function recordRoundOne(tourDir) {
  const { index, steps, problems } = judgeRound(tourDir, 1);
  rmSync(join(tourDir, RESOLVED_FILE), { force: true });
  const sentBack = steps
    .filter((step) => step.sentences.some((sentence) => sentence.verdict === 'contradicted'))
    .map((step) => ({
      order: step.order,
      title: step.title,
      contradicted: step.sentences.filter((s) => s.verdict === 'contradicted').map(({ id, text, reason }) => ({ id, text, reason })),
    }));
  const product = {
    format: REWRITE_FORMAT,
    round: 1,
    contentLanguage: index.contentLanguage,
    counts: { steps: steps.length, ...countBy(steps.flatMap((step) => step.sentences)), sentBack: sentBack.length },
    problems,
    steps: sentBack,
  };
  writeAtomic(join(tourDir, REWRITE_FILE), `${JSON.stringify(product, null, 2)}\n`);
  return product;
}

/** Round 2: settle the tour and write resolved.json. Throws TourInputError when a sent-back step has no round-2 text. */
export function settleTour(tourDir) {
  const first = judgeRound(tourDir, 1);
  const rewrite = readJsonFile(join(tourDir, REWRITE_FILE), 'rewrite.json (written by `verdicts --round 1`)');
  const sentBack = new Set(rewrite.steps.map((step) => step.order));
  const second = existsSync(join(tourDir, roundFile(2))) ? judgeRound(tourDir, 2) : { index: { steps: [] }, steps: [], problems: [] };
  const secondByOrder = new Map(second.steps.map((step) => [step.order, step]));
  const lacking = [...sentBack].filter((order) => !secondByOrder.has(order));
  if (lacking.length > 0) {
    throw new TourInputError(`step(s) ${lacking.join(', ')} were sent back by round 1 but have no round-2 slice; rewrite them and run \`slices --round 2\``);
  }

  const kept = [];
  const removed = [];
  let candidates = null;
  const replacementTitle = (nodeIds) => {
    candidates ??= readCandidates(tourDir);
    return titleFromNodes(nodeIds, candidates);
  };
  for (const step of first.steps) {
    const current = sentBack.has(step.order) ? secondByOrder.get(step.order) : step;
    const drop = (sentence, cause) => removed.push({ step: step.order, id: sentence.id, kind: sentence.kind, text: sentence.text, verdict: sentence.verdict, reason: sentence.reason, cause });
    const gone = current.sentences.filter((sentence) => sentence.verdict === 'contradicted');
    const staying = current.sentences.filter((sentence) => sentence.verdict !== 'contradicted');
    if (!staying.some((sentence) => sentence.kind === 'description')) {
      for (const sentence of current.sentences) drop(sentence, sentence.verdict === 'contradicted' ? 'contradicted' : 'step-removed');
      continue;
    }
    for (const sentence of gone) drop(sentence, 'contradicted');
    const titleGone = gone.some((sentence) => sentence.kind === 'title');
    kept.push({ originalOrder: step.order, current, staying, title: titleGone ? replacementTitle(current.nodeIds) : current.title, titleGone });
  }

  const steps = kept.map(({ originalOrder, current, staying, title }, i) => {
    const order = i + 1;
    const ofKind = (kind) => staying.filter((sentence) => sentence.kind === kind);
    const rebuilt = (kind, original) => (ofKind(kind).length === current.sentences.filter((sentence) => sentence.kind === kind).length
      ? original
      : ofKind(kind).map((sentence) => sentence.text).join(' '));
    const lesson = ofKind('languageLesson').length === 0 ? undefined : rebuilt('languageLesson', current.languageLesson);
    const numbered = { d: 0, l: 0 };
    return {
      order,
      originalOrder,
      title,
      description: rebuilt('description', current.description),
      nodeIds: current.nodeIds,
      ...(lesson === undefined ? {} : { languageLesson: lesson }),
      sentences: staying.map((sentence) => {
        if (sentence.kind === 'title') return { id: `${order}.t`, kind: sentence.kind, text: sentence.text, verdict: sentence.verdict, reason: sentence.reason };
        const letter = sentence.kind === 'description' ? 'd' : 'l';
        numbered[letter] += 1;
        return { id: `${order}.${letter}${numbered[letter]}`, kind: sentence.kind, text: sentence.text, verdict: sentence.verdict, reason: sentence.reason };
      }),
    };
  });

  const all = steps.flatMap((step) => step.sentences);
  const product = {
    format: RESOLVED_FORMAT,
    contentLanguage: first.index.contentLanguage,
    steps,
    removed,
    rewritten: [...sentBack].sort((a, b) => a - b),
    problems: [...first.problems, ...second.problems],
    counts: {
      steps: steps.length,
      sentences: all.length,
      ...countBy(all),
      removedSentences: removed.length,
      removedSteps: first.steps.length - steps.length,
      replacedTitles: kept.filter((step) => step.titleGone).length,
    },
  };
  writeAtomic(join(tourDir, RESOLVED_FILE), `${JSON.stringify(product, null, 2)}\n`);
  return product;
}
