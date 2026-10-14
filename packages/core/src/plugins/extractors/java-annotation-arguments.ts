import type { JavaAnnotationClassLiteral, JavaAnnotationUse } from "../../types.js";
import type { TreeSitterNode } from "./types.js";
import { findChild } from "./base-extractor.js";
import { classLiteralType } from "./java-declaration-facts.js";
import { dottedName } from "./java-names.js";

/**
 * The annotations of a Java type declaration with their arguments (openspec:
 * changes/name-binding-references, design D2). A framework that names a bean
 * with `@Named("orders")` is only readable if the argument is: `annotations`
 * keeps the bare names for every consumer that predates this.
 *
 * An argument's value is the string a single string literal writes, escape
 * sequences decoded. Every other way of writing one - a constant, a
 * concatenation, an array, a class literal, a nested annotation, a text block
 * - is `null`: the value exists but is not a string this extractor can read,
 * and a consumer must be able to tell that from an argument that is absent.
 *
 * An argument that is a class literal, or an array initializer holding some,
 * also lists them in `classLiterals` (openspec: changes/by-type-injection,
 * design D3), each with the type as written and the line it starts on; `value`
 * stays `null`. Only the literals the value itself writes are listed: not
 * those of a nested annotation, and not the other elements of a mixed array.
 * An argument with no class literal has no `classLiterals`.
 *
 * The same reading serves the annotations on a type's members (openspec:
 * changes/annotation-injection-references, design D1), where each argument
 * also states the line its value starts on; a type's own `annotationArguments`
 * keeps the shape without it.
 */

const COMMENT_NODES = new Set(["line_comment", "block_comment"]);

const SIMPLE_ESCAPES: Record<string, string> = {
  b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", s: " ", '"': '"', "'": "'", "\\": "\\",
};

/** The character an escape sequence stands for, or null when it is not one this decoder knows. */
function decodeEscape(escape: string): string | null {
  const body = escape.slice(1);
  if (body in SIMPLE_ESCAPES) return SIMPLE_ESCAPES[body]!;
  const unicode = /^u+([0-9A-Fa-f]{4})$/.exec(body);
  if (unicode) return String.fromCharCode(parseInt(unicode[1]!, 16));
  if (/^[0-3]?[0-7]{1,2}$/.test(body)) return String.fromCharCode(parseInt(body, 8));
  return null;
}

/** The value of a string literal node, or null for a text block or an undecodable escape. */
function stringLiteralValue(literal: TreeSitterNode): string | null {
  let value = "";
  for (let i = 0; i < literal.childCount; i++) {
    const part = literal.child(i);
    if (!part) continue;
    if (part.type === "string_fragment") {
      value += part.text;
    } else if (part.type === "escape_sequence") {
      const decoded = decodeEscape(part.text);
      if (decoded === null) return null;
      value += decoded;
    } else if (part.type === "multiline_string_fragment") {
      return null;
    }
  }
  return value;
}

/** The value of an annotation argument expression: a string literal's text, else null. */
function argumentValue(expression: TreeSitterNode | null): string | null {
  return expression?.type === "string_literal" ? stringLiteralValue(expression) : null;
}

/** The class literals an argument's value writes: the value itself, or the
 *  elements of an array initializer that are class literals, in source order. */
function argumentClassLiterals(expression: TreeSitterNode | null): JavaAnnotationClassLiteral[] {
  if (!expression) return [];
  const elements: TreeSitterNode[] = [];
  if (expression.type === "element_value_array_initializer") {
    for (let i = 0; i < expression.namedChildCount; i++) {
      const element = expression.namedChild(i);
      if (element) elements.push(element);
    }
  } else {
    elements.push(expression);
  }
  return elements
    .filter((element) => element.type === "class_literal")
    .map((literal) => ({ type: classLiteralType(literal), line: literal.startPosition.row + 1 }));
}

/** One annotation as written: its arguments carry the line each value starts on. */
export interface AnnotationNodeUse {
  name: string;
  line: number;
  arguments: Array<{
    key: string;
    value: string | null;
    line: number;
    classLiterals?: JavaAnnotationClassLiteral[];
  }>;
}

/**
 * Every annotation in a `modifiers` node, in source order: `name` as written,
 * the line the annotation starts on, and its arguments (`[]` for no
 * parentheses or empty ones). A lone unnamed argument is the annotation's
 * `value`. Each argument also states the line its value starts on, which is
 * not the annotation's line when the annotation spans several.
 */
export function extractModifierAnnotations(modifiers: TreeSitterNode | null): AnnotationNodeUse[] {
  if (!modifiers) return [];
  const uses: AnnotationNodeUse[] = [];
  for (let i = 0; i < modifiers.childCount; i++) {
    const annotation = modifiers.child(i);
    if (!annotation || (annotation.type !== "marker_annotation" && annotation.type !== "annotation")) continue;
    const nameNode = annotation.childForFieldName("name");
    if (!nameNode) continue;

    const args: AnnotationNodeUse["arguments"] = [];
    const list = annotation.childForFieldName("arguments");
    for (let j = 0; j < (list?.namedChildCount ?? 0); j++) {
      const item = list!.namedChild(j);
      if (!item || COMMENT_NODES.has(item.type)) continue;
      if (item.type === "element_value_pair") {
        const value = item.childForFieldName("value");
        const classLiterals = argumentClassLiterals(value);
        args.push({
          key: item.childForFieldName("key")?.text ?? "",
          value: argumentValue(value),
          line: (value ?? item).startPosition.row + 1,
          ...(classLiterals.length > 0 ? { classLiterals } : {}),
        });
      } else {
        const classLiterals = argumentClassLiterals(item);
        args.push({
          key: "value",
          value: argumentValue(item),
          line: item.startPosition.row + 1,
          ...(classLiterals.length > 0 ? { classLiterals } : {}),
        });
      }
    }
    uses.push({ name: dottedName(nameNode), line: annotation.startPosition.row + 1, arguments: args });
  }
  return uses;
}

/**
 * Every annotation on a type declaration, in source order, without the
 * per-argument lines: the shape `classes[].annotationArguments` has had since
 * openspec changes/name-binding-references.
 */
export function extractAnnotationUses(node: TreeSitterNode): JavaAnnotationUse[] {
  return extractModifierAnnotations(findChild(node, "modifiers")).map((use) => ({
    name: use.name,
    line: use.line,
    arguments: use.arguments.map(({ key, value, classLiterals }) => ({
      key,
      value,
      ...(classLiterals ? { classLiterals } : {}),
    })),
  }));
}
