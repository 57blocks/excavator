import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { JavaExtractor } from "../java-extractor.js";

// dead-code-detection, "Java call sites outside method and constructor
// bodies": method invocations, method references and object creations in
// field initializers (lambdas included), static and instance initializer
// blocks, enum constant arguments and record compact constructor bodies are
// call sites. Their caller is a sentinel no Java identifier can spell:
// `<clinit>` in a static context, `<init>` in an instance context. A site
// inside a method or constructor body keeps that method as its caller, even
// when the method belongs to an anonymous class in a field initializer.

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

function calls(code: string) {
  const parser = new Parser();
  parser.setLanguage(javaLang);
  const tree = parser.parse(code);
  const result = extractor.extractCallGraph(tree.rootNode);
  tree.delete();
  parser.delete();
  return result;
}

describe("JavaExtractor - call sites in a static context have the caller <clinit>", () => {
  it("a static field initializer: a method reference, a method call and an object creation", () => {
    expect(calls(`package p;
class Registry {
  static final Runnable HOOK = Cleaner::clean;
  static final int SIZE = compute(4);
  static final Box BOX = new Box();
  static int compute(int n) { return n; }
}
`)).toEqual([
      { caller: "<clinit>", callee: "clean", lineNumber: 3, receiver: { kind: "name", name: "Cleaner" }, argCount: null, enclosingType: "Registry" },
      { caller: "<clinit>", callee: "compute", lineNumber: 4, receiver: { kind: "none" }, argCount: 1, enclosingType: "Registry" },
      { caller: "<clinit>", callee: "new Box", lineNumber: 5, receiver: { kind: "construct", type: "Box" }, argCount: 0, enclosingType: "Registry" },
    ]);
  });

  it("a static initializer block", () => {
    expect(calls(`class Boot {
  static {
    register(Boot::start);
    Config.load();
  }
  static void start() {}
}
`)).toEqual([
      { caller: "<clinit>", callee: "register", lineNumber: 3, receiver: { kind: "none" }, argCount: 1, enclosingType: "Boot" },
      { caller: "<clinit>", callee: "start", lineNumber: 3, receiver: { kind: "name", name: "Boot" }, argCount: null, enclosingType: "Boot" },
      { caller: "<clinit>", callee: "Config.load", lineNumber: 4, receiver: { kind: "name", name: "Config" }, argCount: 0, enclosingType: "Boot" },
    ]);
  });

  it("enum constant arguments, with a method reference among them", () => {
    expect(calls(`enum Op {
  ADD(Math::addExact),
  NEG(Op::negate, weight(2));
  Op(java.util.function.IntBinaryOperator f) { remember(f); }
  Op(java.util.function.IntBinaryOperator f, int w) {}
  static int negate(int a, int b) { return -a; }
  static int weight(int w) { return w; }
}
`)).toEqual([
      { caller: "<clinit>", callee: "addExact", lineNumber: 2, receiver: { kind: "name", name: "Math" }, argCount: null, enclosingType: "Op" },
      { caller: "<clinit>", callee: "negate", lineNumber: 3, receiver: { kind: "name", name: "Op" }, argCount: null, enclosingType: "Op" },
      { caller: "<clinit>", callee: "weight", lineNumber: 3, receiver: { kind: "none" }, argCount: 1, enclosingType: "Op" },
      // A constructor body keeps its own caller.
      { caller: "Op", callee: "remember", lineNumber: 4, receiver: { kind: "none" }, argCount: 1, enclosingType: "Op" },
    ]);
  });

  it("interface and annotation type constants, which are static without saying so", () => {
    expect(calls(`interface Limits {
  int MAX = Integer.parseInt("5");
  java.util.Comparator<String> ORDER = String::compareTo;
}
@interface Tag {
  int SIZE = Sizes.of();
}
`)).toEqual([
      { caller: "<clinit>", callee: "Integer.parseInt", lineNumber: 2, receiver: { kind: "name", name: "Integer" }, argCount: 1, enclosingType: "Limits" },
      { caller: "<clinit>", callee: "compareTo", lineNumber: 3, receiver: { kind: "name", name: "String" }, argCount: null, enclosingType: "Limits" },
      { caller: "<clinit>", callee: "Sizes.of", lineNumber: 6, receiver: { kind: "name", name: "Sizes" }, argCount: 0, enclosingType: "Tag" },
    ]);
  });

  it("a lambda in a static field initializer: its parameters stay locals, typed or not", () => {
    expect(calls(`class Sorts {
  static final java.util.Comparator<Item> BY_KEY = (a, b) -> a.key().compareTo(b.key());
  static final java.util.function.Function<Item, String> KEY = (Item i) -> i.key();
}
`)).toEqual([
      { caller: "<clinit>", callee: "a.key().compareTo", lineNumber: 2, receiver: { kind: "call", site: 1 }, argCount: 1, enclosingType: "Sorts" },
      { caller: "<clinit>", callee: "a.key", lineNumber: 2, receiver: { kind: "local", type: null }, argCount: 0, enclosingType: "Sorts" },
      { caller: "<clinit>", callee: "b.key", lineNumber: 2, receiver: { kind: "local", type: null }, argCount: 0, enclosingType: "Sorts" },
      { caller: "<clinit>", callee: "i.key", lineNumber: 3, receiver: { kind: "local", type: "Item" }, argCount: 0, enclosingType: "Sorts" },
    ]);
  });
});

