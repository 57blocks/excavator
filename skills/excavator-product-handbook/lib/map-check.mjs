/**
 * check-map (design D4): format, ids, reach and labels, candidate
 * conservation, roles, seed files, then the citation, value and banned-words
 * checks over every item. `mapProblems` is also what assemble and check-entry
 * build on: it returns the problem lines and the labels verified map-wide.
 */

import { join } from 'node:path';

import { UsageError } from './errors.mjs';
import { readJson } from './json-file.mjs';
import { ID_PATTERN, mapShapeProblems } from './map-shape.mjs';
import { mapItems } from './items.mjs';
import { reviewItems } from './review.mjs';

const duplicates = (ids) => [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

/** Id, area and reach rules of a map that passed the shape check. */
function structureProblems(map) {
  const problems = [];
  const areaIds = map.areas.map((area) => area.id);
  const featureIds = map.features.map((feature) => feature.id);
  map.areas.forEach((area, i) => {
    if (!ID_PATTERN.test(area.id)) problems.push(`areas[${i}].id: ${JSON.stringify(area.id)} is not a plain id such as A1`);
  });
  map.features.forEach((feature, i) => {
    if (!ID_PATTERN.test(feature.id)) problems.push(`features[${i}].id: ${JSON.stringify(feature.id)} is not a plain id such as F1`);
    if (!areaIds.includes(feature.area)) problems.push(`features[${i}].area: ${JSON.stringify(feature.area)} is not an area id`);
    if (feature.reach === 'menu' || feature.reach === 'link') {
      for (const key of ['label', 'evidence']) {
        if (feature[key] === undefined) problems.push(`features[${i}]: a ${feature.reach} feature needs ${key === 'label' ? 'a label' : 'evidence'} (${feature.id})`);
      }
    }
  });
  for (const id of duplicates(areaIds)) problems.push(`areas: id ${id} is used more than once`);
  for (const id of duplicates(featureIds)) problems.push(`features: id ${id} is used more than once`);
  for (const group of ['roles', 'names']) {
    for (const label of duplicates(map[group].map((entry) => entry.label))) problems.push(`${group}: label ${JSON.stringify(label)} is listed more than once`);
  }
  return problems;
}

/** Every candidate id exactly once across the features and `unassigned`; each miss and each double assignment is named. */
function conservationProblems(map, candidates) {
  const known = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const owners = new Map();
  const claim = (id, owner) => owners.set(id, [...(owners.get(id) ?? []), owner]);
  for (const feature of map.features) feature.candidates.forEach((id) => claim(id, feature.id));
  for (const entry of map.unassigned) claim(entry.candidate, 'unassigned');
  const problems = [];
  for (const candidate of candidates) {
    if (!owners.has(candidate.id)) {
      problems.push(`${candidate.id}: not in any feature and not in unassigned (${candidate.kind} ${candidate.file}:${candidate.line})`);
    }
  }
  for (const [id, who] of owners) {
    if (!known.has(id)) problems.push(`${id}: is not a candidate in candidates.json (listed by ${who.join(', ')})`);
    else if (who.length > 1) problems.push(`${id}: assigned more than once: ${who.join(' and ')}`);
  }
  return problems;
}

/** Seed files must be project source inside the root; a model-written path is never read before it is checked. */
function seedProblems(map, files) {
  const problems = [];
  map.features.forEach((feature, i) => {
    feature.seedFiles.forEach((file, j) => {
      const resolved = files.resolve(file);
      if (!resolved.ok) problems.push(`features[${i}].seedFiles[${j}]: ${file} ${resolved.reason}`);
    });
  });
  return problems;
}

/**
 * All problems of a map against the candidates, and the labels it verifies.
 * A shape problem stops the rest: nothing else can be read from a malformed map.
 */
export function mapProblems(map, { candidates, files, memberDirs }) {
  const shape = mapShapeProblems(map);
  if (shape.length > 0) return { problems: shape, verified: new Set() };
  const review = reviewItems(mapItems(map), { files, memberDirs });
  const problems = [
    ...structureProblems(map),
    ...conservationProblems(map, candidates),
    ...seedProblems(map, files),
    ...review.problems,
  ];
  return { problems, verified: review.verified };
}

/** The labels a map verifies map-wide (check-entry exempts them from the banned-words gate), or its shape problems. */
export function mapVerifiedLabels(map, { files, memberDirs }) {
  const shape = mapShapeProblems(map);
  if (shape.length > 0) return { shapeProblems: shape, verified: new Set() };
  return { shapeProblems: [], verified: reviewItems(mapItems(map), { files, memberDirs }).verified };
}

export const MAP_FILE = 'map.json';

/** Read `<out>/map.json`: a missing file is a usage error; unreadable JSON is `{ ok: false, line }`. */
export function readMap(outDir) {
  const read = readJson(join(outDir, MAP_FILE));
  if (read.missing) throw new UsageError(`${join(outDir, MAP_FILE)} does not exist`);
  return read.ok ? read : { ok: false, line: `${MAP_FILE} ${read.reason}` };
}
