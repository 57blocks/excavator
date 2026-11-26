import { useDashboardStore } from "../../store";

const BUTTON = "px-3 py-1 text-xs font-medium rounded-md transition-colors";

/**
 * The language switch: shown only when the page holds a name table. The first button is the table's language, the
 * second shows every name in English; the translated names come back when the first is chosen again.
 */
export function LanguageSwitch() {
  const table = useDashboardStore((s) => s.nameTranslations);
  const showTranslations = useDashboardStore((s) => s.showTranslations);
  const setShowTranslations = useDashboardStore((s) => s.setShowTranslations);
  if (table === null) return null;
  const choices: [boolean, string][] = [
    [true, table.language],
    [false, "English"],
  ];
  return (
    <div className="flex items-center rounded-lg bg-elevated p-0.5" role="group" aria-label="Language" data-excavator-language-switch>
      {choices.map(([show, label]) => (
        <button
          key={label}
          type="button"
          onClick={() => setShowTranslations(show)}
          aria-pressed={showTranslations === show}
          className={`${BUTTON} ${showTranslations === show ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-secondary"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
