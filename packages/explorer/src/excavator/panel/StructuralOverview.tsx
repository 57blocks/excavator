import { useMemo, useState } from "react";
import { useDashboardStore } from "../../store";
import { domainTitle, translatorOf } from "../nameTranslations";
import { externalSystemList, runtimeUnits, techStack, topHotspotFiles, unusedCandidates } from "../overview";
import { useProductFile, type ProductFileName } from "../views/productFiles";
import { LIST_CLASS, MutedLine, ROW_BUTTON_CLASS, Section } from "./Section";
import { UnusedList } from "./UnusedList";
import { useProductAvailability } from "./usePageStatus";

const MOST_CHANGED_SHOWN = 10;

/** The product's file once the page says it is usable; `ready` is false while it is read and when it is missing. */
function useProductValue(product: string, file: ProductFileName): { line: string | null; value: unknown; ready: boolean } {
  const availability = useProductAvailability(product);
  const loaded = useProductFile(availability.usable ? file : null);
  if (!availability.usable) return { line: availability.line, value: null, ready: false };
  if (loaded === null) return { line: availability.line, value: null, ready: false };
  if (loaded.state === "missing") return { line: availability.line ?? `${product}: ${loaded.reason}`, value: null, ready: false };
  return { line: availability.line, value: loaded.value, ready: true };
}

/** The overview of the structural view: runtime units, tech stack, layers, external systems, most changed files, unused code. */
export function StructuralOverview() {
  const graph = useDashboardStore((s) => s.graph);
  const table = useDashboardStore((s) => s.nameTranslations);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const drillIntoLayer = useDashboardStore((s) => s.drillIntoLayer);
  const navigateToNodeInLayer = useDashboardStore((s) => s.navigateToNodeInLayer);
  const [showUnused, setShowUnused] = useState(false);
  const relations = useProductValue("relations", "relations-graph.json");
  const hotspots = useProductValue("hotspots", "hotspots.json");
  const unused = useProductValue("unused-code", "unused-code.json");
  const translate = useMemo(() => translatorOf(table), [table]);
  const units = useMemo(() => runtimeUnits(relations.value), [relations.value]);
  const externals = useMemo(() => externalSystemList(relations.value), [relations.value]);
  const stack = useMemo(() => techStack(graph), [graph]);
  const changed = useMemo(() => topHotspotFiles(hotspots.value, MOST_CHANGED_SHOWN), [hotspots.value]);
  const candidates = useMemo(() => unusedCandidates(unused.value), [unused.value]);

  if (showUnused && unused.ready) return <UnusedList rows={candidates} onBack={() => setShowUnused(false)} />;

  const layers = graph?.layers ?? [];
  const stateLine = (state: { line: string | null }) => (state.line === null ? null : <MutedLine>{state.line}</MutedLine>);

  return (
    <div>
      <Section title="Runtime units">
        {stateLine(relations)}
        {relations.ready &&
          (units.length === 0 ? (
            <MutedLine>The relations product lists no runtime units.</MutedLine>
          ) : (
            <ul className={LIST_CLASS}>
              {units.map((unit) => (
                <li key={unit.id} className="py-2">
                  <div className="truncate text-sm text-text-primary">{unit.name}</div>
                  {unit.root !== null && <div className="truncate font-mono text-[10px] text-text-muted">{unit.root}</div>}
                </li>
              ))}
            </ul>
          ))}
        <h4 className="mt-3 mb-1 border-t border-border-subtle pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Tech stack</h4>
        {stack.languages.length === 0 && stack.frameworks.length === 0 ? (
          <MutedLine>The knowledge graph records no languages or frameworks.</MutedLine>
        ) : (
          <div className="pb-2 text-xs text-text-secondary">
            {stack.languages.length > 0 && <p className="m-0">Languages: {stack.languages.join(", ")}</p>}
            {stack.frameworks.length > 0 && <p className="m-0">Frameworks: {stack.frameworks.join(", ")}</p>}
          </div>
        )}
      </Section>

      <Section title="Layers">
        {layers.length === 0 ? (
          <MutedLine>The knowledge graph has no layers.</MutedLine>
        ) : (
          <ul className={LIST_CLASS}>
            {layers.map((layer) => (
              <li key={layer.id}>
                <button type="button" className={ROW_BUTTON_CLASS} onClick={() => drillIntoLayer(layer.id)}>
                  <span className="block truncate text-sm text-text-primary">{layer.name}</span>
                  {layer.description && <span className="line-clamp-2 text-[11px] text-text-secondary">{layer.description}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="External systems">
        {stateLine(relations)}
        {relations.ready &&
          (externals.length === 0 ? (
            <MutedLine>The relations product lists no external systems.</MutedLine>
          ) : (
            <ul className={LIST_CLASS}>
              {externals.map((external) => {
                const { label, original } = domainTitle(external.label, translate);
                return (
                  <li key={external.id} className="py-2 text-sm text-text-primary">
                    {label}
                    {original !== null && <span className="ml-1 text-[11px] text-text-muted">{original}</span>}
                  </li>
                );
              })}
            </ul>
          ))}
      </Section>

      <Section title="Most changed files">
        {stateLine(hotspots)}
        {hotspots.ready &&
          (changed.length === 0 ? (
            <MutedLine>The hotspots product lists no files with a score.</MutedLine>
          ) : (
            <ul className={LIST_CLASS}>
              {changed.map((file) => {
                const id = `file:${file.path}`;
                const body = (
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-[11px] text-text-primary" title={file.path}>
                      {file.path}
                    </span>
                    {file.commits !== null && <span className="shrink-0 text-[10px] text-text-muted">{`${file.commits} commits`}</span>}
                  </span>
                );
                return (
                  <li key={file.path}>
                    {nodesById.has(id) ? (
                      <button type="button" className={ROW_BUTTON_CLASS} onClick={() => navigateToNodeInLayer(id)}>
                        {body}
                      </button>
                    ) : (
                      <div className="py-2">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ))}
      </Section>

      <Section title="Unused code">
        {stateLine(unused)}
        {unused.ready && (
          <button type="button" className="pb-2 text-left text-xs text-accent hover:text-accent-bright" onClick={() => setShowUnused(true)}>
            Show the unused-code candidates
          </button>
        )}
      </Section>
    </div>
  );
}
