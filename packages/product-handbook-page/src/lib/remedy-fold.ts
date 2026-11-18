const FENCE = /^\s*(?:```|~~~)/;
const LEVEL_TWO = /^##\s+(.*?)\s*#*\s*$/;
const LEVEL_ONE = /^#\s/;
const PROCESS_HEADING = /^(P\d+)(?:\s|$)/;

/** The process id (`P22`) that the text of a level-2 heading starts with, or null. */
export const processOfHeading = (title: string): string | null => PROCESS_HEADING.exec(title)?.[1] ?? null;

/**
 * The remedies chapter without the sections of the processes in `processes` (the level-2 sections whose heading is `P<n> <name>`, from
 * the heading to the next level-2 or level-1 heading, outside code fences). Each line of a left-out section becomes an empty line, so
 * every other line stays on its own line number and the anchors `remedy-<line>` and the item links keep pointing at it.
 */
export function withoutProcessSections(text: string, processes: ReadonlySet<string>): string {
  let fenced = false;
  let inside = false;
  return text.split('\n').map((line) => {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) {
      const heading = LEVEL_TWO.exec(line);
      if (heading !== null) {
        const id = processOfHeading(heading[1]);
        inside = id !== null && processes.has(id);
      } else if (LEVEL_ONE.test(line)) inside = false;
    }
    return inside ? '' : line;
  }).join('\n');
}

/** `text` with every line outside the part `keep` selects blanked, so each kept line stays on its own line number. `keep(heading)` is called for each level-2 heading outside fences (null before the first) and says whether the section it starts is kept. */
function keepSections(text: string, keep: (heading: string | null) => boolean): string {
  let fenced = false;
  let kept = keep(null);
  return text.split('\n').map((line) => {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) {
      const heading = LEVEL_TWO.exec(line);
      if (heading !== null) kept = keep(heading[1]);
      else if (LEVEL_ONE.test(line)) kept = keep(null);
    }
    return kept ? line : '';
  }).join('\n');
}

/** The text above the first level-2 heading of the remedies chapter (its notices), the rest blanked. */
export const onlyBeforeSections = (text: string): string => keepSections(text, (heading) => heading === null);

/** The generated section at the end of the remedies chapter (the level-2 section titled `title`), the rest blanked. */
export const onlyGeneratedSection = (text: string, title: string): string => {
  let from = false;
  return keepSections(text, (heading) => { if (heading === title) from = true; return from; });
};
