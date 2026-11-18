/**
 * The file names of the design-problems batches, in one module that imports nothing from the review modules so
 * that review-render, review-verify and review-processes can all use them without a cycle.
 */

export const REVIEW_DIR = 'entries/review';
export const REMOVED_FILE = 'entries/review-removed.json';
export const batchFile = (batch) => `${REVIEW_DIR}/${batch}.json`;
export const verdictsFile = (batch) => `${REVIEW_DIR}/${batch}.verdicts.json`;
export const unprunedFile = (batch) => `${REVIEW_DIR}/${batch}.unpruned.json`;
