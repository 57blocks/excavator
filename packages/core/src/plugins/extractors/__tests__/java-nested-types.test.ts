// by-type-injection, task 1.1: the modifier keywords of every top-level Java
// type, and every type declared below top level (member, local and anonymous
// types at any depth, and types nested in a top-level annotation type), are
// recorded with the top-level type they are written in. Enum constant bodies
// are not recorded.
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

const nested = (code: string) => structure(code).nestedTypes;
const topLevelModifiers = (code: string) =>
  Object.fromEntries(structure(code).classes.map((c) => [c.name, c.modifiers]));

describe("JavaExtractor - modifiers of top-level types", () => {
  it("records the keywords of each kind of top-level type in source order", () => {
    expect(topLevelModifiers(`package p;
public abstract class A {}
final class B {}
public final strictfp class C {}
class D {}
public interface E {}
abstract interface F {}
public enum G { X }
public final record H(int a) {}
record I(int a) {}
public sealed interface J permits K, L {}
public non-sealed class K implements J {}
public sealed abstract class M permits N {}
public static final class N extends M {}
`)).toEqual({
      A: ["public", "abstract"],
      B: ["final"],
      C: ["public", "final", "strictfp"],
      D: [],
      E: ["public"],
      F: ["abstract"],
      G: ["public"],
      H: ["public", "final"],
      I: [],
      J: ["public", "sealed"],
      K: ["public", "non-sealed"],
      M: ["public", "sealed", "abstract"],
      N: ["public", "static", "final"],
    });
  });

  it("leaves annotations and comments out of the list, wherever they sit between keywords", () => {
    expect(topLevelModifiers(`@Entity
@Table(name = "loans", schema = "x")
public /* api */ @Deprecated final @SuppressWarnings("unchecked") class Loan {}

@Stateless @Local(Foo.class) abstract class Bean {}

@FunctionalInterface
interface Plain {}
`)).toEqual({
      Loan: ["public", "final"],
      Bean: ["abstract"],
      Plain: [],
    });
  });

  it("gives every top-level type row the field, empty when the declaration states no keyword", () => {
    const { classes } = structure(`class One {}
interface Two {}
enum Three { A }
record Four() {}
`);
    expect(classes.map((c) => [c.name, c.modifiers])).toEqual([
      ["One", []],
      ["Two", []],
      ["Three", []],
      ["Four", []],
    ]);
  });
});

