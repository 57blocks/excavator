// annotation-injection-references, task 1.1: every annotation on a Java field,
// method, constructor, parameter or record component is recorded with its
// arguments, the line each argument value starts on, and the member it is
// attached to, at any depth of type nesting. Nothing else is recorded.
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

const members = (code: string) => structure(code).memberAnnotations;

describe("JavaExtractor - member annotations: fields", () => {
  it("records a field annotation with its argument and the name's line", () => {
    expect(members(`class Svc {
  @Resource(name = "orderDao")
  private OrderDao dao;
}
`)).toEqual([{
      name: "Resource",
      line: 2,
      arguments: [{ key: "name", value: "orderDao", line: 2 }],
      on: "field",
      owner: "Svc",
      nested: false,
      member: { name: "dao", line: 3, type: "OrderDao" },
    }]);
  });

  it("records a marker annotation and an empty-parenthesis one as having no arguments", () => {
    expect(members(`class Svc {
  @In private Dao a;
  @In() private Dao b;
}
`)).toEqual([
      { name: "In", line: 2, arguments: [], on: "field", owner: "Svc", nested: false, member: { name: "a", line: 2, type: "Dao" } },
      { name: "In", line: 3, arguments: [], on: "field", owner: "Svc", nested: false, member: { name: "b", line: 3, type: "Dao" } },
    ]);
  });

  it("gives a lone unnamed argument the key value and writes the name as written", () => {
    expect(members(`class Svc {
  @javax.inject.Named("x") Dao dao;
}
`)).toEqual([{
      name: "javax.inject.Named",
      line: 2,
      arguments: [{ key: "value", value: "x", line: 2 }],
      on: "field",
      owner: "Svc",
      nested: false,
      member: { name: "dao", line: 2, type: "Dao" },
    }]);
  });

  it("records one record per declarator of a multi-declarator field, annotation by annotation", () => {
    expect(members(`class Svc {
  @A @B("x") private Dao first,
      second = null,
      third[];
}
`)).toEqual([
      { name: "A", line: 2, arguments: [], on: "field", owner: "Svc", nested: false, member: { name: "first", line: 2, type: "Dao" } },
      { name: "A", line: 2, arguments: [], on: "field", owner: "Svc", nested: false, member: { name: "second", line: 3, type: "Dao" } },
      { name: "A", line: 2, arguments: [], on: "field", owner: "Svc", nested: false, member: { name: "third", line: 4, type: "Dao[]" } },
      {
        name: "B", line: 2, arguments: [{ key: "value", value: "x", line: 2 }],
        on: "field", owner: "Svc", nested: false, member: { name: "first", line: 2, type: "Dao" },
      },
      {
        name: "B", line: 2, arguments: [{ key: "value", value: "x", line: 2 }],
        on: "field", owner: "Svc", nested: false, member: { name: "second", line: 3, type: "Dao" },
      },
      {
        name: "B", line: 2, arguments: [{ key: "value", value: "x", line: 2 }],
        on: "field", owner: "Svc", nested: false, member: { name: "third", line: 4, type: "Dao[]" },
      },
    ]);
  });

  it("records interface constants", () => {
    expect(members(`interface Names {
  @Deprecated String A = "a", B = "b";
}
`)).toEqual([
      { name: "Deprecated", line: 2, arguments: [], on: "field", owner: "Names", nested: false, member: { name: "A", line: 2, type: "String" } },
      { name: "Deprecated", line: 2, arguments: [], on: "field", owner: "Names", nested: false, member: { name: "B", line: 2, type: "String" } },
    ]);
  });

  it("records enum fields but not enum constants", () => {
    expect(members(`enum Mode {
  @Deprecated OLD,
  NEW;
  @Resource Dao dao;
}
`)).toEqual([
      { name: "Resource", line: 4, arguments: [], on: "field", owner: "Mode", nested: false, member: { name: "dao", line: 4, type: "Dao" } },
    ]);
  });
});

