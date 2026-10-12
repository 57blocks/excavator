/**
 * java-package-declaration.mjs
 *
 * The `package` a Java source file declares (openspec: changes/name-mention-
 * facts, D4). The declaration is the first thing in a compilation unit, after
 * whitespace and comments, so only that leading stretch is read: a file of any
 * size costs what its header costs.
 *
 * Pure: text in, name out. A file with no `package` declaration is in the
 * default package, which is `null` here and matches nothing.
 */

const PACKAGE_DECLARATION = /package\s+([^;]+?)\s*;/y;
const QUALIFIED_NAME = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/** Offset of the first character that is neither whitespace nor a comment, or -1 for an unterminated comment. */
function skipLeadingTrivia(text) {
  let i = 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith('//', i)) {
      const newline = text.indexOf('\n', i);
      if (newline < 0) return text.length;
      i = newline + 1;
    } else if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      if (close < 0) return -1;
      i = close + 2;
    } else {
      return i;
    }
  }
}

/**
 * @param {string} text the content of a `.java` file
 * @returns {string|null} the declared package, whitespace inside the name
 *   removed (a name wrapped across lines is still one name), or null when the
 *   file declares none (or one that is not a qualified name)
 */
export function readJavaPackage(text) {
  const start = skipLeadingTrivia(text);
  if (start < 0) return null;
  PACKAGE_DECLARATION.lastIndex = start;
  const declaration = PACKAGE_DECLARATION.exec(text);
  if (!declaration) return null;
  const name = declaration[1].replace(/\s+/g, '');
  return QUALIFIED_NAME.test(name) ? name : null;
}
