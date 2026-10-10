import type {
  StructuralAnalysis,
  CallGraphEntry,
  CallReceiver,
  JavaFieldType,
  JavaSupertype,
  JavaTypeParameter,
} from "../../types.js";
import type { LanguageExtractor, TreeSitterNode } from "./types.js";
import { findChild, findChildren } from "./base-extractor.js";

/**
 * Extract parameter names from a Java `formal_parameters` node.
 *
 * Each `formal_parameter` child has a `name` field (identifier) and a `type` field.
 */
function extractParams(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const params: string[] = [];

  const declarations = findChildren(paramsNode, "formal_parameter");
  for (const decl of declarations) {
    const nameNode = decl.childForFieldName("name");
    if (nameNode) {
      params.push(nameNode.text);
    }
  }

  // Also handle spread_parameter (varargs): e.g. `String... args`
  const spreadParams = findChildren(paramsNode, "spread_parameter");
  for (const spread of spreadParams) {
    const nameNode = spread.childForFieldName("name");
    if (nameNode) {
      params.push(nameNode.text);
    }
  }

  return params;
}

const NON_TYPE_CHILDREN = new Set(["modifiers", "variable_declarator", "annotation", "marker_annotation"]);

/**
 * Extract parameter types from a Java `formal_parameters` node, in declaration
 * order. Java overloads are told apart by parameter types, not names, so these
 * feed node identity. Array dimensions written after the name (`int x[]`) are
 * appended to the type, varargs end in `...`, and modifiers and annotations
 * are not part of the type. A receiver parameter (`Foo this`) is skipped.
 */
function extractParamTypes(paramsNode: TreeSitterNode | null): string[] {
  if (!paramsNode) return [];
  const types: string[] = [];

  for (let i = 0; i < paramsNode.childCount; i++) {
    const child = paramsNode.child(i);
    if (!child) continue;

    if (child.type === "formal_parameter") {
      const typeNode = child.childForFieldName("type");
      if (!typeNode) continue;
      const dimensions = child.childForFieldName("dimensions");
      types.push(`${typeNode.text}${dimensions ? dimensions.text : ""}`);
    } else if (child.type === "spread_parameter") {
      for (let j = 0; j < child.childCount; j++) {
        const part = child.child(j);
        if (part && part.isNamed && !NON_TYPE_CHILDREN.has(part.type)) {
          types.push(`${part.text}...`);
          break;
        }
      }
    }
  }

  return types;
}

/**
 * Map a method's or constructor's own type variables to what they erase to:
 * the first bound, or `Object`. Java tells generic overloads apart by their
 * erased parameter types (`<T> f(T)` vs `<T extends Sink> f(T)`), so the
 * variable names alone would collapse them.
 */
function typeVariableErasures(node: TreeSitterNode): Map<string, string> {
  const erasures = new Map<string, string>();
  const typeParameters = node.childForFieldName("type_parameters");
  if (!typeParameters) return erasures;

  for (let i = 0; i < typeParameters.childCount; i++) {
    const parameter = typeParameters.child(i);
    if (!parameter || parameter.type !== "type_parameter") continue;
    let name: string | null = null;
    let bound = "Object";
    for (let j = 0; j < parameter.childCount; j++) {
      const part = parameter.child(j);
      if (!part) continue;
      if (part.type === "type_identifier" && name === null) {
        name = part.text;
      } else if (part.type === "type_bound") {
        for (let k = 0; k < part.childCount; k++) {
          const boundType = part.child(k);
          if (boundType && boundType.isNamed) {
            bound = boundType.text;
            break;
          }
        }
      }
    }
    if (name !== null) erasures.set(name, bound);
  }

  return erasures;
}

/** Replace a method's own type variables in a parameter type with their erasure. */
function eraseTypeVariables(type: string, erasures: Map<string, string>): string {
  if (erasures.size === 0) return type;
  return type.replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, (word) => erasures.get(word) ?? word);
}

/**
 * The type variables a declaration introduces, each with its first bound or
 * `null`. Unlike {@link typeVariableErasures}, an unbounded variable stays
 * `null` here: the fact graph treats its type as unknown rather than `Object`.
 */
