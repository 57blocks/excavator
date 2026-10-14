// by-type-injection, task 1.2: a member annotation records the declared type
// of the member it is attached to: a field's type (with the array dimensions
// written on its declarator) or a method's return type. A constructor and a
// record have none; a parameter carries the type of the method it belongs to.
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

/** Each record as `[on, member]`, to read the member objects exactly. */
const members = (code: string) => structure(code).memberAnnotations!.map((use) => [use.on, use.member]);

describe("JavaExtractor - member types: fields", () => {
  it("records a field's declared type as written", () => {
    expect(members(`class Svc {
  @In private OrderDao dao;
  @In List<Map<String, Integer>> names;
  @In java.util.List<com.acme.Order> orders;
  @In int count;
}
`)).toEqual([
      ["field", { name: "dao", line: 2, type: "OrderDao" }],
      ["field", { name: "names", line: 3, type: "List<Map<String, Integer>>" }],
      ["field", { name: "orders", line: 4, type: "java.util.List<com.acme.Order>" }],
      ["field", { name: "count", line: 5, type: "int" }],
    ]);
  });

  it("appends the array dimensions written on the declarator", () => {
    expect(members(`class Svc {
  @In String names[];
  @In String[] already;
  @In String[] mixed[];
  @In int grid[][];
}
`)).toEqual([
      ["field", { name: "names", line: 2, type: "String[]" }],
      ["field", { name: "already", line: 3, type: "String[]" }],
      ["field", { name: "mixed", line: 4, type: "String[][]" }],
      ["field", { name: "grid", line: 5, type: "int[][]" }],
    ]);
  });

  it("gives each declarator of one declaration its own correct type", () => {
    expect(members(`class Svc {
  @In int a, b[], c[][];
}
`)).toEqual([
      ["field", { name: "a", line: 2, type: "int" }],
      ["field", { name: "b", line: 2, type: "int[]" }],
      ["field", { name: "c", line: 2, type: "int[][]" }],
    ]);
  });

  it("records the type of an interface constant and of a field in a nested, local or anonymous type", () => {
    expect(members(`interface Port {
  @In String NAME = "x";
}
class Svc {
  static class Inner { @In Dao inner; }
  Object o = new Base() { @In Cache anon; };
  void run() { class Local { @In Repo local; } }
}
`)).toEqual([
      ["field", { name: "NAME", line: 2, type: "String" }],
      ["field", { name: "inner", line: 5, type: "Dao" }],
      ["field", { name: "anon", line: 6, type: "Cache" }],
      ["field", { name: "local", line: 7, type: "Repo" }],
    ]);
  });
});

describe("JavaExtractor - member types: methods", () => {
  it("records a method's return type as written", () => {
    expect(members(`class Svc {
  @In void a() {}
  @In OrderDao b() { return null; }
  @In java.util.Optional<K> c() { return null; }
  @In <T extends Number> T d() { return null; }
  @In String[] e() { return null; }
}
`)).toEqual([
      ["method", { name: "a", line: 2, type: "void" }],
      ["method", { name: "b", line: 3, type: "OrderDao" }],
      ["method", { name: "c", line: 4, type: "java.util.Optional<K>" }],
      ["method", { name: "d", line: 5, type: "T" }],
      ["method", { name: "e", line: 6, type: "String[]" }],
    ]);
  });

  it("appends array dimensions written after the parameter list", () => {
    expect(members(`class Svc {
  @In int f()[] { return null; }
}
`)).toEqual([["method", { name: "f", line: 2, type: "int[]" }]]);
  });

  it("records the return type of an interface method, abstract or default", () => {
    expect(members(`interface Port {
  @In Dao find();
  @In default Cache cache() { return null; }
}
`)).toEqual([
      ["method", { name: "find", line: 2, type: "Dao" }],
      ["method", { name: "cache", line: 3, type: "Cache" }],
    ]);
  });
});

describe("JavaExtractor - member types: constructors, parameters and components", () => {
  it("leaves the key off a constructor and a compact constructor", () => {
    const rows = structure(`class Svc {
  @In Svc() {}
}
record R(int a) {
  @In R {}
}
`).memberAnnotations!;
    expect(rows.map((use) => use.on)).toEqual(["constructor", "constructor"]);
    // The key is absent, not undefined.
    expect(rows.map((use) => use.member)).toStrictEqual([
      { name: "Svc", line: 2 },
      { name: "R", line: 5 },
    ]);
  });

  it("gives a parameter of a method the type of that method, and a parameter of a constructor none", () => {
    const rows = structure(`class Svc {
  Svc(@P Dao d) {}
  Order find(@P String id, @P int... rest) { return null; }
  void set(@P Dao d) {}
}
`).memberAnnotations!;
    expect(rows.map((use) => [use.on, use.parameter!.name, use.member])).toStrictEqual([
      ["parameter", "d", { name: "Svc", line: 2 }],
      ["parameter", "id", { name: "find", line: 3, type: "Order" }],
      ["parameter", "rest", { name: "find", line: 3, type: "Order" }],
      ["parameter", "d", { name: "set", line: 4, type: "void" }],
    ]);
  });

  it("gives the method annotation and its parameters' annotations the same member", () => {
    const rows = structure(`class Svc {
  @In Order find(@P String id) { return null; }
}
`).memberAnnotations!;
    expect(rows.map((use) => [use.on, use.member])).toEqual([
      ["method", { name: "find", line: 2, type: "Order" }],
      ["parameter", { name: "find", line: 2, type: "Order" }],
    ]);
  });

  it("leaves the key off a record component: its member is the record, which has no declared type", () => {
    const rows = structure(`record Order(@In String id, @In List<String> tags) {}
`).memberAnnotations!;
    expect(rows.map((use) => [use.on, use.parameter!.name])).toEqual([
      ["component", "id"],
      ["component", "tags"],
    ]);
    expect(rows.map((use) => use.member)).toStrictEqual([
      { name: "Order", line: 1 },
      { name: "Order", line: 1 },
    ]);
  });

  it("does not share the member object between the records of one declaration", () => {
    const rows = structure(`class Svc {
  @A @B Dao dao;
}
`).memberAnnotations!;
    expect(rows.map((use) => use.member)).toEqual([
      { name: "dao", line: 2, type: "Dao" },
      { name: "dao", line: 2, type: "Dao" },
    ]);
    expect(rows[0]!.member).not.toBe(rows[1]!.member);
  });
});
