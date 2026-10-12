import type { CallReceiver } from "../../types.js";
import type { TreeSitterNode } from "./types.js";
import { typeText } from "./java-names.js";

/**
 * Method references as call sites (openspec: changes/dead-code-detection,
 * design D8). `X::m`, `expr::m`, `this::m` and `super::m` call `m`; `X::new`
 * constructs `X`. The receiver is described as an ordinary call of the same
 * shape would describe it (java-member-call-resolution, D2); the argument
 * count is not written at the reference, so the site records none.
 */

/** Qualifiers tree-sitter parses as a type rather than an expression. */
const TYPE_QUALIFIERS = new Set(["type_identifier", "scoped_type_identifier", "generic_type", "annotated_type"]);

const UNKNOWN: CallReceiver = Object.freeze({ kind: "unknown" }) as CallReceiver;

export interface MethodReferenceSite {
  callee: string;
  receiver: CallReceiver;
}

export interface MethodReferenceContext {
  /** Describe an expression receiver exactly as for `expr.m()`. */
  describe(node: TreeSitterNode): CallReceiver;
  /** A type as written, or null when it names a local class (or is `var`). */
  declared(typeText: string): string | null;
}

/** `X.super` (an interface's default method or an outer class's super). */
function isQualifiedSuper(qualifier: TreeSitterNode): boolean {
  if (qualifier.type !== "scoped_type_identifier") return false;
  const last = qualifier.namedChild(qualifier.namedChildCount - 1);
  return last?.text === "super";
}

/**
 * The call site a `method_reference` node stands for, or null when the node
 * is malformed.
 */
export function methodReferenceSite(node: TreeSitterNode, context: MethodReferenceContext): MethodReferenceSite | null {
  const qualifier = node.namedChild(0);
  const last = node.child(node.childCount - 1);
  if (!qualifier || !last || qualifier.startIndex === last.startIndex) return null;

  // A qualifier wrapped across lines reads as one line (java-names).
  const qualifierText = typeText(qualifier);
  if (last.type === "new") {
    const callee = `new ${qualifierText}`;
    // An array constructor: the array type is the whole story, whatever its
    // element type names.
    if (qualifier.type === "array_type") return { callee, receiver: { kind: "construct", type: qualifierText } };
    const type = context.declared(qualifierText);
    return { callee, receiver: type === null ? UNKNOWN : { kind: "construct", type } };
  }

  if (last.type !== "identifier") return null;
  const callee = last.text;
  if (qualifier.type === "array_type") return { callee, receiver: { kind: "type", type: qualifierText } };
  if (TYPE_QUALIFIERS.has(qualifier.type)) {
    if (isQualifiedSuper(qualifier)) return { callee, receiver: UNKNOWN };
    const type = context.declared(qualifierText);
    return { callee, receiver: type === null ? UNKNOWN : { kind: "type", type } };
  }
  return { callee, receiver: context.describe(qualifier) };
}
