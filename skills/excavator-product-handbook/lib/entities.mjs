/**
 * The entities of the handbook and the relations between them (openspec change
 * handbook-entities-and-views, design D2): domains (the areas of the map),
 * roles, applications, scheduled jobs, notifications and external systems,
 * computed from the verified units only. A pure function of its inputs: no
 * model, no clock, no local path; the same inputs give the same object.
 *
 * Only a verified unit counts, because `entries` holds only those
 * (load-run.mjs); a feature that is confirmed or not written has no relation
 * and no cell. Every relation says only what was checked:
 * - `featureApplication`: a citation of the feature's entry falls in the
 *   application whose directory is the longest match of the cited file;
 * - `unattributed`: citations that fall in no application, so none is dropped;
 * - the role by feature matrix: what the entry says the role can do;
 * - `integrations[].shown`: the callers the verified overview lists;
 * - `integrations[].named`: the applications whose source files hold the system
 *   name, with the number of files; `namedOutside` counts such files in no
 *   application. The two are kept apart: the name search says nothing about
 *   calls, and the model's list can miss an application.
 * A file belongs to the application with the longest matching directory, as a
 * citation does, so the files of a listed sub-application are not counted
 * again for its root.
 */

import { isUnder } from './applications.mjs';
import { entryItems } from './items.mjs';
import { filesNaming } from './name-search.mjs';

const depth = (dir) => (dir === '.' ? 0 : dir.split('/').length);

/** The directory of `dirs` with the longest match for the project-relative `file`, or null. */
export function owningApplication(dirs, file) {
  let best = null;
  for (const dir of dirs) if (isUnder(file, dir) && (best === null || depth(dir) > depth(best))) best = dir;
  return best;
}

/** The count of a Map key `a\0b` kept in the order it was first seen. */
const bump = (counts, key, by = 1) => counts.set(key, (counts.get(key) ?? 0) + by);

/**
 * @param {object} input
 * @param {{ areas: object[], roles: object[], features: object[] }} input.map
 * @param {Map<string, object>} input.entries the verified entries by unit id
 * @param {object[]} input.candidates candidates.json's items
 * @param {{ notifications: object[], jobs: object[] }} input.summary
 * @param {{ applications: { dir: string, name: string|null, does: string|null }[], overview: { integrations: object[] } | null }} input.system
 * @param {{ sourceFiles: object[] }} input.scan the project scan (applications.mjs)
 */
export function buildEntities({ map, entries, candidates, summary, system, scan }) {
  const applications = system.applications.map(({ dir, name, does }) => ({ dir, name, does }));
  const dirs = applications.map((application) => application.dir);
  const area = new Map(map.features.map((feature) => [feature.id, feature.area]));

  const domains = map.areas.map((item) => {
    const features = map.features.filter((feature) => feature.area === item.id);
    return {
      id: item.id,
      name: item.name,
      features: features.map((feature) => feature.id),
      purposes: features
        .filter((feature) => entries.get(feature.id)?.purpose !== undefined)
        .map((feature) => ({ feature: feature.id, text: entries.get(feature.id).purpose.text })),
    };
  });
  const roles = map.roles.map((role) => ({ label: role.label }));

  // Citations of each verified feature entry, by application.
  const perPair = new Map();
  const outside = new Map();
  for (const feature of map.features) {
    const entry = entries.get(feature.id);
    if (entry === undefined) continue;
    for (const item of entryItems(entry)) {
      for (const citation of item.evidence) {
        const owner = owningApplication(dirs, citation.file);
        if (owner === null) bump(outside, feature.id);
        else bump(perPair, `${feature.id}\0${owner}`);
      }
    }
  }
  const featureApplication = [];
  for (const feature of map.features) {
    for (const dir of dirs) {
      const citations = perPair.get(`${feature.id}\0${dir}`);
      if (citations !== undefined) featureApplication.push({ feature: feature.id, application: dir, citations });
    }
  }
  const unattributed = map.features.filter((feature) => outside.has(feature.id)).map((feature) => ({ feature: feature.id, citations: outside.get(feature.id) }));

  // Role by feature: what the verified entry says the role can do.
  const verified = map.features.filter((feature) => entries.has(feature.id));
  const roleCells = [];
  for (const role of roles) {
    for (const feature of verified) {
      const can = entries.get(feature.id).who.filter((who) => who.role === role.label).map((who) => who.can);
      if (can.length > 0) roleCells.push({ role: role.label, feature: feature.id, can });
    }
  }

  // Application by domain: the citations of the domain's features that fall in the application.
  const domainCounts = new Map();
  for (const row of featureApplication) bump(domainCounts, `${row.application}\0${area.get(row.feature)}`, row.citations);
  const domainOutside = new Map();
  for (const row of unattributed) bump(domainOutside, area.get(row.feature), row.citations);
  const applicationDomain = {
    applications: dirs,
    domains: map.areas.map((item) => item.id),
    cells: dirs.flatMap((dir) => map.areas
      .filter((item) => domainCounts.has(`${dir}\0${item.id}`))
      .map((item) => ({ application: dir, domain: item.id, citations: domainCounts.get(`${dir}\0${item.id}`) }))),
    unattributed: map.areas.filter((item) => domainOutside.has(item.id)).map((item) => ({ domain: item.id, citations: domainOutside.get(item.id) })),
  };

  // External systems: the verified overview's, with both relations to applications.
  const listed = system.overview?.integrations ?? [];
  const naming = filesNaming(scan, listed.map((entry) => entry.system));
  const integrations = listed.map((entry) => {
    const perApplication = new Map();
    let namedOutside = 0;
    for (const file of naming.get(entry.system)) {
      const owner = owningApplication(dirs, file);
      if (owner === null) namedOutside += 1;
      else bump(perApplication, owner);
    }
    return {
      system: entry.system,
      use: entry.use,
      shown: [...entry.callers],
      named: dirs.filter((dir) => perApplication.has(dir)).map((dir) => ({ application: dir, files: perApplication.get(dir) })),
      namedOutside,
    };
  });

  const fileOf = new Map(candidates.map((candidate) => [candidate.id, candidate.file]));
  return {
    domains,
    roles,
    applications,
    integrations,
    notifications: summary.notifications.map((row, index) => ({ index, feature: row.feature })),
    jobs: summary.jobs.map((row) => ({ candidate: row.candidate, feature: row.feature, application: owningApplication(dirs, fileOf.get(row.candidate)) })),
    relations: { featureApplication, unattributed },
    matrices: {
      roleFeature: { roles: roles.map((role) => role.label), features: verified.map((feature) => feature.id), cells: roleCells },
      applicationDomain,
    },
  };
}
