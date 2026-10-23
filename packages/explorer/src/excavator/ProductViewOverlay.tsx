import { useEffect, useState } from "react";
import { useDashboardStore } from "../store";
import { describeProductState, loadProductStates, type LoadedProductStates } from "./productStates";
import { productViewDef } from "./productViews";

/**
 * The product view laid over the graph area (openspec: changes/explorer-products,
 * design D2). Absolute and opaque so the graph under it stays mounted and keeps
 * its viewport and layout. For now it holds the product's title and state; the
 * views come with the next changes of this slice.
 */
export default function ProductViewOverlay() {
  const productView = useDashboardStore((s) => s.productView);
  const [loaded, setLoaded] = useState<LoadedProductStates | null>(null);

  useEffect(() => {
    let live = true;
    void loadProductStates().then((result) => {
      if (live) setLoaded(result);
    });
    return () => {
      live = false;
    };
  }, []);

  if (productView === null) return null;
  const def = productViewDef(productView);
  const lines = loaded === null ? null : describeProductState(loaded.states[productView], loaded.snapshotRevision);
  return (
    <div
      className="absolute inset-0 z-10 overflow-auto bg-root p-6"
      data-excavator-product-view={productView}
    >
      <h2 className="font-heading text-2xl text-text-primary tracking-wide">{def.title}</h2>
      {lines === null ? null : (
        <ul className="mt-3 space-y-1 text-sm text-text-secondary">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
