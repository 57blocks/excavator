import type { ProductView } from "../productViews";
import { docMapView } from "./docmap/DocMapView";
import { hotspotsView } from "./hotspots/HotspotsView";
import type { ViewModule } from "./types";
import { unusedView } from "./unused/UnusedView";

/**
 * The view of each product (openspec: changes/explorer-products, design D3): the files it
 * reads, its body, and the details of one of its rows. One entry per product.
 */
export const VIEW_MODULES: Record<ProductView, ViewModule> = {
  unused: unusedView,
  hotspots: hotspotsView,
  "doc-map": docMapView,
};
