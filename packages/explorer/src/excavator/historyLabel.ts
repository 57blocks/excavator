/** The name of the view a history entry returns to, for the panel's Back button. Pure: the names come from a resolver. */

export interface HistoryNames {
  domain: (id: string) => string | null;
  group: (domainId: string, groupId: string) => { label: string; qualifier: string | null } | null;
  layer: (id: string) => string | null;
  folder: (id: string) => string | null;
}

export interface HistoryLevel {
  viewMode: "structural" | "domain" | "knowledge";
  activeDomainId: string | null;
  activeGroupId: string | null;
  navigationLevel: "overview" | "layer-detail";
  activeLayerId: string | null;
  expandedContainers: ReadonlySet<string>;
}

const SEPARATOR = " · ";

/** The level's name, not the selected node's: the overview, a domain, a group, a layer, or the folder an open layer shows. */
export function historyLabel(entry: HistoryLevel, names: HistoryNames): string {
  if (entry.viewMode === "domain") {
    if (entry.activeDomainId === null) return "All domains";
    if (entry.activeGroupId === null) return names.domain(entry.activeDomainId) ?? "Domain";
    const group = names.group(entry.activeDomainId, entry.activeGroupId);
    if (group === null) return names.domain(entry.activeDomainId) ?? "Domain";
    return group.qualifier ? `${group.label}${SEPARATOR}${group.qualifier}` : group.label;
  }
  if (entry.navigationLevel === "overview") return "Project overview";
  const folders = [...entry.expandedContainers];
  const folder = folders.length > 0 ? names.folder(folders[folders.length - 1]) : null;
  if (folder !== null) return folder;
  return (entry.activeLayerId !== null ? names.layer(entry.activeLayerId) : null) ?? "Layer";
}