describe("JavaExtractor - nested types: member types", () => {
  it("records a member class and a static nested class with their modifiers and supertypes", () => {
    expect(nested(`package p;
public class Outer {
  class Inner extends Base implements Port {}
  public static final class Nested<T extends Number>
      extends Base<T> {}
  private abstract static class Hidden {}
}
`)).toEqual([
      {
        kind: "class",
        name: "Inner",
        line: 3,
        owner: "Outer",
        local: false,
        modifiers: [],
        supertypes: [
          { relation: "extends", type: "Base", line: 3 },
          { relation: "implements", type: "Port", line: 3 },
        ],
      },
      {
        kind: "class",
        name: "Nested",
        line: 4,
        owner: "Outer",
        local: false,
        modifiers: ["public", "static", "final"],
        supertypes: [{ relation: "extends", type: "Base<T>", line: 5 }],
      },
      {
        kind: "class",
        name: "Hidden",
        line: 6,
        owner: "Outer",
        local: false,
        modifiers: ["private", "abstract", "static"],
        supertypes: [],
      },
    ]);
  });

  it("owns a type nested several levels deep by the top-level type, not by the type around it", () => {
    expect(nested(`class Outer {
  class A {
    class B {
      static class C {}
    }
  }
}
`)).toEqual([
      { kind: "class", name: "A", line: 2, owner: "Outer", local: false, modifiers: [], supertypes: [] },
      { kind: "class", name: "B", line: 3, owner: "Outer", local: false, modifiers: [], supertypes: [] },
      { kind: "class", name: "C", line: 4, owner: "Outer", local: false, modifiers: ["static"], supertypes: [] },
    ]);
  });

  it("records a nested interface, enum, record and annotation type with their kinds", () => {
    expect(nested(`public class Host {
  public interface Port extends Base, Closeable {}
  enum Mode implements Flag { A, B }
  record Pair(int left, int right) implements Comparable<Pair> {}
  @interface Marker {}
  public static record Point(int x) {}
}
`)).toEqual([
      {
        kind: "interface",
        name: "Port",
        line: 2,
        owner: "Host",
        local: false,
        modifiers: ["public"],
        supertypes: [
          { relation: "extends", type: "Base", line: 2 },
          { relation: "extends", type: "Closeable", line: 2 },
        ],
      },
      {
        kind: "enum",
        name: "Mode",
        line: 3,
        owner: "Host",
        local: false,
        modifiers: [],
        supertypes: [{ relation: "implements", type: "Flag", line: 3 }],
      },
      {
        kind: "record",
        name: "Pair",
        line: 4,
        owner: "Host",
        local: false,
        modifiers: [],
        supertypes: [{ relation: "implements", type: "Comparable<Pair>", line: 4 }],
      },
      { kind: "annotation", name: "Marker", line: 5, owner: "Host", local: false, modifiers: [], supertypes: [] },
      { kind: "record", name: "Point", line: 6, owner: "Host", local: false, modifiers: ["public", "static"], supertypes: [] },
    ]);
  });

  it("records the member types of an interface, an enum and a record body", () => {
    expect(nested(`interface Api { class Impl implements Api {} }
enum Kind { A; static class Helper {} }
record Box(int v) { interface Shape {} }
`)).toEqual([
      {
        kind: "class",
        name: "Impl",
        line: 1,
        owner: "Api",
        local: false,
        modifiers: [],
        supertypes: [{ relation: "implements", type: "Api", line: 1 }],
      },
      { kind: "class", name: "Helper", line: 2, owner: "Kind", local: false, modifiers: ["static"], supertypes: [] },
      { kind: "interface", name: "Shape", line: 3, owner: "Box", local: false, modifiers: [], supertypes: [] },
    ]);
  });

  it("records the name's line when the modifiers and annotations come on earlier lines", () => {
    expect(nested(`class Outer {
  @Deprecated
  @SuppressWarnings("x")
  public static
  class Late {}
}
`)).toEqual([
      { kind: "class", name: "Late", line: 5, owner: "Outer", local: false, modifiers: ["public", "static"], supertypes: [] },
    ]);
  });

  it("does not record the same type again for each nesting level above it", () => {
    const rows = nested(`class Outer { class A { class B {} } class C {} }`)!;
    expect(rows.map((t) => t.name)).toEqual(["A", "B", "C"]);
  });
});

