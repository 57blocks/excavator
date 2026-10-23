import { useDashboardStore } from "../../store";
import ProductRowDetail from "./ProductRowDetail";

/**
 * The right sidebar's content while a product view is open and a row is chosen
 * (openspec: changes/explorer-products, design D4): the row's details, in place of
 * the node info or the project overview. Closing them brings the normal sidebar back.
 */
export default function ProductRowSidebar() {
  const view = useDashboardStore((s) => s.productView);
  const row = useDashboardStore((s) => s.productRow);
  if (view === null || row === null) return null;
  return (
    <div className="h-full w-full overflow-auto p-5 animate-fade-slide-in" data-excavator-row-sidebar="">
      <ProductRowDetail />
    </div>
  );
}
