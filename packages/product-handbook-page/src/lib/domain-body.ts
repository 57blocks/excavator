const FENCE = /^\s*(```|~~~)\s*(\w*)/;
const BULLET = /^\s*[-*+] /;

interface Section { lines: string[]; heading: boolean; bullet: boolean; table: boolean; mermaid: boolean }

const fresh = (heading: boolean): Section => ({ lines: [], heading, bullet: false, table: false, mermaid: false });

/**
 * A domain's section of the domains chapter without its hand-over list. The chapter's writing task prescribes three forms for a
 * domain: its features as a table, its hand-overs as a bullet list, its main line as a mermaid chart with numbered steps. The
 * writer chooses the sub-headings, so a level-3 section is recognised by its form, never by its heading text: a section with a
 * bullet item and neither a table nor a mermaid block is the hand-over list and is dropped. Ordered lists are not bullet items.
 * Lines inside fenced code blocks count for nothing (no list item, no heading, no table). Text before the first level-3
 * heading is kept, and a body with no level-3 heading is returned as it is.
 */
export function withoutHandoverList(markdown: string): string {
  const sections: Section[] = [fresh(false)];
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const open = FENCE.exec(line);
    if (fence !== null) {
      if (open !== null && open[1] === fence && open[2] === '') fence = null;
    } else if (open !== null) {
      fence = open[1];
      if (open[2] === 'mermaid') sections[sections.length - 1].mermaid = true;
    } else if (line.startsWith('### ')) {
      sections.push(fresh(true));
    } else if (BULLET.test(line)) {
      sections[sections.length - 1].bullet = true;
    } else if (line.startsWith('|')) {
      sections[sections.length - 1].table = true;
    }
    sections[sections.length - 1].lines.push(line);
  }
  if (sections.length === 1) return markdown;
  return sections.filter((one) => !(one.heading && one.bullet && !one.table && !one.mermaid)).flatMap((one) => one.lines).join('\n');
}
