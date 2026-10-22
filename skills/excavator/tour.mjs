#!/usr/bin/env node
/**
 * tour.mjs
 *
 * The deterministic halves of the learning tour (openspec: changes/tour-product,
 * capability `learning-tour`). No model, no build of the target. The host skill
 * writes the tour between the subcommands; the subcommands write only under
 * `.excavator/tour/` and, for `report`, `.excavator/tour.json`.
 *
 *   node tour.mjs candidates <projectRoot>
 *   node tour.mjs check <draft>
 *   node tour.mjs slices <draft> [--round 1|2]
 *   node tour.mjs verdicts <draft> --round 1|2
 *   node tour.mjs report <draft>
 *
 * `candidates` reads the knowledge graph, the semantic files and the domain graph
 * and writes `.excavator/tour/candidates.json`: the nodes a tour may cite, each with
 * its summary and the reasons it was picked (`tour-candidates.mjs`). It exits non-zero
 * when there is no knowledge graph.
 *
 * `check` validates the model's draft (`<project>/.excavator/tour/draft.json`) against the
 * structure rules and the candidate set, printing every problem; exit 1 when there is one.
 * `slices` cuts the draft into the verifier's inputs (round 1: every step; round 2: the steps
 * round 1 sent back). `verdicts` reads the verifier's outputs: round 1 writes `rewrite.json`,
 * round 2 settles the tour into `resolved.json` (`tour-verdicts.mjs`). `report` stamps the revision
 * identity, writes `.excavator/tour.json` and prints the reply's five lines, and nothing else, on stdout.
 */

import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeCandidates } from './tour-candidates.mjs';
import { checkDraft } from './tour-check.mjs';
import { locateDraft, readCandidates, readDraft } from './tour-layout.mjs';
import { reportLines, writeTour } from './tour-report.mjs';
import { sliceDraft } from './tour-slices.mjs';
import { recordRoundOne, settleTour } from './tour-verdicts.mjs';

const USAGE = 'Usage: node tour.mjs candidates <projectRoot>\n'
  + '       node tour.mjs check <draft>\n'
  + '       node tour.mjs slices <draft> [--round 1|2]\n'
  + '       node tour.mjs verdicts <draft> --round 1|2\n'
  + '       node tour.mjs report <draft>\n';

function candidatesCommand(root) {
  const { out, product } = writeCandidates(root);
  const classes = Object.fromEntries(Object.entries(product.classes).map(([name, { total, truncated }]) => [name, { total, truncated }]));
  process.stdout.write(`${JSON.stringify({ out, factsDigest: product.factsDigest, sourceRevision: product.sourceRevision, candidates: product.candidates.length, classes, gaps: product.gaps })}\n`);
  const cut = Object.entries(classes).map(([name, { total, truncated }]) => `${name} ${total}${truncated > 0 ? ` (${truncated} cut)` : ''}`).join(', ');
  process.stderr.write(`tour candidates: ${product.candidates.length} candidates; ${cut}\n`);
}

function checkCommand(draftArg) {
  const located = locateDraft(draftArg);
  const candidates = readCandidates(located.tourDir);
  const draft = readDraft(located.draftPath);
  const issues = checkDraft(draft, new Set(candidates.candidates.map((candidate) => candidate.id)));
  process.stdout.write(`${JSON.stringify({ ok: issues.length === 0, steps: Array.isArray(draft?.steps) ? draft.steps.length : null, issues })}\n`);
  if (issues.length === 0) {
    process.stderr.write(`tour check: ${draft.steps.length} steps pass\n`);
    return 0;
  }
  process.stderr.write(`tour check: ${issues.length} problem(s)\n${issues.map((issue) => `  - ${issue}`).join('\n')}\n`);
  return 1;
}

/** `--round <n>` from `rest`, `fallback` when absent; null when malformed. */
function parseRound(rest, fallback) {
  if (rest.length === 0) return fallback;
  if (rest.length === 2 && rest[0] === '--round' && (rest[1] === '1' || rest[1] === '2')) return Number(rest[1]);
  return null;
}

function slicesCommand(draftArg, round) {
  const located = locateDraft(draftArg);
  const index = sliceDraft(located, round);
  const steps = index.steps.map((step) => ({
    order: step.order,
    sentences: step.sentences.length,
    snippetLines: step.snippetLines,
    truncatedLines: step.truncatedLines,
    inputPath: join(located.tourDir, step.input),
    outputPath: join(located.tourDir, step.output),
  }));
  process.stdout.write(`${JSON.stringify({ round, tourDir: located.tourDir, steps })}\n`);
  process.stderr.write(`tour slices: round ${round}, ${steps.length} step(s), ${steps.reduce((n, step) => n + step.sentences, 0)} sentences\n`);
}

function verdictsCommand(draftArg, round) {
  const { tourDir } = locateDraft(draftArg);
  if (round === 1) {
    const product = recordRoundOne(tourDir);
    process.stdout.write(`${JSON.stringify({ round, counts: product.counts, rewrite: product.steps.map((step) => step.order), problems: product.problems })}\n`);
    process.stderr.write(`tour verdicts: round 1, ${product.counts.verified} verified, ${product.counts.unverified} unverified, ${product.counts.contradicted} contradicted, ${product.counts.unchecked} unchecked; ${product.steps.length} step(s) to rewrite\n`);
    return;
  }
  const product = settleTour(tourDir);
  process.stdout.write(`${JSON.stringify({ round, counts: product.counts, rewritten: product.rewritten, problems: product.problems })}\n`);
  const c = product.counts;
  process.stderr.write(`tour verdicts: round 2, ${c.steps} steps, ${c.verified} verified, ${c.unverified} unverified, ${c.unchecked} unchecked; removed ${c.removedSentences} sentence(s) and ${c.removedSteps} step(s)\n`);
}

function reportCommand(draftArg) {
  const { out, product } = writeTour(locateDraft(draftArg));
  process.stdout.write(`${reportLines(out, product).join('\n')}\n`);
}

function main(argv) {
  const [command, target, ...rest] = argv;
  if (command === 'candidates' && target && rest.length === 0) return candidatesCommand(target);
  if (command === 'check' && target && rest.length === 0) return checkCommand(target);
  if (command === 'report' && target && rest.length === 0) return reportCommand(target);
  if (command === 'slices' && target) {
    const round = parseRound(rest, 1);
    if (round !== null) return slicesCommand(target, round);
  }
  if (command === 'verdicts' && target) {
    const round = parseRound(rest, null);
    if (round !== null) return verdictsCommand(target, round);
  }
  process.stderr.write(USAGE);
  return 1;
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
    const code = main(process.argv.slice(2));
    if (typeof code === 'number' && code !== 0) process.exit(code);
  } catch (error) {
    process.stderr.write(`tour.mjs failed: ${error.message}\n`);
    process.exit(1);
  }
}
