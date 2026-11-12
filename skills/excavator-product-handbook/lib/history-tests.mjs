/**
 * The source and test files of each application (openspec change
 * handbook-history-appendix, design D2). A test file is recognized by a fixed
 * naming convention only (`TEST_CONVENTIONS`); a test that does not follow it is
 * not counted, and the page says what the convention is. The walk is the
 * candidate lister's: the same skipped directories, no link followed. A source
 * file is a file in a source language (source-languages.mjs) that is not a test
 * file; nothing is read, so a file over the size cap or with a NUL byte counts.
 */

import { isUnder } from './applications.mjs';
import { walk } from './entrypoints.mjs';
import { languageOf } from './source-languages.mjs';

/** The conventions, as the ui key of each (`md.history.test.<id>`) and the test that recognizes it on a project-relative path. */
export const TEST_CONVENTIONS = Object.freeze([
  Object.freeze({ id: 'goTest', test: (path) => /_test\.go$/.test(base(path)) }),
  Object.freeze({ id: 'dotTest', test: (path) => /\.test\./.test(base(path)) }),
  Object.freeze({ id: 'dotSpec', test: (path) => /\.spec\./.test(base(path)) }),
  Object.freeze({ id: 'pyPrefix', test: (path) => /^test_.+\.py$/.test(base(path)) }),
  Object.freeze({ id: 'pySuffix', test: (path) => /_test\.py$/.test(base(path)) }),
  Object.freeze({ id: 'javaTest', test: (path) => /Tests?\.java$/.test(base(path)) }),
  Object.freeze({ id: 'testsDir', test: (path) => /(^|\/)__tests__\//.test(path) }),
]);

const base = (path) => path.slice(path.lastIndexOf('/') + 1);

/** Whether a project-relative POSIX path follows one of the conventions. */
export const isTestFile = (path) => TEST_CONVENTIONS.some((convention) => convention.test(path));

/**
 * `[{ dir, sourceFiles, testFiles }]`, one per application root in the order of `roots`. A file belongs to the root that
 * holds it (the roots are the topmost build-manifest directories, so no file is in two); a file in none is not counted.
 */
export function countTestFiles(projectRoot, roots) {
  const rows = roots.map((dir) => ({ dir, sourceFiles: 0, testFiles: 0 }));
  const stats = { seen: 0, skipped: { symlink: 0, unreadable: 0 }, skippedDirectories: {} };
  walk(projectRoot, null, stats, (rel) => {
    if (languageOf(rel) === null) return;
    const row = rows.find((one) => isUnder(rel, one.dir));
    if (row === undefined) return;
    if (isTestFile(rel)) row.testFiles += 1;
    else row.sourceFiles += 1;
  });
  return rows;
}
