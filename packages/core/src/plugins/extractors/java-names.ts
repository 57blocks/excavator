import type { TreeSitterNode } from "./types.js";

/**
 * Qualified names and type texts as the Java extractor records them (openspec:
 * changes/dead-code-detection, "Java type hierarchy edges"). Source may wrap a
 * qualified name across lines or put a comment between its parts
 * (`com.acme\n    .Loan`, `com.acme /* old *\/ .Loan`). The fact graph
 * compares names as strings, so that spelling must never reach the structure
 * result: a wrapped name would read as a different type from the same name
 * written on one line.
 */

const COMMENT_NODES = new Set(["line_comment", "block_comment"]);

/** Tokens kept whole: their text is a value, not part of a name. */
const ATOMIC_NODES = new Set(["string_literal", "character_literal"]);

/** Whitespace next to a `.`, or something that may open a comment. */
const NEEDS_REBUILD = /\s\.|\.\s|\/[/*]/;

/**
 * A type, or any construct naming one, as written but without comments and
 * without whitespace next to a `.`, so a qualified name wrapped across lines
 * reads as if written on one line. Other whitespace is kept as written (a
 * comment between two tokens becomes one space), so text with neither a
 * comment nor a wrapped `.` is returned unchanged.
 */
export function typeText(node: TreeSitterNode): string {
  const text = node.text;
  if (!NEEDS_REBUILD.test(text)) return text;

  const base = node.startIndex;
  let out = "";
  let previousEnd = -1;
  let previousIsDot = false;
  let commentInGap = false;
  const visit = (current: TreeSitterNode) => {
    if (COMMENT_NODES.has(current.type)) {
      commentInGap = true;
      return;
    }
    if (current.childCount > 0 && !ATOMIC_NODES.has(current.type)) {
      for (let i = 0; i < current.childCount; i++) {
        const child = current.child(i);
        if (child) visit(child);
      }
      return;
    }
    const isDot = current.type === ".";
    if (previousEnd >= 0 && !previousIsDot && !isDot) {
      out += commentInGap ? " " : text.slice(previousEnd - base, current.startIndex - base);
    }
    out += current.text;
    previousEnd = current.endIndex;
    previousIsDot = isDot;
    commentInGap = false;
  };
  visit(node);
  return out;
}

/**
 * A dotted name (an `identifier` or `scoped_identifier`: a package, an import,
 * an annotation name) rebuilt from its identifier tokens.
 */
export function dottedName(node: TreeSitterNode): string {
  if (node.type !== "scoped_identifier") return node.type === "identifier" ? node.text : typeText(node);
  const scope = node.childForFieldName("scope");
  const name = node.childForFieldName("name");
  if (!scope || !name) return typeText(node);
  return `${dottedName(scope)}.${name.text}`;
}
