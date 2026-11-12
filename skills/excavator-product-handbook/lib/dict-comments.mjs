/**
 * The comment next to a member (openspec change handbook-status-dictionary,
 * design D3). Two places count: after the member on its own line (a `//` or a
 * block comment, nothing but a separator between them), and directly above it:
 * the run of `//` lines that ends on the line above, or one block comment that
 * does, with no blank line between. The text is the comment's own, copied with
 * its markers removed and nothing else changed; lines of a block or of a run
 * are joined with one space. Nothing is paraphrased.
 */

/** The text of one comment with its markers removed: `//`, `/*`, `*\/` and the `*` that decorates a block's lines. */
export function commentPieces(text, comment) {
  const raw = text.slice(comment.start, comment.end);
  if (comment.kind === 'line') return [raw.replace(/^\/{2,}/, '').trim()];
  const body = raw.replace(/^\/\*+/, '').replace(/\*+\/$/, '');
  return body.split('\n').map((line) => line.replace(/^\s*\*+/, '').trim());
}

/** The finder for one file's reading: `commentsFor(start, end)` returns the comments of the member that occupies `[start, end)`. */
export function commentFinder(source) {
  const { text, code, comments, lineAt } = source;
  const lineStart = (index) => text.lastIndexOf('\n', index - 1) + 1;
  const lineEnd = (index) => {
    const at = text.indexOf('\n', index);
    return at < 0 ? text.length : at;
  };
  const blankBetween = (from, to) => /^\s*$/.test(code.slice(from, to));

  /** Comments that stand alone on their lines, by the line they end on. */
  const ownLine = new Map();
  for (const comment of comments) {
    const last = comment.end > comment.start ? comment.end - 1 : comment.end;
    if (blankBetween(lineStart(comment.start), comment.start) && blankBetween(comment.end, lineEnd(last))) ownLine.set(lineAt(last), comment);
  }

  const entry = (list, where) => {
    const pieces = list.flatMap((comment) => commentPieces(text, comment)).filter((piece) => piece !== '');
    if (pieces.length === 0) return null;
    const line = lineAt(list[0].start);
    const endLine = lineAt(list.at(-1).end > list.at(-1).start ? list.at(-1).end - 1 : list.at(-1).end);
    return { text: pieces.join(' '), line, ...(endLine === line ? {} : { endLine }), where };
  };

  return function commentsFor(start, end) {
    const found = [];
    const above = ownLine.get(lineAt(start) - 1);
    if (above !== undefined) {
      const run = [above];
      if (above.kind === 'line') {
        let line = lineAt(start) - 2;
        while (ownLine.get(line)?.kind === 'line') {
          run.unshift(ownLine.get(line));
          line -= 1;
        }
      }
      const made = entry(run, 'above');
      if (made !== null) found.push(made);
    }
    const rest = lineEnd(end);
    if (blankBetween(end, rest) || /^[\s,;]*$/.test(code.slice(end, rest))) {
      const trailing = comments.filter((comment) => comment.start >= end && comment.start < rest);
      for (const comment of trailing) {
        const made = entry([comment], 'same-line');
        if (made !== null) found.push(made);
      }
    }
    return found;
  };
}
