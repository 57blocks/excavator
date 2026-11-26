import type { ProjectText as Shown } from "../projectText";
import type { Translate } from "../nameTranslations";
import { MutedLine } from "./Section";

/**
 * One of the project texts, translated through the same name table as other names (the English text when there is no
 * translation), or the muted line that says why there is none. `empty` is what a missing text shows (nothing by default).
 */
export function ProjectTextView({ shown, translate, empty = null }: { shown: Shown; translate?: Translate; empty?: string | null }) {
  if (shown.kind === "text") {
    return <p className="m-0 whitespace-pre-line pb-2 text-sm leading-relaxed text-text-secondary" data-excavator-project-text>{translate?.(shown.text) ?? shown.text}</p>;
  }
  if (shown.kind === "unavailable") return <MutedLine>{`Not available: ${shown.reason}`}</MutedLine>;
  return empty === null ? null : <MutedLine>{empty}</MutedLine>;
}
