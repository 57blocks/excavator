import { useEffect, useMemo, useState } from "react";
import { readJson } from "../productStates";
import { productAvailability, readPageManifest, type PageManifest, type ProductAvailability } from "../statusLine";

/**
 * The page's own record of its products: the manifest block of the page and `products.json` from the page data.
 * Both are read once; the data never changes after the page loads.
 */

let productsJson: Promise<{ value?: unknown; failure?: string }> | null = null;

export interface PageStatus {
  manifest: PageManifest;
  /** The parsed `products.json`; undefined while it is being read or when the page has none. */
  products: unknown;
}

export function usePageStatus(): PageStatus {
  const manifest = useMemo(() => readPageManifest(), []);
  const [products, setProducts] = useState<unknown>(undefined);
  useEffect(() => {
    let live = true;
    productsJson ??= readJson("products.json");
    void productsJson.then((result) => {
      if (live) setProducts(result.value);
    });
    return () => {
      live = false;
    };
  }, []);
  return { manifest, products };
}

/** Whether the product's data can be shown, and the muted line that says its state when it cannot (or is from another revision). */
export function useProductAvailability(name: string): ProductAvailability {
  const { manifest, products } = usePageStatus();
  return useMemo(() => productAvailability(manifest, products, name), [manifest, products, name]);
}