describe("JavaExtractor - member annotations: arguments", () => {
  it("takes the line an argument value starts on, not the line the annotation starts on", () => {
    expect(members(`class Svc {
  @Resource(
      type = Dao.class,
      name =
          "orderDao")
  Dao dao;
}
`)).toEqual([{
      name: "Resource",
      line: 2,
      arguments: [
        { key: "type", value: null, line: 3, classLiterals: [{ type: "Dao", line: 3 }] },
        { key: "name", value: "orderDao", line: 5 },
      ],
      on: "field",
      owner: "Svc",
      nested: false,
      member: { name: "dao", line: 6, type: "Dao" },
    }]);
  });

  it("gives every argument that is not a single string literal a null value, with its line", () => {
    expect(members(`class Svc {
  @Qualifier(Names.ORDERS) Dao a;
  @Qualifier("a" + "b") Dao b;
  @Qualifier({"a", "b"}) Dao c;
  @Qualifier(name = @Foo("x")) Dao d;
  @Qualifier('c') Dao e;
  @Qualifier("""
      text
      """) Dao f;
}
`)).toEqual([
      { name: "Qualifier", line: 2, arguments: [{ key: "value", value: null, line: 2 }], on: "field", owner: "Svc", nested: false, member: { name: "a", line: 2, type: "Dao" } },
      { name: "Qualifier", line: 3, arguments: [{ key: "value", value: null, line: 3 }], on: "field", owner: "Svc", nested: false, member: { name: "b", line: 3, type: "Dao" } },
      { name: "Qualifier", line: 4, arguments: [{ key: "value", value: null, line: 4 }], on: "field", owner: "Svc", nested: false, member: { name: "c", line: 4, type: "Dao" } },
      { name: "Qualifier", line: 5, arguments: [{ key: "name", value: null, line: 5 }], on: "field", owner: "Svc", nested: false, member: { name: "d", line: 5, type: "Dao" } },
      { name: "Qualifier", line: 6, arguments: [{ key: "value", value: null, line: 6 }], on: "field", owner: "Svc", nested: false, member: { name: "e", line: 6, type: "Dao" } },
      { name: "Qualifier", line: 7, arguments: [{ key: "value", value: null, line: 7 }], on: "field", owner: "Svc", nested: false, member: { name: "f", line: 9, type: "Dao" } },
    ]);
  });

  it("decodes escape sequences and reads an empty string as an empty value", () => {
    expect(members(String.raw`class Svc {
  @Resource(name = "a\"bA") Dao a;
  @Resource(name = "") Dao b;
}
`)!.map((use) => use.arguments)).toEqual([
      [{ key: "name", value: 'a"bA', line: 2 }],
      [{ key: "name", value: "", line: 3 }],
    ]);
  });

  it("keeps every key of a multi-argument annotation in order", () => {
    expect(members(`class Svc {
  @EJB(name = "n", beanName = "OrderBean", lookup = "x")
  Dao dao;
}
`)![0].arguments).toEqual([
      { key: "name", value: "n", line: 2 },
      { key: "beanName", value: "OrderBean", line: 2 },
      { key: "lookup", value: "x", line: 2 },
    ]);
  });
});

