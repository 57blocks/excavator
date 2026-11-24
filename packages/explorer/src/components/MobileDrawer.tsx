import { useEffect } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { ViewSwitch } from "../excavator/header/ViewSwitch";
import { LanguageSwitch } from "../excavator/header/LanguageSwitch";

interface Props {
  open: boolean;
  onClose: () => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted mb-3">
      {children}
    </h3>
  );
}

/** The language switch with its label; nothing when the page has no name table. */
function LanguageSection() {
  const hasTable = useDashboardStore((s) => s.nameTranslations !== null);
  if (!hasTable) return null;
  return (
    <section>
      <SectionLabel>Language</SectionLabel>
      <LanguageSwitch />
    </section>
  );
}

export default function MobileDrawer({
  open,
  onClose,
}: Props) {
  const graph = useDashboardStore((s) => s.graph);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll while open so the page behind doesn't drift
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  return (
    <div
      className={`fixed inset-0 z-40 ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={`absolute inset-0 bg-black/65 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Panel */}
      <aside
        className={`absolute left-0 top-0 bottom-0 w-[86%] max-w-[360px] bg-surface border-r border-border-subtle flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-label="Settings"
      >
        {/* Drawer header */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              {t.drawer.controls}
            </span>
            <h2 className="font-heading text-lg text-text-primary mt-0.5 leading-none">
              {graph?.project.name ?? t.drawer.dashboard}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-elevated transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-5 space-y-7">
          <section>
            <SectionLabel>{t.drawer.view}</SectionLabel>
            <ViewSwitch />
          </section>
          <LanguageSection />
        </div>
      </aside>
    </div>
  );
}
