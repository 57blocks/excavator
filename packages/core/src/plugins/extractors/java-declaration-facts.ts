import type { JavaClassLiteral, JavaMethodModifier, JavaVisibility } from "../../types.js";
import type { TreeSitterNode } from "./types.js";
import { findChild } from "./base-extractor.js";

/**
 * Java declaration facts liveness analysis reads (openspec:
 * changes/dead-code-detection, design D8): a method's or constructor's
 * access, modifier keywords and annotations, and the class literals of a
 * file. None of them feeds node identity.
 */

const ACCESS_KEYWORDS = new Set<string>(["public", "protected", "private"]);

const TRACKED_MODIFIERS = new Set<string>([
  "static", "final", "native", "default", "synchronized", "abstract",
] satisfies JavaMethodModifier[]);

/** Annotation names on a declaration as written (`Entity`, `lombok.Builder`), in source order. */
export function extractAnnotationNames(node: TreeSitterNode): string[] {
  const modifiers = findChild(node, "modifiers");
  if (!modifiers) return [];
  const names: string[] = [];
  for (let i = 0; i < modifiers.childCount; i++) {
    const child = modifiers.child(i);
    if (!child || (child.type !== "marker_annotation" && child.type !== "annotation")) continue;
    const nameNode = child.childForFieldName("name");
    if (nameNode) names.push(nameNode.text);
  }
  return names;
}

function simpleName(qualified: string): string {
  return qualified.slice(qualified.lastIndexOf(".") + 1).trim();
}

export interface MemberDeclarationFacts {
  visibility: JavaVisibility;
  modifiers: JavaMethodModifier[];
  annotations: string[];
}

/**
 * Access, modifier keywords and annotation simple names of a method or
 * constructor. `defaultAccess` is what the member has when it states no
 * access keyword: `public` in an interface, `private` for an enum
 * constructor, `package` otherwise.
 */
export function memberDeclarationFacts(
  node: TreeSitterNode,
  defaultAccess: JavaVisibility,
): MemberDeclarationFacts {
  let visibility: JavaVisibility | null = null;
  const modifiers: JavaMethodModifier[] = [];
  const modifiersNode = findChild(node, "modifiers");
  for (let i = 0; i < (modifiersNode?.childCount ?? 0); i++) {
    const child = modifiersNode!.child(i);
    if (!child) continue;
    if (ACCESS_KEYWORDS.has(child.type)) visibility = child.type as JavaVisibility;
    else if (TRACKED_MODIFIERS.has(child.type)) modifiers.push(child.type as JavaMethodModifier);
  }
  return {
    visibility: visibility ?? defaultAccess,
    modifiers,
    annotations: extractAnnotationNames(node).map(simpleName),
  };
}

const COMMENT_NODES = new Set(["line_comment", "block_comment"]);

/** The type of a class literal as written before `.class`. */
function classLiteralType(literal: TreeSitterNode): string {
  for (let i = 0; i < literal.namedChildCount; i++) {
    const child = literal.namedChild(i);
    if (child && !COMMENT_NODES.has(child.type)) return child.text;
  }
  return literal.text.replace(/\s*\.\s*class$/, "");
}

/**
 * Every `X.class` in a file, in source order. A literal is in `annotation`
 * context when it lies inside an annotation's argument list (nested arrays
 * and annotations included) or in an annotation element's default value,
 * which is the argument a use of that annotation gets when it states none.
 * Everywhere else it is `code`.
 */
export function extractClassLiterals(root: TreeSitterNode): JavaClassLiteral[] {
  const literals = root.descendantsOfType("class_literal");
  if (literals.length === 0) return [];

  // Both lists are in document order; nested argument lists lie inside their
  // outer list, so a literal is inside one exactly when the furthest end of
  // the lists opened before it is past it.
  const annotationSpans = root.descendantsOfType(["annotation_argument_list", "annotation_type_element_declaration"]);
  const result: JavaClassLiteral[] = [];
  let span = 0;
  let coveredUntil = -1;
  for (const literal of literals) {
    if (!literal) continue;
    const at = literal.startIndex;
    while (span < annotationSpans.length && annotationSpans[span]!.startIndex <= at) {
      coveredUntil = Math.max(coveredUntil, annotationSpans[span]!.endIndex);
      span++;
    }
    result.push({
      type: classLiteralType(literal),
      line: literal.startPosition.row + 1,
      context: at < coveredUntil ? "annotation" : "code",
    });
  }
  return result;
}
