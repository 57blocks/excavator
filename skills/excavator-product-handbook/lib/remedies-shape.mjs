/**
 * The remedies unit of a run (openspec change handbook-remedies): the shape of
 * `entries/remedies.json` the remedies lane writes, the id of the unit, the
 * paths of its judge and verdict files and the ids of its paragraphs. The unit
 * has the id `remedies`; check-map reserves it as it reserves `priority`.
 *
 * A paragraph is one category's cause and measure, or one recommendation. Its id
 * (`category:<key>`, `recommendation:<n>` with n counting from 1 in the file's
 * order) is what a judge verdict and the record of a removed paragraph name.
 */

import { join } from 'node:path';

import { FINDING_CATEGORIES } from './findings-shape.mjs';
import { arrayOf, enumOf, literal, nonEmptyString, objectOf, shapeProblems } from './schema.mjs';

export const REMEDIES_ID = 'remedies';
export const REMEDIES_FORMAT = 'excavator-product-handbook-remedies/1';
export const REMEDIES_FILE = 'entries/remedies.json';
export const MAX_RECOMMENDATIONS = 10;

const CITES = arrayOf(nonEmptyString);

const REMEDIES_SCHEMA = objectOf({
  schema: literal(REMEDIES_FORMAT),
  categories: arrayOf(objectOf({ category: enumOf(...FINDING_CATEGORIES), cause: nonEmptyString, measure: nonEmptyString, cites: CITES })),
  recommendations: arrayOf(objectOf({ title: nonEmptyString, text: nonEmptyString, cites: CITES })),
});

/** Shape problems of a parsed remedies file. */
export const remediesShapeProblems = (doc) => shapeProblems(doc, REMEDIES_SCHEMA);

export const categoryParagraphId = (category) => `category:${category}`;
export const recommendationParagraphId = (number) => `recommendation:${number}`;

/** The paragraphs of a valid remedies file in the order of the file: `[{ id, kind, ... }]`, recommendations numbered from 1. */
export function paragraphsOf(doc) {
  return [
    ...doc.categories.map((entry) => ({ id: categoryParagraphId(entry.category), kind: 'category', category: entry.category, cause: entry.cause, measure: entry.measure, cites: entry.cites })),
    ...doc.recommendations.map((entry, index) => ({ id: recommendationParagraphId(index + 1), kind: 'recommendation', title: entry.title, text: entry.text, cites: entry.cites })),
  ];
}

/** Where the unit keeps its judge file and the verdict files of its two judges, under `<out>`. */
export const REMEDIES_DIR = 'remedies';
export const judgeFilePath = (outDir) => join(outDir, REMEDIES_DIR, 'judge.json');
export const judgeVerdictPath = (outDir, letter) => join(outDir, REMEDIES_DIR, 'verdicts', `${letter}.json`);
export const JUDGES = Object.freeze(['a', 'b']);
export const JUDGE_VERDICTS = Object.freeze(['follows', 'doesNotFollow']);