describe("JavaExtractor - nested types: local classes", () => {
  it("records a class declared in a method, a constructor, an initializer block and a lambda body", () => {
    expect(nested(`class Svc {
  Svc() { class InConstructor {} }
  void run() {
    class InMethod implements Runnable { public void run() {} }
  }
  static { class InStaticBlock {} }
  { final class InInstanceBlock {} }
  Runnable r = () -> { abstract class InLambda {} };
}
`)).toEqual([
      { kind: "class", name: "InConstructor", line: 2, owner: "Svc", local: true, modifiers: [], supertypes: [] },
      {
        kind: "class",
        name: "InMethod",
        line: 4,
        owner: "Svc",
        local: true,
        modifiers: [],
        supertypes: [{ relation: "implements", type: "Runnable", line: 4 }],
      },
      { kind: "class", name: "InStaticBlock", line: 6, owner: "Svc", local: true, modifiers: [], supertypes: [] },
      { kind: "class", name: "InInstanceBlock", line: 7, owner: "Svc", local: true, modifiers: ["final"], supertypes: [] },
      { kind: "class", name: "InLambda", line: 8, owner: "Svc", local: true, modifiers: ["abstract"], supertypes: [] },
    ]);
  });

  it("records a local interface, enum and record", () => {
    expect(nested(`class Svc {
  void run() {
    interface Step {}
    enum Phase { ONE }
    record Pair(int a) {}
  }
}
`)).toEqual([
      { kind: "interface", name: "Step", line: 3, owner: "Svc", local: true, modifiers: [], supertypes: [] },
      { kind: "enum", name: "Phase", line: 4, owner: "Svc", local: true, modifiers: [], supertypes: [] },
      { kind: "record", name: "Pair", line: 5, owner: "Svc", local: true, modifiers: [], supertypes: [] },
    ]);
  });

  it("calls a member type of a local class local too: it is not reachable through member types alone", () => {
    expect(nested(`class Svc {
  class Member {}
  void run() {
    class Local { class Inside {} }
  }
}
`)).toEqual([
      { kind: "class", name: "Member", line: 2, owner: "Svc", local: false, modifiers: [], supertypes: [] },
      { kind: "class", name: "Local", line: 4, owner: "Svc", local: true, modifiers: [], supertypes: [] },
      { kind: "class", name: "Inside", line: 4, owner: "Svc", local: true, modifiers: [], supertypes: [] },
    ]);
  });

  it("owns a local class of a member type by the top-level type and keeps it local", () => {
    expect(nested(`class Outer {
  static class Worker {
    void go() { class Task extends Thread {} }
  }
}
`)).toEqual([
      { kind: "class", name: "Worker", line: 2, owner: "Outer", local: false, modifiers: ["static"], supertypes: [] },
      {
        kind: "class",
        name: "Task",
        line: 3,
        owner: "Outer",
        local: true,
        modifiers: [],
        supertypes: [{ relation: "extends", type: "Thread", line: 3 }],
      },
    ]);
  });
});

describe("JavaExtractor - nested types: anonymous classes", () => {
  it("records an anonymous class with the type written after new and the line of new", () => {
    expect(nested(`class Svc {
  Object plain = new Base() {};
  Object generic = new Handler<String>(1) {
    void handle() {}
  };
  Object qualified = new java.util.Comparator<String>() {
    public int compare(String a, String b) { return 0; }
  };
  Object diamond = new Handler<>() {};
}
`)).toEqual([
      anonymous("Base", 2, 2),
      anonymous("Handler<String>", 3, 3),
      anonymous("java.util.Comparator<String>", 6, 6),
      anonymous("Handler<>", 9, 9),
    ]);
  });

  it("puts the line of new, not the line of the receiver, on a qualified creation", () => {
    expect(nested(`class Svc {
  Object inner = outer
      .new Inner() {};
}
`)).toEqual([anonymous("Inner", 3, 3)]);
  });

  it("puts the type's own line on instantiates when new and the type are on different lines", () => {
    expect(nested(`class Svc {
  Object o = new
      Handler() {};
}
`)).toEqual([anonymous("Handler", 2, 3)]);
  });

  it("records an anonymous class in a method body and in a lambda, local like all anonymous classes", () => {
    expect(nested(`class Svc {
  void run() {
    Runnable a = new Runnable() { public void run() {} };
    Supplier<Object> s = () -> new Object() {};
  }
}
`)).toEqual([anonymous("Runnable", 3, 3), anonymous("Object", 4, 4)]);
  });

  it("records an anonymous class in an argument before the one that takes it, in order of new", () => {
    expect(nested(`class Svc {
  Object o = new Outer(new Argument() {}) {};
}
`)).toEqual([anonymous("Outer", 2, 2), anonymous("Argument", 2, 2)]);
  });

  it("does not record an object creation without a body", () => {
    expect(nested(`class Svc { Object o = new Base(); void run() { new Base().go(); } }`)).toEqual([]);
  });

  it("owns an anonymous class in a nested type by the top-level type", () => {
    expect(nested(`class Outer {
  static class Inner {
    Object o = new Base() {};
  }
}
`)).toEqual([
      { kind: "class", name: "Inner", line: 2, owner: "Outer", local: false, modifiers: ["static"], supertypes: [] },
      anonymous("Base", 3, 3, "Outer"),
    ]);
  });
});

