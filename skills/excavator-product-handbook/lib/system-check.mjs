/**
 * The checks of a system findings file (openspec change
 * handbook-system-findings, design D4): everything a findings file is checked
 * for (findings-check.mjs), and two more, each on a finding:
 * - in the application: at least one cited file is under the application root;
 * - ownership: when every cited file is a seed file of one and the same map
 *   feature and none is a seed file of this unit, the finding is that
 *   feature's, and its own lane writes it.
 * The context `system` is `{ appDir, seeds }` (system-unit.mjs); the map's
 * `features[].seedFiles` give the seeds of each feature.
 */

import { findingsProblems } from './findings-check.mjs';
import { findingsShapeProblems } from './findings-shape.mjs';
import { underApplication } from './system-seeds.mjs';

/** The feature whose seed files include every file in `files`, or null; the first in map order when several do. */
const owningFeature = (map, files) => map.features.find((feature) => files.every((file) => feature.seedFiles.includes(file))) ?? null;

/** The two extra problems of the findings of a file that passed the shape check. */
function placementProblems(doc, { map, system }) {
  if (system === undefined || system === null) throw new Error('a system findings file is checked with the application it belongs to');
  const problems = [];
  doc.findings.forEach((finding, i) => {
    const files = [...new Set(finding.evidence.map((entry) => entry.file))];
    if (!files.some((file) => underApplication(file, system.appDir))) {
      problems.push(`findings[${i}].evidence: no cited file is under the application ${system.appDir}; a system finding cites at least one passage in it`);
    }
    const owner = files.some((file) => system.seeds.has(file)) ? null : owningFeature(map, files);
    if (owner !== null) {
      problems.push(`findings[${i}].evidence: every file this finding cites is a seed file of feature ${owner.id} and none is a seed file of this application's system unit; it is a finding of that feature, written by its own lane`);
    }
  });
  return problems;
}

/** Every way a parsed system findings file fails when checked as the unit `id`. */
export function systemFindingsProblems(doc, id, ctx) {
  if (findingsShapeProblems(doc).length > 0) return findingsProblems(doc, id, ctx);
  return [...findingsProblems(doc, id, ctx), ...placementProblems(doc, ctx)];
}
