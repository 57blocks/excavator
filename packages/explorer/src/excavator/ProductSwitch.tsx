import { useDashboardStore } from "../store";
import { PRODUCT_VIEWS } from "./productViews";

/**
 * The Unused | Hotspots | Doc map buttons (openspec: changes/explorer-products,
 * design D2). Same segmented style as the Domain | Structural switch; the open
 * view is highlighted and a second click on it keeps it open (changes/explorer-view-defaults,
 * design D2). Plain English text, not in the locale tables.
 */
export default function ProductSwitch({ onPick }: { onPick?: () => void }) {
  const productView = useDashboardStore((s) => s.productView);
  const openProductView = useDashboardStore((s) => s.openProductView);
  return (
    <div className="flex items-center bg-elevated rounded-lg p-0.5" role="group" aria-label="Products" data-excavator-product-switch>
      {PRODUCT_VIEWS.map((def) => (
        <button
          key={def.view}
          type="button"
          onClick={() => {
            openProductView(def.view);
            onPick?.();
          }}
          title={def.title}
          aria-pressed={productView === def.view}
          data-excavator-product-button={def.view}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            productView === def.view ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-secondary"
          }`}
        >
          {def.label}
        </button>
      ))}
    </div>
  );
}
