import Fuse, { type IFuseOptions } from "fuse.js";
import type { GraphNode } from "./types.js";

// Excavator: the translation of a node's display name, searched like the display name.
type SearchItem = GraphNode & { translatedName?: string };
type Translate = (english: string) => string | null;

function searchItems(nodes: GraphNode[], translate?: Translate): SearchItem[] {
  if (!translate) return nodes;
  return nodes.map((node) => {
    const english = typeof node.displayName === "string" ? node.displayName.trim() : "";
    const translated = english === "" ? null : translate(english);
    return translated === null ? node : { ...node, translatedName: translated };
  });
}

export interface SearchResult {
  nodeId: string;
  score: number; // 0 = perfect match, 1 = worst match
}

export interface SearchOptions {
  types?: GraphNode["type"][];
  limit?: number;
}

const FUSE_OPTIONS: IFuseOptions<SearchItem> = {
  keys: [
    { name: "name", weight: 0.4 },
    // Excavator: the display name is searched like the code name.
    { name: "displayName", weight: 0.4 },
    { name: "translatedName", weight: 0.4 },
    { name: "tags", weight: 0.3 },
    { name: "summary", weight: 0.2 },
    { name: "languageNotes", weight: 0.1 },
  ],
  threshold: 0.4,
  includeScore: true,
  ignoreLocation: true,
  useExtendedSearch: true,
};

export class SearchEngine {
  private fuse: Fuse<SearchItem>;
  private nodes: GraphNode[];
  private translate?: Translate;

  constructor(nodes: GraphNode[], translate?: Translate) {
    this.nodes = nodes;
    this.translate = translate;
    this.fuse = new Fuse(searchItems(nodes, translate), FUSE_OPTIONS);
  }

  search(query: string, options?: SearchOptions): SearchResult[] {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const limit = options?.limit ?? 50;

    // Use extended search: join space-separated tokens with | (OR)
    // so "auth contrl" becomes "auth | contrl" — matches items containing either token
    const extendedQuery = trimmed.split(/\s+/).join(" | ");
    const rawResults = this.fuse.search(extendedQuery);

    let filtered = rawResults;
    if (options?.types && options.types.length > 0) {
      const allowedTypes = new Set(options.types);
      filtered = filtered.filter((r) => allowedTypes.has(r.item.type));
    }

    return filtered.slice(0, limit).map((r) => ({
      nodeId: r.item.id,
      score: r.score ?? 0,
    }));
  }

  updateNodes(nodes: GraphNode[]): void {
    this.nodes = nodes;
    this.fuse = new Fuse(searchItems(nodes, this.translate), FUSE_OPTIONS);
  }
}
