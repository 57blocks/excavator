/**
 * The verified findings of a loaded run as the outputs write them (openspec
 * changes handbook-feature-findings and handbook-system-findings): one row per
 * finding of each verified findings unit, the features in the map's order, then
 * the system units by application number, each in the file's order, and the
 * groups of findings at the same place (findings-groups.mjs). A unit that is not
 * verified has no row, whatever its file holds. Both outputs build it here, so
 * the handbook and the page cannot differ. Every passage is located with the
 * function the citation check defines (citation-locator.mjs), since the
 * grouping needs the lines in both views; the technical view also gets them per
 * finding. A passage that cannot be located (the file changed since it was
 * checked) is listed with null lines, never dropped.
 */

import { citationLocator } from './citation-locator.mjs';
import { findingsId } from './findings-shape.mjs';
import { groupFindings } from './findings-groups.mjs';
import { systemUnitId } from './system-shape.mjs';

/** The status of the findings unit of feature `featureId`: planned when the state has no entry. */
export const findingsStatus = (state, featureId) => state.findings?.[featureId]?.status ?? 'planned';

/** The status of the system unit with key `key` (`app<n>`): planned when the state has no entry. */
export const systemStatus = (state, key) => state.systemFindings?.[key]?.status ?? 'planned';

/** A finding's owner as a feature, `{ kind: 'feature', id, name }`. */
export const featureOwner = (feature) => ({ kind: 'feature', id: feature.id, name: feature.name });

/**
 * `{ list, groups, locations, applications }`.
 * `list`: `[{ id, owner, category, text }]`, one per verified finding; `id` is the unit id and the item path (`F3.findings[0]`, `app1.system[0]`),
 * `owner` is `{ kind: 'feature' | 'application', id, name }` (an application's id is `app<n>`, its name the verified overview's name for the
 * directory, else the directory).
 * `groups`: `[{ category, owners, items }]`, `items` the rows of the group (the first is the representative), `owners` the distinct owners of
 * the items in their order.
 * `locations`: a Map from each id to `[{ file, startLine, endLine }]`, null unless `technical`.
 * `applications`: `[{ id, name, status, removed }]`, one per application root: where each system unit stands, for the coverage.
 * `roots` are the application roots in the order `applications` prints them; `applicationRows` the rows of the system facts (system-facts.mjs), which give the names.
 */
export function buildFindings(run, root, { technical, roots = [], applicationRows = [] }) {
  const locate = citationLocator(root);
  const where = (finding) => finding.evidence.map((citation) => {
    const found = locate(citation);
    return { file: citation.file, startLine: found?.startLine ?? null, endLine: found?.endLine ?? null };
  });
  const applications = roots.map((dir, index) => {
    const id = `app${index + 1}`;
    return { id, name: applicationRows.find((row) => row.dir === dir)?.name ?? dir, status: systemStatus(run.state, id), removed: run.state.systemFindings?.[id]?.removed ?? [] };
  });

  const list = [];
  const places = new Map();
  const add = (unitId, owner, doc) => {
    doc.findings.forEach((finding, index) => {
      const id = `${unitId}[${index}]`;
      list.push({ id, owner, category: finding.category, text: finding.text });
      places.set(id, where(finding));
    });
  };
  for (const feature of run.map.features) {
    const doc = run.findings.get(feature.id);
    if (doc !== undefined) add(findingsId(feature.id), featureOwner(feature), doc);
  }
  applications.forEach((application, index) => {
    const unitId = systemUnitId(index + 1);
    const doc = run.systemFindings?.get(unitId);
    if (doc !== undefined) add(unitId, { kind: 'application', id: application.id, name: application.name }, doc);
  });

  const groups = groupFindings(list.map((row) => ({ ...row, citations: places.get(row.id) }))).map((members) => {
    const items = members.map(({ citations, ...row }) => row);
    const owners = [];
    for (const { owner } of items) if (!owners.some((one) => one.kind === owner.kind && one.id === owner.id)) owners.push(owner);
    return { category: items[0].category, owners, items };
  });
  return { list, groups, locations: technical ? places : null, applications };
}
