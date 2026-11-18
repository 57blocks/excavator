const FENCE = /^\s*(```|~~~)\s*(\w*)/;
const BULLET = /^\s*[-*+] /;

interface Section { lines: string[]; heading: boolean; title: string; bullet: boolean; table: boolean; mermaid: boolean }

const fresh = (heading: boolean, title = ''): Section => ({ lines: [], heading, title, bullet: false, table: false, mermaid: false });

/**
 * A domain's section of the domains chapter without its hand-over list. The writing task gives a domain three level-3 sections
 * under fixed headings (design D23): features, hand-overs, main line. The section whose heading equals `title` (the fixed
 * hand-overs heading) is dropped. When no section has that heading (an output written before the headings were fixed), a
 * section is recognised by its form: one with a bullet item and neither a table nor a mermaid block is the hand-over list and
 * is dropped. Ordered lists are not bullet items. Lines inside fenced code blocks count for nothing (no list item, no heading,
 * no table). Text before the first level-3 heading is kept, and a body with no level-3 heading is returned as it is.
 */
export function withoutHandoverList(markdown: string, title = ''): string {
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
      sections.push(fresh(true, line.slice(4).replace(/\s*#*\s*$/, '').trim()));
    } else if (BULLET.test(line)) {
      sections[sections.length - 1].bullet = true;
    } else if (line.startsWith('|')) {
      sections[sections.length - 1].table = true;
    }
    sections[sections.length - 1].lines.push(line);
  }
  if (sections.length === 1) return markdown;
  const wanted = title.trim();
  if (wanted !== '' && sections.some((one) => one.heading && one.title === wanted)) {
    return sections.filter((one) => !(one.heading && one.title === wanted)).flatMap((one) => one.lines).join('\n');
  }
  return sections.filter((one) => !(one.heading && one.bullet && !one.table && !one.mermaid)).flatMap((one) => one.lines).join('\n');
}

/**
 * A domain's section of the domains chapter split at the level-3 section whose heading equals `title` (the main line): the text
 * before it and the text after it, the section itself left out (it runs to the next level-3 heading). `found` is false, and `before`
 * is the whole text, when no section has that heading. Lines inside fenced code blocks count for nothing.
 */
export function splitAtSection(markdown: string, title: string): { before: string; after: string; found: boolean } {
  const lines = markdown.split('\n');
  const wanted = title.trim();
  let fence: string | null = null;
  let from = -1;
  let to = lines.length;
  lines.forEach((line, at) => {
    const open = FENCE.exec(line);
    if (fence !== null) {
      if (open !== null && open[1] === fence && open[2] === '') fence = null;
    } else if (open !== null) {
      fence = open[1];
    } else if (line.startsWith('### ')) {
      if (from === -1 && wanted !== '' && line.slice(4).replace(/\s*#*\s*$/, '').trim() === wanted) from = at;
      else if (from !== -1 && to === lines.length) to = at;
    }
  });
  if (from === -1) return { before: markdown, after: '', found: false };
  return { before: lines.slice(0, from).join('\n'), after: lines.slice(to).join('\n'), found: true };
}
