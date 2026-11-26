import type { StoredProject } from "./domainLevels";

/** What a panel shows for one of the project texts. */
export type ProjectText = { kind: "text"; text: string } | { kind: "unavailable"; reason: string } | { kind: "none" };

/**
 * The stored text when present; else the reason the stored project gives for having none; else the knowledge graph's
 * project description when it is not empty; else nothing.
 */
export function projectText(project: StoredProject | null, which: "introduction" | "technicalOverview", kgDescription: string | null): ProjectText {
  const stored = project?.[which];
  if (typeof stored === "string" && stored.trim() !== "") return { kind: "text", text: stored.trim() };
  if (project?.unavailable) return { kind: "unavailable", reason: project.unavailable };
  const fallback = (kgDescription ?? "").trim();
  return fallback === "" ? { kind: "none" } : { kind: "text", text: fallback };
}
