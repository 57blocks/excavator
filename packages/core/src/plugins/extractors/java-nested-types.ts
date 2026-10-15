import type { JavaNestedType, JavaSupertype } from "../../types.js";
import type { TreeSitterNode } from "./types.js";
import { findChild } from "./base-extractor.js";
import { typeText } from "./java-names.js";

/**
 * The type modifiers of a Java type declaration and every type declared below
 * top level (openspec: changes/by-type-injection, design D3). The graph has one
 * node per top-level type, so a consumer that asks which classes can be
 * instantiated or extended must see the types a top-level type hides: member,
 * local and anonymous ones, at any depth, and the types nested in them.
 */

/** The keywords a type declaration can carry, as the grammar spells them. */
const TYPE_MODIFIER_KEYWORDS = new Set([
  "public", "protected", "private", "abstract", "static", "final", "sealed", "non-sealed", "strictfp",
]);

/** The modifier keywords of a type declaration in source order. Annotations
 *  and comments between them are not keywords and are left out. */
export function typeModifierKeywords(node: TreeSitterNode): string[] {
  const modifiers = findChild(node, "modifiers");
  const keywords: string[] = [];
  for (let i = 0; i < (modifiers?.childCount ?? 0); i++) {
    const child = modifiers!.child(i);
    if (child && TYPE_MODIFIER_KEYWORDS.has(child.type)) keywords.push(child.type);
  }
  return keywords;
}

const TYPE_KINDS: Record<string, Exclude<JavaNestedType["kind"], "anonymous">> = {
  class_declaration: "class",
  interface_declaration: "interface",
  enum_declaration: "enum",
  record_declaration: "record",
  annotation_type_declaration: "annotation",
};

/** A type declared directly in one of these bodies is a member type; declared
 *  anywhere else (a block, a switch group, a lambda body) it is a local one. */
const MEMBER_BODIES = new Set(["class_body", "interface_body", "enum_body_declarations", "annotation_type_body"]);

/**
 * Everything the walk needs to see, in document order, collected in one native
 * pass instead of a walk over every expression. `class_body` is here for the
 * body of `new X() { ... }` and of an enum constant, which open a scope but
 * are not type declarations.
 */
const WALKED_NODES = [...Object.keys(TYPE_KINDS), "object_creation_expression", "class_body"];

/** A type or anonymous body the node being read is inside. */
interface Enclosing {
  /** Offset where it ends. */
  end: number;
  owner: string;
  /** Anything written inside it is local: it is an anonymous or enum constant
   *  body, or a local type, or sits inside one. */
  local: boolean;
}

/**
 * Every type declaration below top level and every anonymous class body, in
 * source order. An enum constant body (`A { ... }`) is a scope but is not
 * recorded itself: the enum is not instantiable, so the body is no candidate.
 * `local` is lexical: a type is local when it is not reachable from its
 * top-level type through member types alone, so a member of a local or
 * anonymous class is local too. `supertypesOf` reads a declaration's
 * `extends` and `implements` clauses.
 */
export function extractNestedTypes(
  root: TreeSitterNode,
  supertypesOf: (declaration: TreeSitterNode) => JavaSupertype[],
): JavaNestedType[] {
  const result: JavaNestedType[] = [];
  const enclosing: Enclosing[] = [];

  for (const node of root.descendantsOfType(WALKED_NODES)) {
    while (enclosing.length > 0 && enclosing[enclosing.length - 1]!.end <= node.startIndex) enclosing.pop();
    const current = enclosing.length > 0 ? enclosing[enclosing.length - 1]! : null;

    const kind = TYPE_KINDS[node.type];
    if (kind) {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) continue;
      if (!current) {
        // Outermost: a top-level type, which is its own owner.
        enclosing.push({ end: node.endIndex, owner: nameNode.text, local: false });
        continue;
      }
      const local = current.local || !MEMBER_BODIES.has(node.parent?.type ?? "");
      enclosing.push({ end: node.endIndex, owner: current.owner, local });
      result.push({
        kind,
        name: nameNode.text,
        line: nameNode.startPosition.row + 1,
        owner: current.owner,
        local,
        modifiers: typeModifierKeywords(node),
        supertypes: supertypesOf(node),
      });
      continue;
    }

    // An anonymous body outside every type, which only a syntax error
    // produces, has no owner.
    if (!current) continue;

    if (node.type === "object_creation_expression") {
      const body = findChild(node, "class_body");
      const typeNode = node.childForFieldName("type");
      if (!body || !typeNode) continue;
      // `outer.new Inner() { ... }` starts at `outer`; the line is `new`'s.
      const newToken = findChild(node, "new") ?? node;
      result.push({
        kind: "anonymous",
        name: null,
        line: newToken.startPosition.row + 1,
        owner: current.owner,
        local: true,
        modifiers: [],
        supertypes: [],
        instantiates: { type: typeText(typeNode), line: typeNode.startPosition.row + 1 },
      });
    } else if (node.type === "class_body") {
      // The body scopes what is written in it, not the arguments before it.
      const opener = node.parent?.type;
      if (opener === "object_creation_expression" || opener === "enum_constant") {
        enclosing.push({ end: node.endIndex, owner: current.owner, local: true });
      }
    }
  }

  return result;
}
