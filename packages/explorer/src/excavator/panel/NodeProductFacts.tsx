import { useMemo } from "react";
import { coChangedFiles, docUnitsCitingFile, hotspotOfFile, unusedOfNode } from "../nodeFacts";
import { useProductFile, type ProductFileName } from "../views/productFiles";
import { LIST_CLASS, Section } from "./Section";
import { useProductAvailability } from "./usePageStatus";

const CO_CHANGED_SHOWN = 5;

/** A product's file, only while the page holds the product; null while it is read, missing, or not included (the status line says why). */
function useUsableFile(product: string, file: ProductFileName): unknown {
  const availability = useProductAvailability(product);
  const loaded = useProductFile(availability.usable ? file : null);
  return loaded !== null && loaded.state === "ready" ? loaded.value : null;
}

/** The node's hotspot, unused-code and document facts; a product that is not included shows nothing here. */
export function NodeProductFacts({ node }: { node: { id: string; type: string; filePath?: string } }) {
  const hotspots = useUsableFile("hotspots", "hotspots.json");
  const unused = useUsableFile("unused-code", "unused-code.json");
  const docMap = useUsableFile("doc-map", "doc-map.json");
  const checks = useUsableFile("doc-map", "doc-map-checks.json");
  const filePath = node.filePath;

  const hotspot = useMemo(() => (filePath === undefined ? null : hotspotOfFile(hotspots, filePath)), [hotspots, filePath]);
  const together = useMemo(() => (filePath === undefined ? [] : coChangedFiles(hotspots, filePath, CO_CHANGED_SHOWN)), [hotspots, filePath]);
  const unusedItems = useMemo(() => unusedOfNode(unused, node), [unused, node.id, node.type, node.filePath]); // eslint-disable-line react-hooks/exhaustive-deps
  const documents = useMemo(() => (filePath === undefined ? [] : docUnitsCitingFile(docMap, checks, filePath)), [docMap, checks, filePath]);

  return (
    <>
      {hotspot !== null && (
        <Section title="Hotspot">
          <p className="m-0 pb-2 text-xs text-text-secondary" data-excavator-hotspot>
            {[
              hotspot.commits === null ? null : `Changed in ${hotspot.commits} commits${hotspot.authors === null ? "" : ` by ${hotspot.authors} authors`}`,
              hotspot.lastChanged === null ? null : `last on ${hotspot.lastChanged.slice(0, 10)}`,
            ]
              .filter((part) => part !== null)
              .join(", ")}
            {hotspot.rank === null ? "" : `${hotspot.commits === null && hotspot.lastChanged === null ? "" : "; "}rank ${hotspot.rank} by score`}
          </p>
          {together.length > 0 && (
            <>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Changed together with</h4>
              <ul className={LIST_CLASS}>
                {together.map((file) => (
                  <li key={file.path} className="flex items-baseline justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate font-mono text-[11px] text-text-primary" title={file.path}>
                      {file.path}
                    </span>
                    <span className="shrink-0 text-[10px] text-text-muted">{`${file.together} times`}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}
      {unusedItems.length > 0 && (
        <Section title="Unused code">
          <ul className={LIST_CLASS} data-excavator-node-unused>
            {unusedItems.map((item) => (
              <li key={item.id} className="py-2 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-text-primary">{item.name ?? item.id}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-muted">{item.confidence ?? "no confidence"}</span>
                </div>
                <div className="text-[11px] text-text-muted">{[item.line === null ? null : `line ${item.line}`, item.reason].filter((part) => part !== null).join(", ")}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {documents.length > 0 && (
        <Section title="Documents">
          <ul className={LIST_CLASS} data-excavator-node-documents>
            {documents.map((unit, index) => (
              <li key={`${unit.document}-${unit.id}-${index}`} className="py-2 text-xs">
                <div className="text-text-primary">{unit.title ?? unit.id ?? "untitled unit"}</div>
                <div className="text-[11px] text-text-muted">{[unit.document, unit.id, unit.verdict].filter((part) => part !== null).join(" \u00b7 ")}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
