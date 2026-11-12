/** A member as `dictionaries.json` holds it (openspec change handbook-status-dictionary, design D2 and D3): the reading's member with its file and an empty list of display names. */

/** `raw` is `{ name, value, computed, reason?, line, comments }` as the readers give it. */
export function makeMember(raw, file) {
  const { name, value, computed, reason, line, comments, declaredAs } = raw;
  return {
    name,
    value,
    computed,
    ...(computed ? {} : { reason }),
    ...(declaredAs === undefined ? {} : { declaredAs }),
    file,
    line,
    comments: comments.map(({ text, line: from, endLine, where }) => ({ text, file, line: from, ...(endLine === undefined ? {} : { endLine }), where })),
    labels: [],
  };
}
