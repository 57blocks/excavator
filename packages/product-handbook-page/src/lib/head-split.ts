/**
 * Split a chapter's Markdown after its head: the level-1 heading and the notice paragraphs that follow it (each starting with
 * one of `notices`, the fixed notice texts). Returns the head and the rest; the head is empty when the text does not start
 * with a level-1 heading. Pure text: no diagram or heading of the rest moves, so the numbering of headings stays as it was.
 */
export function splitHead(source: string, notices: readonly string[]): { head: string; rest: string } {
  const lines = source.split('\n');
  let at = 0;
  while (at < lines.length && lines[at].trim() === '') at += 1;
  if (at >= lines.length || !/^# /.test(lines[at])) return { head: '', rest: source };
  let end = at + 1;
  const wanted = notices.filter((notice) => notice !== '');
  for (;;) {
    let start = end;
    while (start < lines.length && lines[start].trim() === '') start += 1;
    if (start >= lines.length) break;
    let stop = start;
    while (stop < lines.length && lines[stop].trim() !== '') stop += 1;
    const paragraph = lines.slice(start, stop).join('\n').trimStart();
    if (!wanted.some((notice) => paragraph.startsWith(notice))) break;
    end = stop;
  }
  return { head: lines.slice(0, end).join('\n'), rest: lines.slice(end).join('\n') };
}
