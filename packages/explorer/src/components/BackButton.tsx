import { useDashboardStore } from "../store";
import { useHistoryLabel } from "../excavator/panel/useHistoryLabel";

/** Back: returns to the previous place in the one history (level, selection and viewport). Disabled when there is none. */
export default function BackButton() {
  const canGoBack = useDashboardStore((s) => s.history.length > 0);
  const goBack = useDashboardStore((s) => s.goBack);
  const label = useHistoryLabel();
  return (
    <button
      type="button"
      data-excavator-back
      disabled={!canGoBack}
      onClick={goBack}
      title={label === null ? "Back (Alt+Left)" : `Back to ${label}`}
      className="px-3 py-1.5 text-xs rounded-lg bg-elevated border border-border-subtle text-text-secondary transition-colors enabled:hover:text-text-primary disabled:opacity-40 disabled:cursor-default"
    >
      Back
    </button>
  );
}
