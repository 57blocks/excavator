// by-type-injection, task 1.2: an annotation argument whose value is a class
// literal, or an array initializer holding class literals, lists each written
// type with its line in `classLiterals`, on a type's annotations and on a
// member's alike. `value` stays null: the argument is not a string literal.
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { JavaExtractor } from "../java-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
let javaLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  await Parser.init();
  javaLang = await mod.Language.load(require.resolve("tree-sitter-java/tree-sitter-java.wasm"));
});

const extractor = new JavaExtractor();

function structure(code: string) {
  const parser = new Parser();
  parser.setLanguage(javaLang);
  const tree = parser.parse(code);
  const result = extractor.extractStructure(tree.rootNode);
  tree.delete();
  parser.delete();
  return result;
}

/** The arguments of the type annotation named `name` on the first type. */
const typeArguments = (code: string, name: string) =>
  structure(code).classes[0]!.annotationArguments!.find((use) => use.name === name)!.arguments;

/** The arguments of the member annotation named `name`, first record. */
const memberArguments = (code: string, name: string) =>
  structure(code).memberAnnotations!.find((use) => use.name === name)!.arguments;

describe("JavaExtractor - class literals in type annotation arguments", () => {
  it("lists a single class literal and leaves value null", () => {
    expect(typeArguments(`@Stateless
@Local(OrderService.class)
class Bean {}
`, "Local")).toEqual([
      { key: "value", value: null, classLiterals: [{ type: "OrderService", line: 2 }] },
    ]);
  });

  it("lists a class literal given under a named key", () => {
    expect(typeArguments(`@EJB(name = "x", beanInterface = Port.class)
class Bean {}
`, "EJB")).toEqual([
      { key: "name", value: "x" },
      { key: "beanInterface", value: null, classLiterals: [{ type: "Port", line: 1 }] },
    ]);
  });

  it("lists every class literal of an array initializer in source order", () => {
    expect(typeArguments(`@Remote({First.class, Second.class, Third.class})
class Bean {}
`, "Remote")).toEqual([
      {
        key: "value",
        value: null,
        classLiterals: [
          { type: "First", line: 1 },
          { type: "Second", line: 1 },
          { type: "Third", line: 1 },
        ],
      },
    ]);
  });

  it("lists an array under a named key, and a one-element array", () => {
    expect(typeArguments(`@Local(value = {Only.class})
class Bean {}
`, "Local")).toEqual([
      { key: "value", value: null, classLiterals: [{ type: "Only", line: 1 }] },
    ]);
  });

  it("lists only the class literals of a mixed array, and nothing for the other elements", () => {
    expect(typeArguments(`@Mixed({First.class, "text", Constants.NAME, Second.class, 42, @Nested(Third.class)})
class Bean {}
`, "Mixed")).toEqual([
      {
        key: "value",
        value: null,
        classLiterals: [
          { type: "First", line: 1 },
          { type: "Second", line: 1 },
        ],
      },
    ]);
  });

  it("gives each entry of a multi-line array its own line, comments between them ignored", () => {
    expect(typeArguments(`@Remote(value = {
    First.class,   // the first
    /* skipped */
    Second.class,

    Third.class
})
class Bean {}
`, "Remote")).toEqual([
      {
        key: "value",
        value: null,
        classLiterals: [
          { type: "First", line: 2 },
          { type: "Second", line: 4 },
          { type: "Third", line: 6 },
        ],
      },
    ]);
  });

  it("keeps a fully qualified literal qualified, and rebuilds one wrapped across lines", () => {
    expect(typeArguments(`@Local({java.util.List.class, com.acme
    .Port.class})
class Bean {}
`, "Local")).toEqual([
      {
        key: "value",
        value: null,
        classLiterals: [
          { type: "java.util.List", line: 1 },
          { type: "com.acme.Port", line: 1 },
        ],
      },
    ]);
  });

  it("records array types, a written generic type and void as written before .class", () => {
    // A literal has no type arguments in valid Java; the grammar reads one
    // written anyway, and the type is recorded as written before `.class`,
    // like the file's `classLiterals`.
    expect(typeArguments(`@Types({int[].class, String[][].class, Box<String>.class, void.class})
class Bean {}
`, "Types")).toEqual([
      {
        key: "value",
        value: null,
        classLiterals: [
          { type: "int[]", line: 1 },
          { type: "String[][]", line: 1 },
          { type: "Box<String>", line: 1 },
          { type: "void", line: 1 },
        ],
      },
    ]);
  });

  it("omits the field when an argument holds no class literal", () => {
    expect(typeArguments(`@Config(name = "x", empty = {}, mixed = {"a", "b"}, constant = Names.FIRST, nested = @Inner(Hidden.class))
class Bean {}
`, "Config")).toEqual([
      { key: "name", value: "x" },
      { key: "empty", value: null },
      { key: "mixed", value: null },
      { key: "constant", value: null },
      { key: "nested", value: null },
    ]);
  });

  it("lists the class literals of each argument of an annotation on their own arguments", () => {
    expect(typeArguments(`@Both(left = Left.class, right = {Right.class, Other.class})
class Bean {}
`, "Both")).toEqual([
      { key: "left", value: null, classLiterals: [{ type: "Left", line: 1 }] },
      {
        key: "right",
        value: null,
        classLiterals: [
          { type: "Right", line: 1 },
          { type: "Other", line: 1 },
        ],
      },
    ]);
  });

  it("does not add the field to an annotation with no class literal", () => {
    expect(structure(`@Stateless @Named("a") @Marker class Bean {}`).classes[0]!.annotationArguments).toEqual([
      { name: "Stateless", line: 1, arguments: [] },
      { name: "Named", line: 1, arguments: [{ key: "value", value: "a" }] },
      { name: "Marker", line: 1, arguments: [] },
    ]);
  });
});