describe("JavaExtractor - nested types: types nested in an anonymous class", () => {
  it("records a member class and an anonymous class inside an anonymous class, owned by the top-level type", () => {
    expect(nested(`class Host {
  Object o = new Base() {
    class Inside extends Helper {}
    Object deeper = new Other() {};
  };
}
`)).toEqual([
      anonymous("Base", 2, 2, "Host"),
      {
        kind: "class",
        name: "Inside",
        line: 3,
        owner: "Host",
        local: true,
        modifiers: [],
        supertypes: [{ relation: "extends", type: "Helper", line: 3 }],
      },
      anonymous("Other", 4, 4, "Host"),
    ]);
  });

  it("keeps a type after the anonymous class's body outside it", () => {
    expect(nested(`class Host {
  Object o = new Base() { class Inside {} };
  class After {}
}
`)).toEqual([
      anonymous("Base", 2, 2, "Host"),
      { kind: "class", name: "Inside", line: 2, owner: "Host", local: true, modifiers: [], supertypes: [] },
      { kind: "class", name: "After", line: 3, owner: "Host", local: false, modifiers: [], supertypes: [] },
    ]);
  });
});

describe("JavaExtractor - nested types: enum constant bodies and annotation types", () => {
  it("does not record an enum constant body, but records the types written in it", () => {
    expect(nested(`enum Op {
  PLUS(1) {
    class Helper {}
    int apply() { return 1; }
  },
  MINUS { },
  TIMES;
  static class Table {}
}
`)).toEqual([
      { kind: "class", name: "Helper", line: 3, owner: "Op", local: true, modifiers: [], supertypes: [] },
      { kind: "class", name: "Table", line: 8, owner: "Op", local: false, modifiers: ["static"], supertypes: [] },
    ]);
  });

  it("records the types nested in a top-level annotation type, which is not a classes entry", () => {
    const result = structure(`package p;
public @interface Config {
  class Holder implements Marker {}
  enum Mode { A }
  String name() default "x";
}
public class Other {}
`);
    expect(result.classes.map((c) => c.name)).toEqual(["Other"]);
    expect(result.nestedTypes).toEqual([
      {
        kind: "class",
        name: "Holder",
        line: 3,
        owner: "Config",
        local: false,
        modifiers: [],
        supertypes: [{ relation: "implements", type: "Marker", line: 3 }],
      },
      { kind: "enum", name: "Mode", line: 4, owner: "Config", local: false, modifiers: [], supertypes: [] },
    ]);
  });
});

describe("JavaExtractor - nested types: shape and order", () => {
  it("gives every row the field, empty when the file nests nothing", () => {
    expect(nested(`class Flat { void run() {} }`)).toEqual([]);
    expect(nested(``)).toEqual([]);
  });

  it("lists the types of several top-level types in source order, each under its own owner", () => {
    expect(nested(`class First {
  class A {}
}
class Second {
  void run() { class B {} }
  Object o = new Base() {};
}
interface Third {
  interface C {}
}
`)).toEqual([
      { kind: "class", name: "A", line: 2, owner: "First", local: false, modifiers: [], supertypes: [] },
      { kind: "class", name: "B", line: 5, owner: "Second", local: true, modifiers: [], supertypes: [] },
      anonymous("Base", 6, 6, "Second"),
      { kind: "interface", name: "C", line: 9, owner: "Third", local: false, modifiers: [], supertypes: [] },
    ]);
  });

  it("does not change what the structure row already says about the type and its members", () => {
    const result = structure(`package p;
public class Outer {
  static class Inner {}
  void run() { class L {} }
}
`);
    const outer = result.classes[0]!;
    expect(outer.memberTypes).toEqual(["Inner"]);
    expect(outer.methods).toEqual(["run"]);
    expect(result.classes.map((c) => c.name)).toEqual(["Outer"]);
  });
});

function anonymous(type: string, line: number, typeLine: number, owner = "Svc") {
  return {
    kind: "anonymous",
    name: null,
    line,
    owner,
    local: true,
    modifiers: [],
    supertypes: [],
    instantiates: { type, line: typeLine },
  };
}
