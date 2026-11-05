/**
 * How the handbook groups the features of the map (openspec change
 * handbook-map-by-domain, design D3): into the business domains of a checked
 * domains.json, or, when there is none, into the areas of the map, which the
 * outputs then label as areas drawn by the navigation. Everything that groups
 * features (entities, the system overview's table, handbook.md, the page)
 * goes through here, so they cannot disagree. A pure function of its inputs.
 *
 * `{ basis, groups }`: `basis` is `domains` or `areas`; each group is
 * `{ id, name, features }` with its feature ids in the order of the map,
 * whatever order the domains file lists them in.
 */

export const BASES = Object.freeze(['domains', 'areas']);

/** The areas of the map as groups. */
export function areaGroups(map) {
  return map.areas.map((area) => ({ id: area.id, name: area.name, features: map.features.filter((feature) => feature.area === area.id).map((feature) => feature.id) }));
}

/**
 * @param {{ areas: object[], features: object[] }} map the checked map
 * @param {{ domains: { id: string, name: string, features: string[] }[] } | null} domains a domains.json that passed check-domains, or null
 */
export function domainGrouping(map, domains) {
  if (domains === null || domains === undefined) return { basis: 'areas', groups: areaGroups(map) };
  return {
    basis: 'domains',
    groups: domains.domains.map((domain) => {
      const members = new Set(domain.features);
      return { id: domain.id, name: domain.name, features: map.features.filter((feature) => members.has(feature.id)).map((feature) => feature.id) };
    }),
  };
}
