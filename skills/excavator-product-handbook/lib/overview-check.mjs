/**
 * The checks of a system overview file (openspec change
 * handbook-system-overview) against the project: the shape, the id, the
 * citations, labels, numbers, banned words and narrative language of every
 * item (review.mjs, as for a feature entry), no citation of a documentation
 * file (documentation can be out of date, and the overview says what the code
 * is today), and the applications: each names a directory that holds a build
 * manifest, no two name the same one, each application root of the project is
 * covered (applications.mjs), and each caller of an integration is a listed
 * application. A settled overview (one that verification trimmed) keeps the
 * directory checks, but a removed application may leave a root uncovered and
 * a caller without its application, so coverage and the listed-caller rule
 * apply to a written overview only; a settled caller must still be a
 * directory that holds a manifest.
 */

import { isUnder, scanProject } from './applications.mjs';
import { overviewItems } from './overview-items.mjs';
import { overviewShapeProblems } from './overview-shape.mjs';
import { reviewItems } from './review.mjs';

/** Citations may not point to these: they describe the system, they do not show it. */
export const DOCUMENT_EXTENSIONS = Object.freeze(['.md', '.mdx', '.txt', '.rst', '.adoc']);

const MANIFEST_HINT = 'a build manifest such as package.json, go.mod, pom.xml';
const quote = JSON.stringify;

function documentProblems(items) {
  return items.flatMap((item) => item.evidence.flatMap((entry) => {
    const extension = DOCUMENT_EXTENSIONS.find((suffix) => entry.file.toLowerCase().endsWith(suffix));
    return extension === undefined ? [] : [`${entry.path}: ${entry.file} is a documentation file (${extension}); cite the code that shows it`];
  }));
}

/** The directory, duplicate, coverage and caller problems of the applications and integrations. */
function applicationProblems(doc, scan, { settled }) {
  const problems = [];
  const first = new Map();
  doc.applications.forEach((application, i) => {
    const where = `applications[${i}].dir`;
    if (!scan.manifests.has(application.dir)) {
      problems.push(`${where}: ${quote(application.dir)} holds no build manifest (${MANIFEST_HINT}); give the directory of an application`);
    } else if (first.has(application.dir)) {
      problems.push(`${where}: ${quote(application.dir)} is already the directory of applications[${first.get(application.dir)}]`);
    } else {
      first.set(application.dir, i);
    }
  });
  doc.integrations.forEach((integration, i) => {
    integration.callers.forEach((caller, j) => {
      const where = `integrations[${i}].callers[${j}]`;
      if (settled ? !scan.manifests.has(caller) : !first.has(caller)) {
        problems.push(`${where}: ${quote(caller)} is not the directory of ${settled ? 'a directory with a build manifest' : 'an application listed in this overview'}${settled ? '' : ` (listed: ${[...first.keys()].map(quote).join(', ') || 'none'})`}`);
      }
    });
  });
  if (!settled) {
    for (const root of scan.roots) {
      if (![...first.keys()].some((dir) => isUnder(dir, root))) {
        problems.push(`applications: the application root ${quote(root)} is not covered by any listed application (list an application whose directory is it or lies below it)`);
      }
    }
  }
  return problems;
}

/**
 * Every way a parsed overview fails. `ctx` is what entryProblems takes
 * (`files`, `memberDirs`, `mapLabels`, `languageCheck`) and optionally
 * `applications`, the scan of the project (applications.mjs), which is made
 * from the project root of `files` when it is not given.
 */
export function overviewProblems(doc, { files, memberDirs, mapLabels, languageCheck = null, applications = null }, { settled = false } = {}) {
  const shape = overviewShapeProblems(doc, { settled });
  if (shape.length > 0) return shape;
  const items = overviewItems(doc);
  return [
    ...documentProblems(items),
    ...reviewItems(items, { files, memberDirs, exemptLabels: mapLabels, languageCheck }).problems,
    ...applicationProblems(doc, applications ?? scanProject(files.root), { settled }),
  ];
}
