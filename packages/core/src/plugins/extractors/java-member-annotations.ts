import type { JavaMemberAnnotationUse } from "../../types.js";
import type { TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";
import { extractModifierAnnotations } from "./java-annotation-arguments.js";
import { declaratorType } from "./java-names.js";

/**
 * The annotations on the members of every type body in a Java file (openspec:
 * changes/annotation-injection-references, design D1). A container injects
 * into a field, a setter or constructor, one of their parameters, or a record
 * component, so those are the positions read; the type's own annotations are
 * `classes[].annotationArguments`, and a local variable, a lambda or catch
 * parameter, a receiver parameter, an enum constant or a type-use annotation
 * is not something a container can inject into.
 *
 * A record's `member` also states its declared `type` where the member has one
 * (openspec: changes/by-type-injection, design D3): a field's type with the
 * dimensions written on its declarator, a method's return type. A constructor
 * has none, and nor does a record, the member of its components' annotations;
 * a parameter's annotation shares the member, so the type, of its method.
 *
 * Types are walked at any depth - nested, local, anonymous, enum constant
 * bodies - because the graph has one node per top-level type: `owner` is that
 * type's simple name and `nested` says the member's declaring type is not it.
 */

const TYPE_DECLARATIONS = new Set([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "annotation_type_declaration",
]);

/**
 * Everything the walk needs to see, in document order. The syntax tree is not
 * walked node by node: one native pass collects these, which costs a fraction
 * of a walk over every expression of a large file.
 */
const WALKED_NODES = [
  ...TYPE_DECLARATIONS,
  // The body of `new X() { ... }` and of an enum constant; the other class
  // bodies belong to a type declaration that is in the list.
  "class_body",
  "field_declaration",
  "constant_declaration",
  "method_declaration",
  "constructor_declaration",
  "compact_constructor_declaration",
];

type Attachment = Pick<JavaMemberAnnotationUse, "on" | "member" | "parameter">;

interface Scope {
  owner: string;
  nested: boolean;
}

type Member = JavaMemberAnnotationUse["member"];

function nameAt(node: TreeSitterNode): { name: string; line: number } {
  return { name: node.text, line: node.startPosition.row + 1 };
}

export function extractMemberAnnotations(root: TreeSitterNode): JavaMemberAnnotationUse[] {
  const records: JavaMemberAnnotationUse[] = [];

  const record = (modifiers: TreeSitterNode | null, scope: Scope, attachments: Attachment[]) => {
    // Annotation by annotation, so one annotation's records stay together and
    // the annotation lines never run backwards.
    for (const use of extractModifierAnnotations(modifiers)) {
      for (const { on, member, parameter } of attachments) {
        records.push({
          name: use.name,
          line: use.line,
          // Each record owns its objects; a method's parameters share `member`.
          arguments: use.arguments.map(({ classLiterals, ...argument }) => ({
            ...argument,
            ...(classLiterals ? { classLiterals: classLiterals.map((literal) => ({ ...literal })) } : {}),
          })),
          on,
          owner: scope.owner,
          nested: scope.nested,
          member: { ...member },
          ...(parameter ? { parameter: { ...parameter } } : {}),
        });
      }
    }
  };

  // `field_declaration` and an interface's `constant_declaration`: one
  // attachment per declarator.
  const recordField = (node: TreeSitterNode, scope: Scope) => {
    const attachments: Attachment[] = [];
    const typeNode = node.childForFieldName("type");
    for (const declarator of findChildren(node, "variable_declarator")) {
      const nameNode = declarator.childForFieldName("name");
      if (nameNode) {
        attachments.push({
          on: "field",
          member: { ...nameAt(nameNode), ...(typeNode ? { type: declaratorType(typeNode, declarator) } : {}) },
        });
      }
    }
    record(findChild(node, "modifiers"), scope, attachments);
  };

  // The parameters of a method or constructor, or the components of a record.
  // A receiver parameter is neither written by callers nor counted.
  const recordParameters = (
    parameters: TreeSitterNode | null,
    on: "parameter" | "component",
    member: Member,
    scope: Scope,
  ) => {
    if (!parameters) return;
    let index = 0;
    for (let i = 0; i < parameters.childCount; i++) {
      const parameter = parameters.child(i);
      if (!parameter || (parameter.type !== "formal_parameter" && parameter.type !== "spread_parameter")) continue;
      // A varargs parameter's name sits in a declarator, after the `...`.
      const nameNode = parameter.type === "spread_parameter"
        ? findChild(parameter, "variable_declarator")?.childForFieldName("name")
        : parameter.childForFieldName("name");
      if (nameNode) {
        const { name, line } = nameAt(nameNode);
        record(findChild(parameter, "modifiers"), scope, [{ on, member, parameter: { name, index, line } }]);
      }
      index++;
    }
  };

  const recordCallable = (node: TreeSitterNode, on: "method" | "constructor", scope: Scope) => {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    // A method states its return type; a constructor has none.
    const returnType = on === "method" ? node.childForFieldName("type") : null;
    const member: Member = {
      ...nameAt(nameNode),
      ...(returnType ? { type: declaratorType(returnType, node) } : {}),
    };
    record(findChild(node, "modifiers"), scope, [{ on, member }]);
    recordParameters(node.childForFieldName("parameters"), "parameter", member, scope);
  };

  // The types and anonymous bodies the node being read is inside, innermost
  // last, each with the offset where it ends.
  const enclosing: Array<{ end: number; scope: Scope }> = [];

  for (const node of root.descendantsOfType(WALKED_NODES)) {
    while (enclosing.length > 0 && enclosing[enclosing.length - 1]!.end <= node.startIndex) enclosing.pop();
    const current = enclosing.length > 0 ? enclosing[enclosing.length - 1]!.scope : null;

    if (TYPE_DECLARATIONS.has(node.type)) {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) continue;
      // Outermost: the top-level type, which is its own owner. Anything else
      // is nested, local or a member type, owned by the top-level type.
      const scope = current ? { owner: current.owner, nested: true } : { owner: nameNode.text, nested: false };
      enclosing.push({ end: node.endIndex, scope });
      if (node.type === "record_declaration") {
        recordParameters(node.childForFieldName("parameters"), "component", nameAt(nameNode), scope);
      }
      continue;
    }

    // A member outside every type, which only a syntax error produces, has no owner.
    if (!current) continue;

    switch (node.type) {
      case "class_body": {
        const opener = node.parent?.type;
        if (opener === "object_creation_expression" || opener === "enum_constant") {
          enclosing.push({ end: node.endIndex, scope: { owner: current.owner, nested: true } });
        }
        break;
      }
      case "field_declaration":
      case "constant_declaration":
        recordField(node, current);
        break;
      case "method_declaration":
        recordCallable(node, "method", current);
        break;
      case "constructor_declaration":
      case "compact_constructor_declaration":
        recordCallable(node, "constructor", current);
        break;
    }
  }

  return records;
}
