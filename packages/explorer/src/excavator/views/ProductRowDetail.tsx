import { useDashboardStore } from "../../store";
import { VIEW_MODULES } from "./registry";

/** The details of the chosen row of the open product view; nothing when no row is chosen. */
export default function ProductRowDetail() {
  const view = useDashboardStore((s) => s.productView);
  const row = useDashboardStore((s) => s.productRow);
  const setProductRow = useDashboardStore((s) => s.setProductRow);
  if (view === null || row === null) return null;
  const { Detail } = VIEW_MODULES[view];
  return <Detail row={row} onClose={() => setProductRow(null)} />;
}