function extractTypeParameters(node: TreeSitterNode): JavaTypeParameter[] {
  const result: JavaTypeParameter[] = [];
  const typeParameters = node.childForFieldName("type_parameters")
    ?? findChild(node, "type_parameters");
  if (!typeParameters) return result;

  for (let i = 0; i < typeParameters.childCount; i++) {
    const parameter = typeParameters.child(i);
    if (!parameter || parameter.type !== "type_parameter") continue;
    let name: string | null = null;
    let bound: string | null = null;
    for (let j = 0; j < parameter.childCount; j++) {
      const part = parameter.child(j);
      if (!part) continue;
      if (part.type === "type_identifier" && name === null) {
        name = part.text;
      } else if (part.type === "type_bound") {
        for (let k = 0; k < part.childCount; k++) {
          const boundType = part.child(k);
          if (boundType && boundType.isNamed) {
            bound = boundType.text;
            break;
          }
        }
      }
    }
    if (name !== null) result.push({ name, bound });
  }

  return result;
}

const TYPE_DECLARATIONS = new Set([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "annotation_type_declaration",
]);

/** Type annotation names (`Entity`, `lombok.Builder`), in source order. */
function extractAnnotationNames(node: TreeSitterNode): string[] {
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

/** Each type named in a `type_list` node, with the line it is written on. */
function typeListEntries(
  typeList: TreeSitterNode | null,
  relation: JavaSupertype["relation"],
): JavaSupertype[] {
  if (!typeList) return [];
  const entries: JavaSupertype[] = [];
  for (let i = 0; i < typeList.childCount; i++) {
    const type = typeList.child(i);
    if (type && type.isNamed) {
      entries.push({ relation, type: type.text, line: type.startPosition.row + 1 });
    }
  }
  return entries;
}

/**
 * The supertypes a type declaration names: a class's `extends` and
 * `implements`, an interface's `extends`, an enum's or record's `implements`.
 */
function extractSupertypes(node: TreeSitterNode): JavaSupertype[] {
  const supertypes: JavaSupertype[] = [];
  const superclass = node.childForFieldName("superclass");
  if (superclass) {
    for (let i = 0; i < superclass.childCount; i++) {
      const type = superclass.child(i);
      if (type && type.isNamed) {
        supertypes.push({ relation: "extends", type: type.text, line: type.startPosition.row + 1 });
        break;
      }
    }
  }
  const interfaces = node.childForFieldName("interfaces");
  if (interfaces) {
    supertypes.push(...typeListEntries(findChild(interfaces, "type_list"), "implements"));
  }
  const extendsInterfaces = findChild(node, "extends_interfaces");
  if (extendsInterfaces) {
    supertypes.push(...typeListEntries(findChild(extendsInterfaces, "type_list"), "extends"));
  }
  return supertypes;
}

/** A field's declared type, with array dimensions written after the name. */
function declaratorType(typeNode: TreeSitterNode, declarator: TreeSitterNode): string {
  const dimensions = declarator.childForFieldName("dimensions");
  return `${typeNode.text}${dimensions ? dimensions.text : ""}`;
}

/** Facts gathered from one type body for the fact graph. */
interface TypeBodyFacts {
  fieldTypes: JavaFieldType[];
  memberTypes: string[];
}

/** Names a method body declares, innermost scope last. */
interface LocalScope {
  /** Variable name to declared type; `null` when the type is not stated. */
  vars: Map<string, string | null>;
  /** Local classes, which shadow any type of the same name. */
  types: Set<string>;
  /** Pattern variables bound in this scope by the statement being walked. */
  patterns: string[];
}

/** Nodes that open a scope for the names declared inside them. */
const SCOPE_NODES = new Set([
  "method_declaration",
  "constructor_declaration",
  "compact_constructor_declaration",
  "lambda_expression",
  "block",
  "constructor_body",
  "for_statement",
  "enhanced_for_statement",
  "catch_clause",
  "try_with_resources_statement",
  "switch_block_statement_group",
  "switch_rule",
  "class_body",
]);

/** Scopes whose children are statements: a pattern variable a statement
 *  declares stops being typed once that statement ends. */
const SETTLING_SCOPES = new Set(["block", "constructor_body", "switch_block_statement_group"]);

const UNKNOWN_RECEIVER: CallReceiver = Object.freeze({ kind: "unknown" }) as CallReceiver;

const COMMENT_NODES = new Set(["line_comment", "block_comment"]);

/** Arguments at a call or object creation site, comments excluded. */
function countArguments(node: TreeSitterNode): number {
  const args = node.childForFieldName("arguments");
  if (!args) return 0;
  let count = 0;
  for (let i = 0; i < args.childCount; i++) {
    const child = args.child(i);
    if (child && child.isNamed && !COMMENT_NODES.has(child.type)) count++;
  }
  return count;
}

/** The leading simple name of a type as written: `Map` for `Map.Entry<K, V>`. */
function baseTypeName(typeText: string): string {
  const withoutAnnotations = typeText.replace(/@[\w.]+(\([^)]*\))?\s*/g, "").trim();
  const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(withoutAnnotations);
  return match ? match[0] : withoutAnnotations;
}

