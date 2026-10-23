/**
 * The three product views of the offline page (openspec: changes/explorer-products,
 * design D2): the keys the store holds, the entry name each one has in
 * `products.json`, and the words on its button and in its heading.
 */

export type ProductView = "unused" | "hotspots" | "doc-map";

export interface ProductViewDef {
  view: ProductView;
  /** The entry name in `products.json` (the product's name in `products.mjs`). */
  name: string;
  /** The words on the button. */
  label: string;
  /** The heading of the view. */
  title: string;
  /** One sentence under the heading: what the product is. */
  subtitle: string;
}

export const PRODUCT_VIEWS: readonly ProductViewDef[] = [
  { view: "unused", name: "unused-code", label: "Unused", title: "Unused code", subtitle: "Functions no route reaches, as the unused-code product lists them." },
  { view: "hotspots", name: "hotspots", label: "Hotspots", title: "Hotspots", subtitle: "Where the history counts changes, as the hotspots product states them: commits, authors and lines per file and directory, and the files changed together." },
  { view: "doc-map", name: "doc-map", label: "Doc map", title: "Doc map", subtitle: "The functions the documents describe, each with its quote and the code the product ties to it." },
];

export function productViewDef(view: ProductView): ProductViewDef {
  return PRODUCT_VIEWS.find((def) => def.view === view) as ProductViewDef;
}
