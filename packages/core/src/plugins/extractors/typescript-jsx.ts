import type { JsxFacts } from "../../types.js";
import type { TreeSitterNode } from "./types.js";

/** Nodes that open a function scope: their parameters and body bindings can
 *  shadow an imported or top-level name. */
const FUNCTION_SCOPES = [
  "function_declaration",
  "generator_function_declaration",
  "function_expression",
  "function",
  "generator_function",
  "arrow_function",
  "method_definition",
];
export const FUNCTION_SCOPE_SET = new Set(FUNCTION_SCOPES);

/** Opening and self-closing tags. Closing tags repeat the opening tag's name
 *  and are not counted. */
const ELEMENT_TAGS = ["jsx_opening_element", "jsx_self_closing_element"];

/** Declarations whose own name is bound in the enclosing function. */
const NAMED_DECLARATIONS = new Set([
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "abstract_class_declaration",
]);

/**
 * React's rule: a tag that is a plain lowercase identifier, contains `-`, or
 * has a namespace (`svg:rect`) is a host element, rendered by name, and
 * refers to no code. A member expression (`motion.div`) never is.
 */
export function isIntrinsicJsxName(name: string): boolean {
  if (name.includes(".")) return false;
  return /^[a-z]/.test(name) || name.includes("-") || name.includes(":");
}

/**
 * Every JSX element whose tag can name code, in source order, and the count
 * of intrinsic elements. Fragments (`<>`) have no name and are skipped.
 * `local` marks an element whose root name is bound by an enclosing function:
 * a parameter, a destructured name, a local variable, function or class, a
 * `catch` parameter or a `for...in/of` variable. Block-scoped names count for
 * the whole function, so the marking errs toward `local`: a marked element
 * becomes a visible gap, an unmarked shadowed one would become a wrong edge.
 * `syntaxError` marks a tag the grammar recovered from an error (the
 * javascript grammar reads `<this.Foo/>` as `<Foo/>`): its name is not what
 * the source says. Returns `undefined` when the file has no JSX element.
 */
export function extractJsxFacts(root: TreeSitterNode): JsxFacts | undefined {
  const elements: JsxFacts["elements"] = [];
  let intrinsic = 0;
  const enclosing: Array<{ end: number; node: TreeSitterNode; names?: Set<string> }> = [];

  for (const node of root.descendantsOfType([...FUNCTION_SCOPES, ...ELEMENT_TAGS])) {
    while (enclosing.length > 0 && enclosing[enclosing.length - 1]!.end <= node.startIndex) enclosing.pop();
    if (FUNCTION_SCOPE_SET.has(node.type)) {
      enclosing.push({ end: node.endIndex, node });
      continue;
    }
    const nameNode = node.childForFieldName("name");
    if (!nameNode) continue;
    const name = nameNode.text.replace(/\s+/g, "");
    if (!node.hasError && isIntrinsicJsxName(name)) {
      intrinsic += 1;
      continue;
    }
    const rootName = name.split(".")[0]!;
    const local = enclosing.some((scope) => {
      scope.names ??= boundNames(scope.node);
      return scope.names.has(rootName);
    });
    elements.push({
      name,
      lineNumber: node.startPosition.row + 1,
      ...(local ? { local: true as const } : {}),
      ...(node.hasError ? { syntaxError: true as const } : {}),
    });
  }

  if (elements.length === 0 && intrinsic === 0) return undefined;
  return { elements, intrinsic };
}

/** The names a function binds: its parameters and the declarations in its
 *  body, not descending into nested functions (whose own names do count).
 *  Call sites use it too, to mark a callee an enclosing function binds. */
export function boundNames(scope: TreeSitterNode): Set<string> {
  const names = new Set<string>();
  const params = scope.childForFieldName("parameters") ?? scope.childForFieldName("parameter");
  if (params) collectPattern(params, names);
  const body = scope.childForFieldName("body");
  if (body) collectBody(body, names);
  return names;
}

function collectBody(node: TreeSitterNode, names: Set<string>): void {
  for (const child of node.namedChildren) {
    if (!child) continue;
    if (NAMED_DECLARATIONS.has(child.type)) {
      const name = child.childForFieldName("name");
      if (name) names.add(name.text);
    }
    if (FUNCTION_SCOPE_SET.has(child.type)) continue;
    switch (child.type) {
      case "variable_declarator": {
        const name = child.childForFieldName("name");
        if (name) collectPattern(name, names);
        break;
      }
      case "catch_clause": {
        const param = child.childForFieldName("parameter");
        if (param) collectPattern(param, names);
        break;
      }
      case "for_in_statement": {
        const left = child.childForFieldName("left");
        if (left) collectPattern(left, names);
        break;
      }
    }
    collectBody(child, names);
  }
}

/** The identifiers a binding pattern introduces. Default values, object keys
 *  and type annotations bind nothing; an unrecognised shape contributes every
 *  identifier in it, erring toward `local`. */
function collectPattern(node: TreeSitterNode, names: Set<string>): void {
  switch (node.type) {
    case "identifier":
    case "shorthand_property_identifier_pattern":
      names.add(node.text);
      return;
    case "pair_pattern": {
      const value = node.childForFieldName("value");
      if (value) collectPattern(value, names);
      return;
    }
    case "assignment_pattern":
    case "object_assignment_pattern": {
      const left = node.childForFieldName("left");
      if (left) collectPattern(left, names);
      return;
    }
    case "required_parameter":
    case "optional_parameter": {
      const pattern = node.childForFieldName("pattern");
      if (pattern) collectPattern(pattern, names);
      return;
    }
    case "formal_parameters":
    case "object_pattern":
    case "array_pattern":
    case "rest_pattern":
      for (const child of node.namedChildren) if (child) collectPattern(child, names);
      return;
    case "this":
    case "comment":
    case "type_annotation":
      return;
    default:
      for (const ident of node.descendantsOfType("identifier")) if (ident) names.add(ident.text);
  }
}
