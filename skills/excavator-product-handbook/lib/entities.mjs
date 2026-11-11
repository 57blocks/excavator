/**
 * The entities of the handbook and the relations between them (openspec change
 * handbook-entities-and-views, design D2): domains (the business domains of
 * domains.json, or the areas of the map when there is none: domain-grouping.mjs),
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
 * - `domains[].relations`: a handoff of a verified entry from a feature of the
 *   domain to a feature of another domain (`out`), or the other way (`in`);
 * - `domainFlows`: those handoffs summed per direction between two domains;
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
import { domainGrouping } from './domain-grouping.mjs';
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
 * @param {object | null} [input.domains] a domains.json that passed check-domains; null groups by the map's areas
 * @param {Map<string, object>} input.entries the verified entries by unit id
 * @param {object[]} input.candidates candidates.json's items
 * @param {{ notifications: object[], jobs: object[] }} input.summary
 * @param {{ applications: { dir: string, name: string|null, does: string|null }[], overview: { integrations: object[] } | null }} input.system
 * @param {{ sourceFiles: object[] }} input.scan the project scan (applications.mjs)
 */
export function buildEntities({ map, domains = null, entries, candidates, summary, system, scan }) {
  const applications = system.applications.map(({ dir, name, does }) => ({ dir, name, does }));
  const dirs = applications.map((application) => application.dir);
  const grouping = domainGrouping(map, domains);
  const domainOf = new Map(grouping.groups.flatMap((group) => group.features.map((id) => [id, group.id])));

  // Handoffs of the verified entries that cross from one domain to another (openspec change
  // handbook-deep-entry, D12), in the order of the map, the operations and the handoffs.
  const crossings = [];
  for (const feature of map.features) {
    // A /2 entry keeps its hand-overs in its operations, a /3 fact sheet (openspec change handbook-free-chapter) at the top level.
    const entry = entries.get(feature.id);
    for (const handoff of [...(entry?.operations ?? []).flatMap((operation) => operation.handoffs ?? []), ...(entry?.handoffs ?? [])]) {
      const from = domainOf.get(feature.id);
      const to = domainOf.get(handoff.feature);
      if (from !== undefined && to !== undefined && from !== to) crossings.push({ from: feature.id, to: handoff.feature, text: handoff.text, fromDomain: from, toDomain: to });
    }
  }
  // handbook-domain-page D4: the crossings summed per direction between two domains, in the order they first appear.
  const domainFlows = [];
  for (const item of crossings) {
    const flow = domainFlows.find((entry) => entry.from === item.fromDomain && entry.to === item.toDomain);
    if (flow === undefined) domainFlows.push({ from: item.fromDomain, to: item.toDomain, count: 1 });
    else flow.count += 1;
  }
  const domainRows = grouping.groups.map((group) => ({
    id: group.id,
    name: group.name,
    features: group.features,
    purposes: group.features
      .filter((id) => entries.get(id)?.purpose !== undefined)
      .map((id) => ({ feature: id, text: entries.get(id).purpose.text })),
    relations: [
      ...crossings.filter((item) => item.fromDomain === group.id).map((item) => ({ direction: 'out', domain: item.toDomain, from: item.from, to: item.to, text: item.text })),
      ...crossings.filter((item) => item.toDomain === group.id).map((item) => ({ direction: 'in', domain: item.fromDomain, from: item.from, to: item.to, text: item.text })),
    ],
    // The states and transitions of the domain's verified entries (handbook-domain-page D2).
    states: group.features.flatMap((id) => (entries.get(id)?.states ?? []).map((state) => ({ feature: id, label: state.label, meaning: state.meaning }))),
    transitions: group.features.flatMap((id) => (entries.get(id)?.transitions ?? []).map((item) => ({ feature: id, from: item.from, to: item.to, by: item.by }))),
  }));
  // The files the verified entries of each domain cite, most cited first, then by path (handbook-domain-page D2).
  const domainFiles = grouping.groups.map((group) => {
    const counts = new Map();
    for (const id of group.features) {
      const entry = entries.get(id);
      if (entry === undefined) continue;
      for (const item of entryItems(entry)) for (const citation of item.evidence) bump(counts, citation.file);
    }
    const files = [...counts].map(([file, citations]) => ({ file, citations }))
      .sort((a, b) => b.citations - a.citations || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    return { domain: group.id, files };
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
  for (const row of featureApplication) bump(domainCounts, `${row.application}\0${domainOf.get(row.feature)}`, row.citations);
  const domainOutside = new Map();
  for (const row of unattributed) bump(domainOutside, domainOf.get(row.feature), row.citations);
  const applicationDomain = {
    applications: dirs,
    domains: grouping.groups.map((group) => group.id),
    cells: dirs.flatMap((dir) => grouping.groups
      .filter((group) => domainCounts.has(`${dir}\0${group.id}`))
      .map((group) => ({ application: dir, domain: group.id, citations: domainCounts.get(`${dir}\0${group.id}`) }))),
    unattributed: grouping.groups.filter((group) => domainOutside.has(group.id)).map((group) => ({ domain: group.id, citations: domainOutside.get(group.id) })),
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
    domainBasis: grouping.basis,
    domains: domainRows,
    domainFlows,
    domainFiles,
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