describe("JavaExtractor - member annotations: methods and constructors", () => {
  it("records method and constructor annotations on the name's line", () => {
    expect(members(`class Svc {
  @Autowired
  @Qualifier("orderDao")
  public void setDao(
      Dao dao) {}

  @Inject
  Svc() {}
}
`)).toEqual([
      { name: "Autowired", line: 2, arguments: [], on: "method", owner: "Svc", nested: false, member: { name: "setDao", line: 4, type: "void" } },
      {
        name: "Qualifier", line: 3, arguments: [{ key: "value", value: "orderDao", line: 3 }],
        on: "method", owner: "Svc", nested: false, member: { name: "setDao", line: 4, type: "void" },
      },
      { name: "Inject", line: 7, arguments: [], on: "constructor", owner: "Svc", nested: false, member: { name: "Svc", line: 8 } },
    ]);
  });

  it("records annotations on interface methods and enum methods", () => {
    expect(members(`interface Port {
  @Deprecated void send();
}
enum Mode {
  A;
  @Override public String toString() { return ""; }
}
`)).toEqual([
      { name: "Deprecated", line: 2, arguments: [], on: "method", owner: "Port", nested: false, member: { name: "send", line: 2, type: "void" } },
      { name: "Override", line: 6, arguments: [], on: "method", owner: "Mode", nested: false, member: { name: "toString", line: 6, type: "String" } },
    ]);
  });

  it("records an annotation on a record's compact constructor", () => {
    expect(members(`record R(int a) {
  @Deprecated R {}
}
`)).toEqual([
      { name: "Deprecated", line: 2, arguments: [], on: "constructor", owner: "R", nested: false, member: { name: "R", line: 2 } },
    ]);
  });
});

describe("JavaExtractor - member annotations: parameters and components", () => {
  it("records parameter annotations with the member and the parameter's name, index and line", () => {
    expect(members(`class Svc {
  Svc(@Qualifier("a") Dao one,
      Dao plain,
      @Qualifier("b") @Valid final Dao two) {}
  void run(@In String s) {}
}
`)).toEqual([
      {
        name: "Qualifier", line: 2, arguments: [{ key: "value", value: "a", line: 2 }],
        on: "parameter", owner: "Svc", nested: false,
        member: { name: "Svc", line: 2 }, parameter: { name: "one", index: 0, line: 2 },
      },
      {
        name: "Qualifier", line: 4, arguments: [{ key: "value", value: "b", line: 4 }],
        on: "parameter", owner: "Svc", nested: false,
        member: { name: "Svc", line: 2 }, parameter: { name: "two", index: 2, line: 4 },
      },
      {
        name: "Valid", line: 4, arguments: [],
        on: "parameter", owner: "Svc", nested: false,
        member: { name: "Svc", line: 2 }, parameter: { name: "two", index: 2, line: 4 },
      },
      {
        name: "In", line: 5, arguments: [],
        on: "parameter", owner: "Svc", nested: false,
        member: { name: "run", line: 5, type: "void" }, parameter: { name: "s", index: 0, line: 5 },
      },
    ]);
  });

  it("records the annotations before `...` of a varargs parameter and none after it", () => {
    expect(members(`class Svc {
  void run(String first, @Named("x") String... rest) {}
}
`)).toEqual([{
      name: "Named", line: 2, arguments: [{ key: "value", value: "x", line: 2 }],
      on: "parameter", owner: "Svc", nested: false,
      member: { name: "run", line: 2, type: "void" }, parameter: { name: "rest", index: 1, line: 2 },
    }]);
    // An annotation after `...` is not a declaration annotation: not recorded.
    expect(members(`class Svc {
  void run(String @Named("x") ... rest) {}
}
`)).toEqual([]);
  });

  it("does not record a receiver parameter and does not count it in an index", () => {
    expect(members(`class Svc {
  void run(Svc this, @In String s) {}
}
`)).toEqual([{
      name: "In", line: 2, arguments: [],
      on: "parameter", owner: "Svc", nested: false,
      member: { name: "run", line: 2, type: "void" }, parameter: { name: "s", index: 0, line: 2 },
    }]);
  });

  it("records record components with the record as the member", () => {
    expect(members(`record Order(
    @Id String id,
    @Nullable @Size(max = 3) int... tags) {}
`)).toEqual([
      {
        name: "Id", line: 2, arguments: [],
        on: "component", owner: "Order", nested: false,
        member: { name: "Order", line: 1 }, parameter: { name: "id", index: 0, line: 2 },
      },
      {
        name: "Nullable", line: 3, arguments: [],
        on: "component", owner: "Order", nested: false,
        member: { name: "Order", line: 1 }, parameter: { name: "tags", index: 1, line: 3 },
      },
      {
        name: "Size", line: 3, arguments: [{ key: "max", value: null, line: 3 }],
        on: "component", owner: "Order", nested: false,
        member: { name: "Order", line: 1 }, parameter: { name: "tags", index: 1, line: 3 },
      },
    ]);
  });
});

