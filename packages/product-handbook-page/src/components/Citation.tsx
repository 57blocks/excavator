/** A citation as the technical view's text writes it: a file and one line or a range of lines. */
export interface ParsedCitation { file: string; start: number; end: number | null }

const CITATION = /^(\S+?):(\d+)(?:-(\d+))?$/;

/** The citation an inline code text is, when the whole text is one (a path with no spaces, a colon, a line or a range); otherwise null. */
export function parseCitation(text: string): ParsedCitation | null {
  const found = CITATION.exec(text);
  if (found === null) return null;
  return { file: found[1], start: Number(found[2]), end: found[3] === undefined ? null : Number(found[3]) };
}

/** The chip a citation is shown as: the file, then the lines. */
export function Citation({ file, start, end }: ParsedCitation) {
  const lines = end === null ? String(start) : `${start}-${end}`;
  return (
    <code className="cite" data-part="citation" title={`${file}:${lines}`}>
      <span className="cite-file">{file}</span>
      <span className="cite-lines">:{lines}</span>
    </code>
  );
}