describe("JavaExtractor - call sites in an instance context have the caller <init>", () => {
  it("an instance field initializer", () => {
    expect(calls(`class Holder {
  private final java.util.List<String> xs = new java.util.ArrayList<>();
  private final int n = size(xs);
  private final Runnable r = this::run;
  void run() {}
  int size(java.util.List<String> l) { return 0; }
}
`)).toEqual([
      { caller: "<init>", callee: "new java.util.ArrayList<>", lineNumber: 2, receiver: { kind: "construct", type: "java.util.ArrayList<>" }, argCount: 0, enclosingType: "Holder" },
      { caller: "<init>", callee: "size", lineNumber: 3, receiver: { kind: "none" }, argCount: 1, enclosingType: "Holder" },
      { caller: "<init>", callee: "run", lineNumber: 4, receiver: { kind: "this" }, argCount: null, enclosingType: "Holder" },
    ]);
  });

  it("an instance initializer block, in a class and in an enum body", () => {
    expect(calls(`class Widget {
  { init(); }
  void init() {}
}
enum Mode {
  ON;
  { track(); }
  static { boot(); }
  void track() {}
  static void boot() {}
}
`)).toEqual([
      { caller: "<init>", callee: "init", lineNumber: 2, receiver: { kind: "none" }, argCount: 0, enclosingType: "Widget" },
      { caller: "<init>", callee: "track", lineNumber: 7, receiver: { kind: "none" }, argCount: 0, enclosingType: "Mode" },
      { caller: "<clinit>", callee: "boot", lineNumber: 8, receiver: { kind: "none" }, argCount: 0, enclosingType: "Mode" },
    ]);
  });

  it("a record compact constructor body", () => {
    expect(calls(`record Range(int lo, int hi) {
  Range {
    validate(lo, hi);
  }
  static void validate(int a, int b) {}
}
`)).toEqual([
      { caller: "<init>", callee: "validate", lineNumber: 3, receiver: { kind: "none" }, argCount: 2, enclosingType: "Range" },
    ]);
  });
});

describe("JavaExtractor - nested, anonymous and enum constant bodies outside a method", () => {
  it("an anonymous class in a field initializer: its fields are <init>, its methods keep their own caller", () => {
    expect(calls(`class Jobs {
  private final Runnable job = new Runnable() {
    int tries = start();
    public void run() { work(); }
  };
  static final Object LOCK = new Object() {
    final Object inner = make();
  };
}
`)).toEqual([
      { caller: "<init>", callee: "new Runnable", lineNumber: 2, receiver: { kind: "construct", type: "Runnable" }, argCount: 0, enclosingType: "Jobs" },
      { caller: "<init>", callee: "start", lineNumber: 3, receiver: { kind: "none" }, argCount: 0, enclosingType: null },
      { caller: "run", callee: "work", lineNumber: 4, receiver: { kind: "none" }, argCount: 0, enclosingType: null },
      { caller: "<clinit>", callee: "new Object", lineNumber: 6, receiver: { kind: "construct", type: "Object" }, argCount: 0, enclosingType: "Jobs" },
      { caller: "<init>", callee: "make", lineNumber: 7, receiver: { kind: "none" }, argCount: 0, enclosingType: null },
    ]);
  });

  it("a nested type's field initializers have no enclosing type", () => {
    expect(calls(`class Outer {
  static class Inner {
    static final Object A = make();
    final Object b = make();
    { make(); }
    static { make(); }
  }
}
`)).toEqual([
      { caller: "<clinit>", callee: "make", lineNumber: 3, receiver: { kind: "none" }, argCount: 0, enclosingType: null },
      { caller: "<init>", callee: "make", lineNumber: 4, receiver: { kind: "none" }, argCount: 0, enclosingType: null },
      { caller: "<init>", callee: "make", lineNumber: 5, receiver: { kind: "none" }, argCount: 0, enclosingType: null },
      { caller: "<clinit>", callee: "make", lineNumber: 6, receiver: { kind: "none" }, argCount: 0, enclosingType: null },
    ]);
  });

  it("an enum constant body: its fields are <init>, its methods keep their own caller", () => {
    expect(calls(`enum Shape {
  SQUARE(sides(4)) {
    final int corners = count();
    void draw() { paint(); }
  };
  Shape(int n) {}
  static int sides(int n) { return n; }
}
`)).toEqual([
      { caller: "<clinit>", callee: "sides", lineNumber: 2, receiver: { kind: "none" }, argCount: 1, enclosingType: "Shape" },
      { caller: "<init>", callee: "count", lineNumber: 3, receiver: { kind: "none" }, argCount: 0, enclosingType: null },
      { caller: "draw", callee: "paint", lineNumber: 4, receiver: { kind: "none" }, argCount: 0, enclosingType: null },
    ]);
  });

  it("a site inside a method keeps that method as its caller, however deep the initializer around it", () => {
    expect(calls(`class Svc {
  void run() {
    Object o = new Object() {
      final Object f = g();
      { h(); }
    };
  }
}
`)).toEqual([
      { caller: "run", callee: "new Object", lineNumber: 3, receiver: { kind: "construct", type: "Object" }, argCount: 0, enclosingType: "Svc" },
      { caller: "run", callee: "g", lineNumber: 4, receiver: { kind: "none" }, argCount: 0, enclosingType: null },
      { caller: "run", callee: "h", lineNumber: 5, receiver: { kind: "none" }, argCount: 0, enclosingType: null },
    ]);
  });

  it("a site no method or initializer contains (a type's annotation argument) is still recorded", () => {
    expect(calls(`@Ann(make())
class Odd {}
`)).toEqual([
      { caller: "<clinit>", callee: "make", lineNumber: 1, receiver: { kind: "none" }, argCount: 0, enclosingType: "Odd" },
    ]);
  });
});