describe("JavaExtractor - member annotations: nesting", () => {
  it("attributes a nested static class's members to the top-level type and marks them nested", () => {
    expect(members(`public class Outer {
  @In Dao outerField;
  static class Inner {
    @In Dao innerField;
    static class Deeper {
      @In void deeper() {}
    }
  }
}
`)).toEqual([
      { name: "In", line: 2, arguments: [], on: "field", owner: "Outer", nested: false, member: { name: "outerField", line: 2, type: "Dao" } },
      { name: "In", line: 4, arguments: [], on: "field", owner: "Outer", nested: true, member: { name: "innerField", line: 4, type: "Dao" } },
      { name: "In", line: 6, arguments: [], on: "method", owner: "Outer", nested: true, member: { name: "deeper", line: 6, type: "void" } },
    ]);
  });

  it("reads a local class declared in a method body", () => {
    expect(members(`class Outer {
  void run() {
    class Local {
      @In Dao dao;
      @In void set(@Qualifier("q") Dao d) {}
    }
  }
}
`)).toEqual([
      { name: "In", line: 4, arguments: [], on: "field", owner: "Outer", nested: true, member: { name: "dao", line: 4, type: "Dao" } },
      { name: "In", line: 5, arguments: [], on: "method", owner: "Outer", nested: true, member: { name: "set", line: 5, type: "void" } },
      {
        name: "Qualifier", line: 5, arguments: [{ key: "value", value: "q", line: 5 }],
        on: "parameter", owner: "Outer", nested: true,
        member: { name: "set", line: 5, type: "void" }, parameter: { name: "d", index: 0, line: 5 },
      },
    ]);
  });

  it("reads an anonymous class body, in a method and in a field initializer", () => {
    expect(members(`class Outer {
  Runnable field = new Runnable() {
    @In Dao inField;
    public void run() {}
  };
  void go() {
    register(new Handler() {
      @Override public void handle(@In Dao d) {}
    });
  }
}
`)).toEqual([
      { name: "In", line: 3, arguments: [], on: "field", owner: "Outer", nested: true, member: { name: "inField", line: 3, type: "Dao" } },
      { name: "Override", line: 8, arguments: [], on: "method", owner: "Outer", nested: true, member: { name: "handle", line: 8, type: "void" } },
      {
        name: "In", line: 8, arguments: [],
        on: "parameter", owner: "Outer", nested: true,
        member: { name: "handle", line: 8, type: "void" }, parameter: { name: "d", index: 0, line: 8 },
      },
    ]);
  });

  it("reads the body of an enum constant", () => {
    expect(members(`enum Mode {
  A {
    @Override void f() {}
  },
  B;
  void f() {}
}
`)).toEqual([
      { name: "Override", line: 3, arguments: [], on: "method", owner: "Mode", nested: true, member: { name: "f", line: 3, type: "void" } },
    ]);
  });

  it("gives each top-level type of a file its own owner", () => {
    expect(members(`class A { @In Dao a; }
interface B { @In Dao b = null; }
enum C { X; @In Dao c; }
record D(@In Dao d) {}
`)!.map((use) => [use.owner, use.nested, use.on, use.member.name])).toEqual([
      ["A", false, "field", "a"],
      ["B", false, "field", "b"],
      ["C", false, "field", "c"],
      ["D", false, "component", "D"],
    ]);
  });

  it("marks the components and members of a nested record and interface as nested", () => {
    expect(members(`class Outer {
  record Pair(@In Dao left) {}
  interface Port { @In void send(); }
}
`)!.map((use) => [use.owner, use.nested, use.on, use.member.name])).toEqual([
      ["Outer", true, "component", "Pair"],
      ["Outer", true, "method", "send"],
    ]);
  });

  it("records the members of a top-level @interface under that annotation type's name", () => {
    expect(members(`@interface Marker {
  @Deprecated String NAME = "n";
  @Nullable String value() default "";
  class Holder {
    @In Dao dao;
  }
}
`)).toEqual([
      { name: "Deprecated", line: 2, arguments: [], on: "field", owner: "Marker", nested: false, member: { name: "NAME", line: 2, type: "String" } },
      { name: "In", line: 5, arguments: [], on: "field", owner: "Marker", nested: true, member: { name: "dao", line: 5, type: "Dao" } },
    ]);
  });
});

