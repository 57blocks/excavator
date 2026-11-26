import { useMemo } from "react";
import { useDashboardStore, activeTranslations } from "../../store";
import { groupsOf } from "../domainLevels";
import { historyLabel, type HistoryNames } from "../historyLabel";
import { domainTitle, translatedText, translatorOf } from "../nameTranslations";

/** The name of the view Back returns to (translated like other names), or null when the history is empty. */
export function useHistoryLabel(): string | null {
  const entry = useDashboardStore((s) => s.history[s.history.length - 1]);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const featureGroups = useDashboardStore((s) => s.featureGroups);
  const graph = useDashboardStore((s) => s.graph);
  const table = useDashboardStore(activeTranslations);
  const translate = useMemo(() => translatorOf(table), [table]);

  return useMemo(() => {
    if (entry === undefined) return null;
    const names: HistoryNames = {
      domain: (id) => {
        const node = domainGraph?.nodes.find((item) => item.id === id);
        return node ? domainTitle(node.name, translate).label : null;
      },
      group: (domainId, groupId) => {
        if (!domainGraph) return null;
        const group = groupsOf(featureGroups, domainGraph, domainId).find((item) => item.id === groupId);
        return group ? { label: domainTitle(group.label, translate).label, qualifier: group.qualifier } : null;
      },
      layer: (id) => {
        const layer = graph?.layers.find((item) => item.id === id);
        return layer ? translatedText(layer.name, translate) : null;
      },
      folder: (id) => {
        const name = id.replace(/^container:/, "").split("/").pop() ?? id;
        return name === "~" ? "(root)" : name;
      },
    };
    return historyLabel(entry, names);
  }, [entry, domainGraph, featureGroups, graph, translate]);
}
