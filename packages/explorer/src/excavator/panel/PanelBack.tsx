import { useDashboardStore } from "../../store";
import { useHistoryLabel } from "./useHistoryLabel";

/** The history Back at the top of the right panel: an arrow and the name of the view it returns to. Absent when there is none. */
export function PanelBack() {
  const goBack = useDashboardStore((s) => s.goBack);
  const label = useHistoryLabel();
  if (label === null) return null;
  return (
    <div className="px-5 pt-3">
      <button
        type="button"
        data-excavator-panel-back
        onClick={goBack}
        title={`Back to ${label}`}
        className="block max-w-full truncate text-left text-[11px] font-semibold text-gold hover:text-gold-bright"
      >
        {`\u2190 ${label}`}
      </button>
    </div>
  );
}
