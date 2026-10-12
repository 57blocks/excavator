import type { TreeSitterNode } from "./types.js";
import { findChild } from "./base-extractor.js";

/**
 * Callers of Java call sites outside every method and constructor body
 * (openspec: changes/dead-code-detection, "Java call sites outside method and
 * constructor bodies"). Such a site belongs to no declaration, so its caller
 * is a sentinel no Java identifier can spell: it never matches a declaration
 * and the fact graph files the site under `calls-caller-unresolved`.
 */

/** Static context: class initialization. */
export const STATIC_INITIALIZER_CALLER = "<clinit>";
/** Instance context: object initialization. */
export const INSTANCE_INITIALIZER_CALLER = "<init>";

/** Bodies whose fields are implicitly static. */
const STATIC_FIELD_BODIES = new Set(["interface_body", "annotation_type_body"]);

/** Bodies whose direct `block` children are instance initializers. */
const MEMBER_BODIES = new Set(["class_body", "enum_body_declarations"]);

function hasStaticModifier(node: TreeSitterNode): boolean {
  const modifiers = findChild(node, "modifiers");
  if (!modifiers) return false;
  for (let i = 0; i < modifiers.childCount; i++) {
    if (modifiers.child(i)?.type === "static") return true;
  }
  return false;
}

/**
 * The sentinel caller for sites inside `node` when no method or constructor
 * body encloses them, or null when `node` does not open an initializer:
 * - `<clinit>`: a `static` field, any field of an interface or annotation
 *   type, a `static` initializer block, an enum constant's arguments;
 * - `<init>`: any other field, an instance initializer block, a record
 *   compact constructor body.
 * Fields and initializer blocks of nested, anonymous and local types follow
 * the same rules. An enum constant's body opens nothing itself: its fields
 * and blocks are classified on their own.
 */
export function initializerCaller(node: TreeSitterNode, parentType: string | null): string | null {
  switch (node.type) {
    case "field_declaration":
      return hasStaticModifier(node) || (parentType !== null && STATIC_FIELD_BODIES.has(parentType))
        ? STATIC_INITIALIZER_CALLER
        : INSTANCE_INITIALIZER_CALLER;
    case "constant_declaration":
    case "static_initializer":
    case "enum_constant":
      return STATIC_INITIALIZER_CALLER;
    case "compact_constructor_declaration":
      return INSTANCE_INITIALIZER_CALLER;
    case "block":
      return parentType !== null && MEMBER_BODIES.has(parentType) ? INSTANCE_INITIALIZER_CALLER : null;
    default:
      return null;
  }
}
