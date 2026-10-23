import { useEffect, useState } from "react";
import { readInlineFile, type InlineDataFile } from "../../offline/inlineData";

/**
 * Reads a product file from the page data (openspec: changes/explorer-products,
 * design D1). The data never changes after the page loads, so each file is read
 * once and the view and the sidebar share the result. A file the page does not
 * hold is a visible state with its reason, never an empty product.
 */

export type ProductFileName = Extract<InlineDataFile, "unused-code.json" | "hotspots.json" | "doc-map.json" | "doc-map-checks.json">;

export type ProductFile = { state: "ready"; value: unknown } | { state: "missing"; reason: string };

const cache = new Map<ProductFileName, Promise<ProductFile>>();

/** Forgets what was read; for tests. */
export function resetProductFileCache(): void {
  cache.clear();
}

/** The file's content, or why it is not there. `data` is the page data (the global by default). */
export function loadProductFile(name: ProductFileName, data?: unknown): Promise<ProductFile> {
  const cached = cache.get(name);
  if (cached) return cached;
  const read = (async (): Promise<ProductFile> => {
    try {
      const response = await (data === undefined ? readInlineFile(name) : readInlineFile(name, data));
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        return { state: "missing", reason: typeof body?.error === "string" ? body.error : `${name} is not included in this page` };
      }
      return { state: "ready", value: await response.json() };
    } catch (error) {
      return { state: "missing", reason: `${name} could not be read: ${error instanceof Error ? error.message : String(error)}` };
    }
  })();
  cache.set(name, read);
  return read;
}

/** The file for a component: null while it is being read. */
export function useProductFile(name: ProductFileName | null): ProductFile | null {
  const [result, setResult] = useState<{ name: ProductFileName; file: ProductFile } | null>(null);
  useEffect(() => {
    if (name === null) return undefined;
    let live = true;
    void loadProductFile(name).then((file) => {
      if (live) setResult({ name, file });
    });
    return () => {
      live = false;
    };
  }, [name]);
  return name !== null && result !== null && result.name === name ? result.file : null;
}
