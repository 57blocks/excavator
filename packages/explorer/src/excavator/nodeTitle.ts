import type { GraphNode } from "../core/types";

/**
 * Excavator: the title and subtitle a node card shows. A node with a display name shows it as
 * the main title and the code name beneath; a node without one shows the code name alone.
 */
export function nodeTitles(node: Pick<GraphNode, "name" | "displayName">): {
  title: string;
  subtitle: string | null;
} {
  const displayName = typeof node.displayName === "string" ? node.displayName.trim() : "";
  if (displayName === "") return { title: node.name, subtitle: null };
  return { title: displayName, subtitle: node.name };
}
