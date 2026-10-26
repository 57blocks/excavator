const ATX_HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;

/**
 * The chapter body without its first heading when that heading only repeats
 * the feature's name, which the page already shows as its title. The heading
 * must be the first block (blank lines before it do not count) and its text,
 * trimmed, must equal `name` exactly, case included; a heading that differs, or
 * that is not first, stays. Both `# Name` and the two-line `Name` over `====`
 * forms are headings; the blank lines that followed the heading go with it.
 */
export function dropDuplicateTitle(body: string, name: string): string {
  const lines = body.split('\n');
  let first = 0;
  while (first < lines.length && lines[first].trim() === '') first += 1;
  if (first >= lines.length) return body;

  let length = 0;
  const atx = ATX_HEADING.exec(lines[first]);
  if (atx !== null) {
    if (atx[1].trim() !== name.trim()) return body;
    length = 1;
  } else if (first + 1 < lines.length && SETEXT_UNDERLINE.test(lines[first + 1]) && lines[first].trim() !== '' && !/^ {4}/.test(lines[first])) {
    if (lines[first].trim() !== name.trim()) return body;
    length = 2;
  } else {
    return body;
  }

  let rest = first + length;
  while (rest < lines.length && lines[rest].trim() === '') rest += 1;
  return lines.slice(rest).join('\n');
}