describe("JavaExtractor - member annotations: positions that are not recorded", () => {
  it("records nothing for type annotations, local variables, lambda and catch parameters", () => {
    expect(members(`@Entity
@Named("x")
class Svc {
  void run() {
    @SuppressWarnings("unchecked") List local = null;
    Runnable r = (@Foo String s) -> {};
    java.util.function.Function<String, String> f = (@Foo var v) -> v;
    try {
      work();
    } catch (@Foo final IOException e) {
    }
    for (@Foo String each : items) {}
    try (@Foo Resource res = open()) {}
  }
}
`)).toEqual([]);
  });

  it("records nothing for type-use annotations inside types", () => {
    expect(members(`class Svc {
  List<@Foo String> field;
  Map<String, @Foo List<@Bar String>> other;
  String @Foo [] array;
  void run(List<@Foo String> a, Map<@Bar String, String> b) throws @Foo Exception {
    Object o = new @Foo Bar();
    Object p = (@Foo String) o;
  }
}
`)).toEqual([]);
  });

  it("records nothing for enum constants and annotation element defaults", () => {
    expect(members(`enum Mode {
  @Deprecated OLD,
  @Foo(1) NEW
}
@interface Marker {
  String value() default "x";
  Nested nested() default @Nested("y");
}
`)).toEqual([]);
  });

  it("gives a file with no annotated members an empty list, not an absent one", () => {
    expect(structure(`class Svc { void run() {} int x; }
`).memberAnnotations).toEqual([]);
  });
});

describe("JavaExtractor - member annotations: key order", () => {
  // Rows are hashed and diffed as JSON, so the key order is part of the shape.
  it("writes the keys in the order of the design, `parameter` last", () => {
    const [field, parameter] = members(`class Svc {
  @In(name = "x") Dao dao;
  void run(@In Dao d) {}
}
`)!;
    expect(Object.keys(field)).toEqual(["name", "line", "arguments", "on", "owner", "nested", "member"]);
    expect(Object.keys(field.arguments[0])).toEqual(["key", "value", "line"]);
    expect(Object.keys(field.member)).toEqual(["name", "line", "type"]);
    expect(Object.keys(parameter)).toEqual(["name", "line", "arguments", "on", "owner", "nested", "member", "parameter"]);
    expect(Object.keys(parameter.parameter!)).toEqual(["name", "index", "line"]);
  });
});

describe("JavaExtractor - member annotations leave the existing facts as they were", () => {
  it("keeps functions[].annotations as bare names and classes[].annotationArguments without argument lines", () => {
    const result = structure(`@Named("t")
class Svc {
  @Autowired(required = false) @Qualifier("q") Dao dao;
  @Override public String toString() { return ""; }
}
`);
    expect(result.classes[0].annotationArguments).toEqual([
      { name: "Named", line: 1, arguments: [{ key: "value", value: "t" }] },
    ]);
    expect(result.functions[0].annotations).toEqual(["Override"]);
    expect(result.functions[0]).not.toHaveProperty("annotationArguments");
    expect(result.classes[0]).not.toHaveProperty("memberAnnotations");
  });
});