describe("JavaExtractor - class literals in member annotation arguments", () => {
  it("lists a single literal with the line its value starts on, which is not the annotation's line", () => {
    expect(memberArguments(`class Svc {
  @Qualifies(
      Port.class)
  private Port port;
}
`, "Qualifies")).toEqual([
      { key: "value", value: null, line: 3, classLiterals: [{ type: "Port", line: 3 }] },
    ]);
  });

  it("lists an array, a mixed array and a qualified literal on a field", () => {
    expect(memberArguments(`class Svc {
  @Tags(types = {First.class, "text", java.util.Map.class, Names.X})
  private Object field;
}
`, "Tags")).toEqual([
      {
        key: "types",
        value: null,
        line: 2,
        classLiterals: [
          { type: "First", line: 2 },
          { type: "java.util.Map", line: 2 },
        ],
      },
    ]);
  });

  it("gives each entry of a multi-line array its own line", () => {
    expect(memberArguments(`class Svc {
  @Tags({
      First.class,
      Second.class
  })
  void set() {}
}
`, "Tags")).toEqual([
      {
        key: "value",
        value: null,
        line: 2,
        classLiterals: [
          { type: "First", line: 3 },
          { type: "Second", line: 4 },
        ],
      },
    ]);
  });

  it("lists array dimensions as written, and leaves a non-literal argument without the field", () => {
    expect(memberArguments(`class Svc {
  @Tags(a = byte[].class, b = "text", c = Names.X, d = {})
  Object f;
}
`, "Tags")).toEqual([
      { key: "a", value: null, line: 2, classLiterals: [{ type: "byte[]", line: 2 }] },
      { key: "b", value: "text", line: 2 },
      { key: "c", value: null, line: 2 },
      { key: "d", value: null, line: 2 },
    ]);
  });

  it("lists the literals of an annotation on a parameter and on a record component", () => {
    expect(structure(`class Svc {
  void run(@Qualifies({First.class, Second.class}) Object a) {}
}
record R(@Qualifies(Third.class) Object b) {}
`).memberAnnotations!.map((use) => [use.on, use.arguments])).toEqual([
      [
        "parameter",
        [{ key: "value", value: null, line: 2, classLiterals: [{ type: "First", line: 2 }, { type: "Second", line: 2 }] }],
      ],
      ["component", [{ key: "value", value: null, line: 4, classLiterals: [{ type: "Third", line: 4 }] }]],
    ]);
  });

  it("gives each record of a multi-declarator field its own copy of the list", () => {
    const records = structure(`class Svc {
  @Tags(First.class) Object a, b;
}
`).memberAnnotations!;
    expect(records.map((use) => use.member.name)).toEqual(["a", "b"]);
    expect(records[0]!.arguments[0]!.classLiterals).toEqual([{ type: "First", line: 2 }]);
    expect(records[1]!.arguments[0]!.classLiterals).toEqual([{ type: "First", line: 2 }]);
    expect(records[0]!.arguments[0]!.classLiterals).not.toBe(records[1]!.arguments[0]!.classLiterals);
    expect(records[0]!.arguments[0]!.classLiterals![0]).not.toBe(records[1]!.arguments[0]!.classLiterals![0]);
  });

  it("does not add the field to a member annotation with no class literal", () => {
    expect(structure(`class Svc {
  @Named("a") @Inject private Object f;
}
`).memberAnnotations!.map((use) => [use.name, use.arguments])).toEqual([
      ["Named", [{ key: "value", value: "a", line: 2 }]],
      ["Inject", []],
    ]);
  });
});
