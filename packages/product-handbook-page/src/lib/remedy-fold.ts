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
