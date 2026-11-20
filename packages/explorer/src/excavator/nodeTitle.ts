import type { GraphNode } from "../core/types";
import type { Translate } from "./nameTranslations";

/** Domain-graph nodes have no display name: their `name` is the English name the page translates. */
const DOMAIN_NODE_TYPES: ReadonlySet<string> = new Set(["domain", "flow", "step"]);

/**
 * Excavator: the title and subtitle a node card shows. A node with a display name shows it as
 * the main title and the code name beneath; a node without one shows the code name alone. With a
 * name table (`--language`), the title is the translation of the display name when the table has one,
 * and `original` is the English text it replaces (null when nothing was translated). A domain, flow or
 * step node has its name translated the same way, with no subtitle.
 */
export function nodeTitles(
  node: Pick<GraphNode, "name"> & Partial<Pick<GraphNode, "displayName" | "type">>,
  translate?: Translate,
): {
  title: string;
  subtitle: string | null;
  original: string | null;
} {
  const displayName = typeof node.displayName === "string" ? node.displayName.trim() : "";
  if (displayName === "") {
    const translated = translate && node.type !== undefined && DOMAIN_NODE_TYPES.has(node.type) ? translate(node.name.trim()) : null;
    if (translated !== null) return { title: translated, subtitle: null, original: node.name };
    return { title: node.name, subtitle: null, original: null };
  }
  const translated = translate?.(displayName) ?? null;
  if (translated !== null) return { title: translated, subtitle: node.name, original: displayName };
  return { title: displayName, subtitle: node.name, original: null };
}