/**
 * Extract the return type text from a method_declaration node.
 *
 * In tree-sitter-java, the return type is the `type` named field on method_declaration.
 * It can be a type_identifier, generic_type, void_type, integral_type, etc.
 */
function extractReturnType(node: TreeSitterNode): string | undefined {
  const typeNode = node.childForFieldName("type");
  if (!typeNode) return undefined;
  return typeNode.text;
}

/**
 * Check if a node has a `modifiers` child containing a specific modifier keyword.
 */
function hasModifier(node: TreeSitterNode, modifier: string): boolean {
  const modifiers = findChild(node, "modifiers");
  if (!modifiers) return false;
  for (let i = 0; i < modifiers.childCount; i++) {
    const child = modifiers.child(i);
    if (child && child.text === modifier) return true;
  }
  return false;
}

/**
 * Extract the full dotted path from a scoped_identifier node.
 *
 * Java's scoped_identifier nests recursively:
 * `java.util.List` is scoped_identifier(scope: scoped_identifier(scope: identifier "java",
 * name: identifier "util"), name: identifier "List")
 *
 * This returns the full path as a dotted string.
 */
function extractScopedIdentifierPath(node: TreeSitterNode): string {
  return node.text;
}

/**
 * Get the last component of a dotted import path.
 * e.g. "java.util.List" -> "List"
 */
function lastComponent(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1];
}

/**
 * Java extractor for tree-sitter structural analysis and call graph extraction.
 *
 * Handles classes, interfaces, methods, constructors, fields, imports,
 * visibility-based exports, and call graphs for Java source code.
 *
 * Java-specific mapping decisions:
 * - Classes and interfaces are mapped to the `classes` array.
 * - Constructors are mapped to the `functions` array (named after the class).
 * - Methods (including interface method signatures) are listed in the
 *   containing class/interface's `methods` array and also in the `functions` array.
 * - Exports are determined by the `public` modifier on classes, methods,
 *   constructors, and fields.
 * - Fields are extracted as `properties` from `field_declaration` nodes.
 */
export class JavaExtractor implements LanguageExtractor {
  readonly languageIds = ["java"];

  extractStructure(rootNode: TreeSitterNode): StructuralAnalysis {
    const functions: StructuralAnalysis["functions"] = [];
    const classes: StructuralAnalysis["classes"] = [];
    const imports: StructuralAnalysis["imports"] = [];
    const exports: StructuralAnalysis["exports"] = [];

    const packageDeclaration = findChild(rootNode, "package_declaration");
    const packageName = packageDeclaration
      ? (findChild(packageDeclaration, "scoped_identifier") ?? findChild(packageDeclaration, "identifier"))?.text ?? ""
      : "";

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      switch (node.type) {
        case "import_declaration":
          this.extractImport(node, imports);
          break;

        case "class_declaration":
        case "enum_declaration":
        case "record_declaration":
          this.extractClass(node, functions, classes, exports, packageName);
          break;

        case "interface_declaration":
          this.extractInterface(node, functions, classes, exports, packageName);
          break;
      }
    }

