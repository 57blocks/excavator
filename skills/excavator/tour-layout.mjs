/**
 * tour-layout.mjs
 *
 * Where the tour commands keep their files, and the reads and writes they share
 * (openspec: changes/tour-product, design D3-D6). Everything lives under
 * `<project>/.excavator/tour/`:
 *
 *   candidates.json          the candidate set (`candidates`)
 *   draft.json               the tour the model writes: { contentLanguage?, steps: [...] }
 *   round-<r>.json           what `slices` cut for round r: every step's sentences and text
 *   slices/round-<r>/step-<n>.json     the verifier's whole input for step n
 *   verdicts/round-<r>/step-<n>.json   the verifier's output for step n
 *   rewrite.json             the steps round 1 sent back, with the sentences and reasons
 *   resolved.json            the tour after round 2, the input of `report`
 *
 * A draft path decides the project: it must be `<project>/.excavator/tour/<file>`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { assertDataDir, bindProjectRoot } from './project-paths.mjs';
import { CANDIDATES_FILE, CANDIDATES_FORMAT, TOUR_DIR } from './tour-candidates.mjs';

export const DRAFT_FILE = 'draft.json';
export const REWRITE_FILE = 'rewrite.json';
export const RESOLVED_FILE = 'resolved.json';
export const roundFile = (round) => `round-${round}.json`;
export const slicesDir = (round) => join('slices', `round-${round}`);
export const verdictsDir = (round) => join('verdicts', `round-${round}`);
export const stepFile = (order) => `step-${order}.json`;

export class TourInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TourInputError';
  }
}

/** { root, dataDir, tourDir, draftPath } for `<project>/.excavator/tour/<file>`. */
export function locateDraft(draftArg) {
  const draftPath = resolve(String(draftArg ?? ''));
  const tourDir = dirname(draftPath);
  const dataDir = dirname(tourDir);
  if (basename(tourDir) !== TOUR_DIR || basename(dataDir) !== '.excavator') {
    throw new TourInputError(`the draft must be <project>/.excavator/${TOUR_DIR}/<file>, not ${draftPath}`);
  }
  const root = bindProjectRoot(dirname(dataDir));
  return { root, dataDir: assertDataDir(root), tourDir, draftPath };
}

export function readJsonFile(path, what) {
  if (!existsSync(path)) throw new TourInputError(`${what} does not exist: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new TourInputError(`${what} is not valid JSON (${error.message}): ${path}`);
  }
}

export function readDraft(draftPath) {
  return readJsonFile(draftPath, 'the draft');
}

/** The candidates next to the draft; they must be the product `candidates` writes. */
export function readCandidates(tourDir) {
  const path = join(tourDir, CANDIDATES_FILE);
  if (!existsSync(path)) throw new TourInputError(`${path} does not exist; run \`tour.mjs candidates <projectRoot>\` first`);
  const product = readJsonFile(path, 'candidates.json');
  if (product?.format !== CANDIDATES_FORMAT || !Array.isArray(product.candidates)) {
    throw new TourInputError(`${path} is not a ${CANDIDATES_FORMAT} product`);
  }
  return product;
}
