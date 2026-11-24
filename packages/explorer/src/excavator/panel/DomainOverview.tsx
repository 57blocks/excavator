import { useMemo } from "react";
import { useDashboardStore, activeTranslations } from "../../store";
import NodeInfo from "../../components/NodeInfo";
import { translatorOf } from "../nameTranslations";
import { domainList, projectIntroduction } from "../overview";
import { LIST_CLASS, MutedLine, ROW_BUTTON_CLASS, Section } from "./Section";

/** The overview of the domain view: the project introduction and the domains, business ones first. */
export function DomainOverview() {
  const graph = useDashboardStore((s) => s.graph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const table = useDashboardStore(activeTranslations);
  const activeDomainId = useDashboardStore((s) => s.activeDomainId);
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const clearActiveDomain = useDashboardStore((s) => s.clearActiveDomain);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const intro = useMemo(() => projectIntroduction(graph, domainGraph), [graph, domainGraph]);
  const rows = useMemo(() => domainList(domainGraph, translatorOf(table)), [domainGraph, table]);

  if (activeDomainId !== null && domainGraph?.nodes.some((n) => n.id === activeDomainId)) {
    return (
      <div>
        <div className="px-5 pt-3">
          <button type="button" onClick={clearActiveDomain} className="text-[11px] font-semibold text-gold hover:text-gold-bright">
            {"\u2190 All domains"}
          </button>
        </div>
        <NodeInfo nodeId={activeDomainId} />
      </div>
    );
  }

  return (
    <div>
      <Section title="Project">
        {intro.text === null ? (
          <MutedLine>The knowledge graph has no project description.</MutedLine>
        ) : (
          <p className="pb-2 text-sm leading-relaxed text-text-secondary">{intro.text}</p>
        )}
      </Section>
      <Section title="Domains">
        {rows.length === 0 ? (
          <MutedLine>The domain graph has no domains.</MutedLine>
        ) : (
          <ul className={LIST_CLASS}>
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={ROW_BUTTON_CLASS}
                  data-excavator-domain-row={row.id}
                  data-excavator-domain-kind={row.kind ?? ""}
                  onClick={() => {
                    navigateToDomain(row.id);
                    selectNode(null);
                  }}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm text-text-primary" data-excavator-domain-label>{row.label}</span>
                    {row.kind !== null && <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-muted">{row.kind}</span>}
                  </span>
                  {row.original !== null && <span className="block truncate text-[11px] text-text-muted" data-excavator-domain-original>{row.original}</span>}
                  {row.summary !== "" && (
                    <span className="block truncate text-[11px] text-text-secondary" title={(domainGraph?.nodes.find((n) => n.id === row.id)?.summary ?? "").trim()}>
                      {row.summary}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
