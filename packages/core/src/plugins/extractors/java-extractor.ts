import type { StructuralAnalysis, CallGraphEntry } from "../../types.js";
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
          this.extractClass(node, functions, classes, exports);
          break;

        case "interface_declaration":
          this.extractInterface(node, functions, classes, exports);
          break;
      }
    }

    return { functions, classes, imports, exports };
  }

  extractCallGraph(rootNode: TreeSitterNode): CallGraphEntry[] {
    const entries: CallGraphEntry[] = [];
    const functionStack: string[] = [];

    const walkForCalls = (node: TreeSitterNode) => {
      let pushedName = false;

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

      // Extract method invocations: e.g. fetchFromDb(limit), System.out.println(msg)
      if (node.type === "method_invocation") {
        if (functionStack.length > 0) {
          const callee = this.extractMethodInvocationName(node);
          if (callee) {
            entries.push({
              caller: functionStack[functionStack.length - 1],
              callee,
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
      }

      // Extract object creation: e.g. new Foo()
      if (node.type === "object_creation_expression") {
        if (functionStack.length > 0) {
          const typeNode = node.childForFieldName("type");
          if (typeNode) {
            entries.push({
              caller: functionStack[functionStack.length - 1],
              callee: `new ${typeNode.text}`,
              lineNumber: node.startPosition.row + 1,
            });
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walkForCalls(child);
      }

      if (pushedName) {
        functionStack.pop();
      }
    };

    walkForCalls(rootNode);

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

    if (hasAsterisk) {
      // Wildcard import: source is the full scope, specifier is "*"
      imports.push({
        source: fullPath,
        specifiers: ["*"],
        lineNumber: node.startPosition.row + 1,
      });
    } else {
      // Regular import: source is the full path, specifier is the last component
      imports.push({
        source: fullPath,
        specifiers: [lastComponent(fullPath)],
        lineNumber: node.startPosition.row + 1,
      });
    }
  }

  private extractClass(
    node: TreeSitterNode,
    functions: StructuralAnalysis["functions"],
    classes: StructuralAnalysis["classes"],
    exports: StructuralAnalysis["exports"],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];

    const body = node.childForFieldName("body");
    if (body) {
      this.extractClassBodyMembers(
        body,
        methods,
        properties,
        functions,
        exports,
        nameNode.text,
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
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const methods: string[] = [];
    const properties: string[] = [];

    const body = node.childForFieldName("body");
    if (body) {
      // Interface body contains method_declaration nodes (signatures without bodies)
      const methodNodes = findChildren(body, "method_declaration");
      for (const methodNode of methodNodes) {
        const methNameNode = methodNode.childForFieldName("name");
        if (methNameNode) {
          methods.push(methNameNode.text);
        }
      }

      // Interface can also contain constant_declaration (fields)
      const fields = findChildren(body, "constant_declaration");
      for (const field of fields) {
        const declarators = findChildren(field, "variable_declarator");
        for (const decl of declarators) {
          const declName = decl.childForFieldName("name");
          if (declName) {
            properties.push(declName.text);
          }
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
    });

    if (hasModifier(node, "public")) {
      exports.push({
        name: nameNode.text,
        lineNumber: node.startPosition.row + 1,
      });
    }
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
          );
          break;

        case "method_declaration":
          this.extractMethod(child, methods, functions, exports, owner);
          break;

        case "constructor_declaration":
          this.extractConstructor(child, methods, functions, exports, owner);
          break;

        case "field_declaration":
          this.extractField(child, properties, exports);
          break;
      }
    }
  }

  private extractMethod(
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
    const returnType = extractReturnType(node);

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
    });

    if (hasModifier(node, "public")) {
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
  ): void {
    const declarators = findChildren(node, "variable_declarator");
    for (const decl of declarators) {
      const nameNode = decl.childForFieldName("name");
      if (nameNode) {
        properties.push(nameNode.text);

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