    return { functions, classes, imports, exports };
  }

  /**
   * Call sites, each with what it is invoked on (openspec:
   * changes/java-member-call-resolution, design D1/D2). Names declared inside
   * a method — parameters, locals, for-each, catch and resource variables,
   * pattern variables, lambda parameters, local classes — are bound here with
   * a scope stack, because only the syntax tree knows those scopes. Fields,
   * supertypes and other files' types are left for the fact graph.
   */
  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];
    // The top-level type a call is written in; null inside anonymous, local
    // and nested types and enum constant bodies.
    const typeStack: Array<string | null> = [];
    const scopes: LocalScope[] = [];
    const siteOfNode = new Map<number, number>();
    const pendingCalls: Array<{ receiver: { kind: string; site?: number }; nodeId: number }> = [];

    const lookupLocal = (name: string): { type: string | null } | null => {
      for (let i = scopes.length - 1; i >= 0; i--) {
        const vars = scopes[i].vars;
        if (vars.has(name)) return { type: vars.get(name) ?? null };
      }
      return null;
    };
    const isLocalType = (name: string): boolean => scopes.some((scope) => scope.types.has(name));
    // A declared type, or null when it is `var` or names a local class.
    const declared = (typeText: string): string | null => {
      if (typeText === "var") return null;
      return isLocalType(baseTypeName(typeText)) ? null : typeText;
    };
    const bind = (name: string, type: string | null) => {
      scopes[scopes.length - 1]?.vars.set(name, type);
    };
    // Pattern variables are typed only within the statement that declares
    // them; after it they are bound with no type, so a later use is never
    // misread as a field of the same name.
    const bindPattern = (name: string, type: string | null) => {
      const scope = scopes[scopes.length - 1];
      if (!scope) return;
      scope.vars.set(name, type);
      scope.patterns.push(name);
    };
    const settlePatterns = (scope: LocalScope) => {
      for (const name of scope.patterns) scope.vars.set(name, null);
      scope.patterns.length = 0;
    };

    const bindParameters = (params: TreeSitterNode | null) => {
      if (!params) return;
      for (let i = 0; i < params.childCount; i++) {
        const child = params.child(i);
        if (!child) continue;
        if (child.type === "formal_parameter") {
          const nameNode = child.childForFieldName("name");
          const typeNode = child.childForFieldName("type");
          if (!nameNode) continue;
          const dimensions = child.childForFieldName("dimensions");
          bind(nameNode.text, typeNode ? declared(`${typeNode.text}${dimensions ? dimensions.text : ""}`) : null);
        } else if (child.type === "spread_parameter") {
          const declarator = findChild(child, "variable_declarator");
          const nameNode = declarator?.childForFieldName("name");
          if (!nameNode) continue;
          let type: string | null = null;
          for (let j = 0; j < child.childCount; j++) {
            const part = child.child(j);
            if (part && part.isNamed && !NON_TYPE_CHILDREN.has(part.type)) {
              type = declared(`${part.text}[]`);
              break;
            }
          }
          bind(nameNode.text, type);
        }
      }
    };

    const bindLambdaParameters = (params: TreeSitterNode | null) => {
      if (!params) return;
      if (params.type === "identifier") {
        bind(params.text, null);
      } else if (params.type === "inferred_parameters") {
        for (const id of findChildren(params, "identifier")) bind(id.text, null);
      } else if (params.type === "formal_parameters") {
        bindParameters(params);
      }
    };

    const bindLocalDeclaration = (node: TreeSitterNode) => {
      const typeNode = node.childForFieldName("type");
      for (const declarator of findChildren(node, "variable_declarator")) {
        const nameNode = declarator.childForFieldName("name");
        if (!nameNode) continue;
        let type: string | null = null;
        if (typeNode && typeNode.text !== "var") {
          type = declared(declaratorType(typeNode, declarator));
        } else {
          // `var x = new X(...)` is the one `var` whose type the line states.
          const value = declarator.childForFieldName("value");
          const created = value?.type === "object_creation_expression" && !findChild(value, "class_body")
            ? value.childForFieldName("type")
            : null;
          type = created ? declared(created.text) : null;
        }
        bind(nameNode.text, type);
      }
    };

    // `name` and `type` fields: enhanced for, resource.
    const bindNamedTyped = (node: TreeSitterNode) => {
      const nameNode = node.childForFieldName("name");
      const typeNode = node.childForFieldName("type");
      if (!nameNode) return;
      const dimensions = node.childForFieldName("dimensions");
      bind(nameNode.text, typeNode ? declared(`${typeNode.text}${dimensions ? dimensions.text : ""}`) : null);
    };

    const bindCatchParameter = (node: TreeSitterNode) => {
      const parameter = findChild(node, "catch_formal_parameter");
      const nameNode = parameter?.childForFieldName("name");
      if (!parameter || !nameNode) return;
      const catchType = findChild(parameter, "catch_type");
      const types: string[] = [];
      for (let i = 0; i < (catchType?.childCount ?? 0); i++) {
        const type = catchType!.child(i);
        if (type && type.isNamed) types.push(type.text);
      }
      // A multi-catch variable's type is the union's least upper bound.
      bind(nameNode.text, types.length === 1 ? declared(types[0]) : null);
    };

    // `type_pattern` and `record_pattern_component`: a type, then the name.
    const bindPatternNode = (node: TreeSitterNode) => {
      let type: string | null = null;
      let name: string | null = null;
      for (let i = 0; i < node.childCount; i++) {
        const part = node.child(i);
        if (!part || !part.isNamed || part.type === "modifiers") continue;
        if (part.type === "identifier") name = part.text;
        else if (type === null && part.type !== "record_pattern") type = part.text;
      }
      if (name !== null) bindPattern(name, type === null ? null : declared(type));
    };

    const describe = (node: TreeSitterNode): CallReceiver => {
      switch (node.type) {
        case "parenthesized_expression": {
          const inner = node.namedChild(0);
          return inner ? describe(inner) : UNKNOWN_RECEIVER;
        }
        case "this":
          return { kind: "this" };
        case "super":
          return { kind: "super" };
        case "identifier": {
          const local = lookupLocal(node.text);
          if (local) return { kind: "local", type: local.type };
          if (isLocalType(node.text)) return UNKNOWN_RECEIVER;
          return { kind: "name", name: node.text };
        }
        case "field_access": {
          const object = node.childForFieldName("object");
          const field = node.childForFieldName("field");
          // `Outer.this` and the like are not plain fields.
          if (!object || !field || field.type !== "identifier") return UNKNOWN_RECEIVER;
          return { kind: "field", object: describe(object), name: field.text };
        }
        case "method_invocation": {
          const receiver = { kind: "call", site: -1 };
          pendingCalls.push({ receiver, nodeId: node.id });
          return receiver as CallReceiver;
        }
        case "object_creation_expression": {
          const typeNode = node.childForFieldName("type");
          const type = typeNode && !findChild(node, "class_body") ? declared(typeNode.text) : null;
          return type === null ? UNKNOWN_RECEIVER : { kind: "new", type };
        }
        case "cast_expression": {
          const types = node.childrenForFieldName("type");
          const type = types.length === 1 && types[0] ? declared(types[0].text) : null;
          return type === null ? UNKNOWN_RECEIVER : { kind: "type", type };
        }
        case "string_literal":
          return { kind: "type", type: "String" };
        case "class_literal":
          return { kind: "type", type: "Class" };
        default:
          return UNKNOWN_RECEIVER;
      }
    };

    const describeInvocation = (node: TreeSitterNode): CallReceiver => {
      const object = node.childForFieldName("object");
      // `X.super.m()`: an interface's default method or an outer class's
      // super; neither is resolved.
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === "super" && (!object || child.startIndex !== object.startIndex)) {
          return UNKNOWN_RECEIVER;
        }
      }
      return object ? describe(object) : { kind: "none" };
    };

    const walk = (node: TreeSitterNode, parentType: string | null) => {
      let pushedName = false;
      let pushedType = false;
      let scope: LocalScope | null = null;

      // Track entering method/constructor declarations
      if (
        node.type === "method_declaration" ||
        node.type === "constructor_declaration"
      ) {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          functionStack.push(nameNode.text);
          pushedName = true;
        }
      }

      if (TYPE_DECLARATIONS.has(node.type)) {
        const nameNode = node.childForFieldName("name");
        const topLevel = parentType === "program";
        typeStack.push(topLevel ? nameNode?.text ?? null : null);
        pushedType = true;
        // A local class shadows any type of the same name for the rest of
        // its block.
        if (!topLevel && nameNode && scopes.length > 0) scopes[scopes.length - 1].types.add(nameNode.text);
      } else if (
        node.type === "class_body" &&
        (parentType === "object_creation_expression" || parentType === "enum_constant")
      ) {
        typeStack.push(null);
        pushedType = true;
      }

      if (SCOPE_NODES.has(node.type)) {
        scope = { vars: new Map(), types: new Set(), patterns: [] };
        scopes.push(scope);
      }

      switch (node.type) {
        case "method_declaration":
        case "constructor_declaration":
          bindParameters(node.childForFieldName("parameters"));
          break;
        case "lambda_expression":
          bindLambdaParameters(node.childForFieldName("parameters"));
          break;
        case "catch_clause":
          bindCatchParameter(node);
          break;
        case "enhanced_for_statement":
        case "resource":
          bindNamedTyped(node);
          break;
        case "local_variable_declaration":
          bindLocalDeclaration(node);
          break;
        case "instanceof_expression": {
          const nameNode = node.childForFieldName("name");
          const typeNode = node.childForFieldName("right");
          if (nameNode) bindPattern(nameNode.text, typeNode ? declared(typeNode.text) : null);
          break;
        }
        case "type_pattern":
        case "record_pattern_component":
          bindPatternNode(node);
          break;
      }

      const enclosingType = typeStack.length > 0 ? typeStack[typeStack.length - 1] : null;

      // Extract method invocations: e.g. fetchFromDb(limit), System.out.println(msg)
      if (node.type === "method_invocation") {
        if (functionStack.length > 0) {
          const callee = this.extractMethodInvocationName(node);
          if (callee) {
            siteOfNode.set(node.id, entries.length);
            entries.push({
              caller: functionStack[functionStack.length - 1],
              callee,
              lineNumber: node.startPosition.row + 1,
              receiver: describeInvocation(node),
              argCount: countArguments(node),
              enclosingType,
            });
          }
        }
      }

      // Extract object creation: e.g. new Foo()
      if (node.type === "object_creation_expression") {
        if (functionStack.length > 0) {
          const typeNode = node.childForFieldName("type");
          if (typeNode) {
            const type = declared(typeNode.text);
            entries.push({
              caller: functionStack[functionStack.length - 1],
              callee: `new ${typeNode.text}`,
              lineNumber: node.startPosition.row + 1,
              receiver: type === null ? UNKNOWN_RECEIVER : { kind: "construct", type },
              argCount: countArguments(node),
              enclosingType,
            });
          }
        }
      }

      const settlesPerChild = SETTLING_SCOPES.has(node.type);
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        walk(child, node.type);
        // A switch group's labels bind its pattern variables for the group's
        // statements; every other settling scope ends them per statement.
        if (scope && settlesPerChild && child.type !== "switch_label") settlePatterns(scope);
      }

      if (scope) scopes.pop();
      if (pushedType) typeStack.pop();
      if (pushedName) {
        functionStack.pop();
      }
    };

    walk(rootNode, null);

    for (const { receiver, nodeId } of pendingCalls) {
      const site = siteOfNode.get(nodeId);
      if (site === undefined) {
        receiver.kind = "unknown";
        delete receiver.site;
      } else {
        receiver.site = site;
      }
    }

    return entries;
  }


  // ---- Private helpers ----

  /**
   * Extract the callee name from a method_invocation node.
   *
   * Handles:
   * - Plain method call: `fetchFromDb(limit)` -> "fetchFromDb"
   * - Qualified call: `System.out.println(msg)` -> "System.out.println"
   */
  private extractMethodInvocationName(node: TreeSitterNode): string | null {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return null;

    const objectNode = node.childForFieldName("object");
    if (objectNode) {
      return `${objectNode.text}.${nameNode.text}`;
    }

    return nameNode.text;
  }

  private extractImport(
    node: TreeSitterNode,
    imports: StructuralAnalysis["imports"],
  ): void {
    // Check for asterisk (wildcard) import: `import java.util.*;`
    const hasAsterisk = findChild(node, "asterisk") !== null;

    const scopedId = findChild(node, "scoped_identifier");
    if (!scopedId) return;

    const fullPath = extractScopedIdentifierPath(scopedId);
    // `import static`: the fact graph resolves bare calls and names through it.
    let isStatic = false;
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i)?.type === "static") isStatic = true;
    }

    if (hasAsterisk) {
      // Wildcard import: source is the full scope, specifier is "*"
      imports.push({
        source: fullPath,
        specifiers: ["*"],
        lineNumber: node.startPosition.row + 1,
        ...(isStatic ? { isStatic } : {}),
      });
    } else {
      // Regular import: source is the full path, specifier is the last component
      imports.push({
        source: fullPath,
        specifiers: [lastComponent(fullPath)],
        lineNumber: node.startPosition.row + 1,
        ...(isStatic ? { isStatic } : {}),
      });
    }
  }

  private extractClass(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
    packageName: string,
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];
    const facts: TypeBodyFacts = { fieldTypes: [], memberTypes: [] };
    const kind = node.type === "enum_declaration"
      ? "enum"
      : node.type === "record_declaration" ? "record" : "class";

    // Record components are the record's fields.
    if (kind === "record") {
      const components = node.childForFieldName("parameters");
      if (components) {
        const names = extractParams(components);
        const types = extractParamTypes(components);
        names.forEach((name, i) => {
          if (types[i] !== undefined) facts.fieldTypes.push({ name, type: types[i] });
        });
      }
    }

    const body = node.childForFieldName("body");
    if (body) {
      // Enum constants are static fields of the enum's own type.
      if (kind === "enum") {
        for (const constant of findChildren(body, "enum_constant")) {
          const constantName = constant.childForFieldName("name");
          if (constantName) facts.fieldTypes.push({ name: constantName.text, type: nameNode.text });
        }
      }
      this.extractClassBodyMembers(
        body,
        methods,
        properties,
        functions,
        exports,
        nameNode.text,
        facts,
      );
    }

    classes.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods,
      properties,
      ...this.typeFacts(node, kind, nameNode.text, packageName, facts),
    });

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractInterface(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
    packageName: string,
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];
    const facts: TypeBodyFacts = { fieldTypes: [], memberTypes: [] };

    const body = node.childForFieldName("body");
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const child = body.child(i);
        if (!child) continue;

        if (child.type === "method_declaration") {
          // Interface methods (abstract, default, static) are function entries
          // like class methods. They are not added to `exports`: the export
          // list predates them and keeps its meaning.
          this.extractMethod(child, methods, functions, exports, nameNode.text, false);
        } else if (child.type === "constant_declaration") {
          const typeNode = child.childForFieldName("type");
          for (const decl of findChildren(child, "variable_declarator")) {
            const declName = decl.childForFieldName("name");
            if (!declName) continue;
            properties.push(declName.text);
            if (typeNode) facts.fieldTypes.push({ name: declName.text, type: declaratorType(typeNode, decl) });
          }
        } else if (TYPE_DECLARATIONS.has(child.type)) {
          const memberName = child.childForFieldName("name");
          if (memberName) facts.memberTypes.push(memberName.text);
        }
      }
    }

    classes.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      methods,
      properties,
      ...this.typeFacts(node, "interface", nameNode.text, packageName, facts),
    });

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  /** The type facts the fact graph resolves member calls with. */
  private typeFacts(
    node: TreeSitterNode,
    kind: "class" | "interface" | "enum" | "record",
    name: string,
    packageName: string,
    facts: TypeBodyFacts,
  ): Pick<
    StructuralAnalysis["classes"][number],
    "kind" | "qualifiedName" | "supertypes" | "fieldTypes" | "annotations" | "typeParameters" | "memberTypes"
  > {
    return {
      kind,
      qualifiedName: packageName ? `${packageName}.${name}` : name,
      supertypes: extractSupertypes(node),
      fieldTypes: facts.fieldTypes,
      annotations: extractAnnotationNames(node),
      typeParameters: extractTypeParameters(node),
      memberTypes: facts.memberTypes,
    };
  }

  /**
   * Extract methods, constructors, and fields from a class_body node.
   */
  private extractClassBodyMembers(
    body: TreeSitterNode,
    methods: string[],
    properties: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    owner: string,
    facts: TypeBodyFacts,
  ): void {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i);
      if (!child) continue;

      switch (child.type) {
        case "enum_body_declarations":
          // Enum methods and members live in a nested enum_body_declarations
          // node (after the constants); recurse so they are captured.
          this.extractClassBodyMembers(
            child,
            methods,
            properties,
            functions,
            exports,
            owner,
            facts,
          );
          break;

        case "method_declaration":
          this.extractMethod(child, methods, functions, exports, owner, true);
          break;

        case "constructor_declaration":
          this.extractConstructor(child, methods, functions, exports, owner);
          break;

        case "field_declaration":
          this.extractField(child, properties, exports, facts);
          break;

        default:
          if (TYPE_DECLARATIONS.has(child.type)) {
            const memberName = child.childForFieldName("name");
            if (memberName) facts.memberTypes.push(memberName.text);
          }
      }
    }
  }

  private extractMethod(
    node: TreeSitterNode,
    methods: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    owner: string,
    exportPublic: boolean,
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const paramsNode = node.childForFieldName("parameters");
    const params = extractParams(paramsNode ?? null);
    const erasures = typeVariableErasures(node);
    const paramTypes = extractParamTypes(paramsNode ?? null).map((type) => eraseTypeVariables(type, erasures));
    const returnType = extractReturnType(node);
    const typeParameters = extractTypeParameters(node);
    // No body and not native: an interface method or an abstract method.
    const isAbstract = !node.childForFieldName("body") && !hasModifier(node, "native");

    methods.push(nameNode.text);

    functions.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
      paramTypes,
      returnType,
      owner,
      ...(isAbstract ? { abstract: true } : {}),
      ...(typeParameters.length > 0 ? { typeParameters } : {}),
    });

    if (exportPublic && hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractConstructor(
    node: TreeSitterNode,
    methods: string[],
    functions: StructuralAnalysis["functions"],
    exports: StructuralAnalysis["exports"],
    owner: string,
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const paramsNode = node.childForFieldName("parameters");
    const params = extractParams(paramsNode ?? null);
    const erasures = typeVariableErasures(node);
    const paramTypes = extractParamTypes(paramsNode ?? null).map((type) => eraseTypeVariables(type, erasures));
    const typeParameters = extractTypeParameters(node);

    methods.push(nameNode.text);

    functions.push({
      name: nameNode.text,
      lineRange: [
        node.startPosition.row + 1,
        node.endPosition.row + 1,
      ],
      params,
      paramTypes,
      // Constructors have no return type
      owner,
      ...(typeParameters.length > 0 ? { typeParameters } : {}),
    });

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractField(
    node: TreeSitterNode,
    properties: string[],
    exports: StructuralAnalysis["exports"],
    facts: TypeBodyFacts,
  ): void {
    const typeNode = node.childForFieldName("type");
    const declarators = findChildren(node, "variable_declarator");
    for (const decl of declarators) {
      const nameNode = decl.childForFieldName("name");
      if (nameNode) {
        properties.push(nameNode.text);
        if (typeNode) facts.fieldTypes.push({ name: nameNode.text, type: declaratorType(typeNode, decl) });

        if (hasModifier(node, "public")) {
          exports.push({
            name: nameNode.text,
            lineNumber: node.startPosition.row + 1,
          });
        }
      }
    }
  }
}
