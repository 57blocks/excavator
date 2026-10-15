// dead-code-detection, tasks 1.1 and 1.2: every Java method and constructor
// entry states its visibility, modifier keywords and annotation names, and
// every Java file lists its class literals with the context they sit in.
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

function facts(code: string) {
  return structure(code).functions.map((f) => [f.owner, f.name, f.visibility, f.modifiers, f.annotations]);
}

describe("JavaExtractor - method declaration facts", () => {
  it("records the four visibilities of class methods", () => {
    expect(facts(`class Svc {
  public void a() {}
  protected void b() {}
  void c() {}
  private void d() {}
}
`)).toEqual([
      ["Svc", "a", "public", [], []],
      ["Svc", "b", "protected", [], []],
      ["Svc", "c", "package", [], []],
      ["Svc", "d", "private", [], []],
    ]);
  });

  it("records a package-private static method", () => {
    expect(facts(`class Svc { static void helper() {} }
`)).toEqual([["Svc", "helper", "package", ["static"], []]]);
  });

  it("defaults interface members to public and records default and static methods", () => {
    expect(facts(`interface Port {
  void send(String s);
  default int fee(int x) { return x; }
  static Port none() { return null; }
  private void hidden() {}
  public abstract void close();
}
`)).toEqual([
      ["Port", "send", "public", [], []],
      ["Port", "fee", "public", ["default"], []],
      ["Port", "none", "public", ["static"], []],
      ["Port", "hidden", "private", [], []],
      ["Port", "close", "public", ["abstract"], []],
    ]);
  });

  it("records modifier keywords in source order and only the six it tracks", () => {
    expect(facts(`abstract class Base {
  public static final synchronized void a() {}
  final public static void b() {}
  protected abstract void c();
  private native void d();
  public strictfp void e() {}
}
`)).toEqual([
      ["Base", "a", "public", ["static", "final", "synchronized"], []],
      ["Base", "b", "public", ["final", "static"], []],
      ["Base", "c", "protected", ["abstract"], []],
      ["Base", "d", "private", ["native"], []],
      ["Base", "e", "public", [], []],
    ]);
  });

  it("records several method annotations in source order, without @ or package prefix", () => {
    expect(facts(`class Api {
  @GET @Path("/x") public Response list() { return null; }
  @org.x.Foo
  @Bar(value = 1)
  public @Override final String toString() { return ""; }
  @javax.ws.rs.POST @jakarta.annotation.security.RolesAllowed({"a"}) void create() {}
}
`)).toEqual([
      ["Api", "list", "public", [], ["GET", "Path"]],
      ["Api", "toString", "public", ["final"], ["Foo", "Bar", "Override"]],
      ["Api", "create", "package", [], ["POST", "RolesAllowed"]],
    ]);
  });

  it("leaves class annotations as written", () => {
    const cls = structure(`@org.x.Entity @Table(name = "t") class Loan { @org.x.Id Long id() { return null; } }
`).classes[0];
    expect(cls.annotations).toEqual(["org.x.Entity", "Table"]);
  });

  it("records visibility, modifiers and annotations of constructors", () => {
    expect(facts(`class Svc {
  public Svc() {}
  @Inject protected Svc(Repo repo) {}
  Svc(int x) {}
  private Svc(String s) {}
}
`)).toEqual([
      ["Svc", "Svc", "public", [], []],
      ["Svc", "Svc", "protected", [], ["Inject"]],
      ["Svc", "Svc", "package", [], []],
      ["Svc", "Svc", "private", [], []],
    ]);
  });

  it("gives an enum constructor without a modifier its implicit private visibility", () => {
    expect(facts(`enum Kind {
  A(1);
  Kind(int x) {}
  int code() { return 1; }
  public static Kind of(int x) { return A; }
}
`)).toEqual([
      ["Kind", "Kind", "private", [], []],
      ["Kind", "code", "package", [], []],
      ["Kind", "of", "public", ["static"], []],
    ]);
  });

  it("records the facts of record methods", () => {
    expect(facts(`public record Point(int x, int y) {
  public Point(int x) { this(x, 0); }
  static Point origin() { return null; }
}
`)).toEqual([
      ["Point", "Point", "public", [], []],
      ["Point", "origin", "package", ["static"], []],
    ]);
  });
});

describe("JavaExtractor - class literals", () => {
  it("records a class literal in an annotation argument and one in a method body", () => {
    const result = structure(`package p;
@Mapper(uses = Helper.class)
public interface LoanMapper {
  default Logger log() { return LoggerFactory.getLogger(LoanMapper.class); }
}
`);
    expect(result.classLiterals).toEqual([
      { type: "Helper", line: 2, context: "annotation" },
      { type: "LoanMapper", line: 4, context: "code" },
    ]);
  });

  it("treats array initializers, nested annotations and method or parameter annotations as annotation arguments", () => {
    const result = structure(`@Mapper(uses = {A.class, B.class}, config = @Config(C.class))
class M {
  @ExtendWith(D.class)
  @Import({E.class})
  void run(@Param(F.class) int y) {}
}
`);
    expect(result.classLiterals).toEqual([
      { type: "A", line: 1, context: "annotation" },
      { type: "B", line: 1, context: "annotation" },
      { type: "C", line: 1, context: "annotation" },
      { type: "D", line: 3, context: "annotation" },
      { type: "E", line: 4, context: "annotation" },
      { type: "F", line: 5, context: "annotation" },
    ]);
  });

  it("treats method bodies, field initializers, initializers and nested or anonymous types as code", () => {
    const result = structure(`class S {
  private static final Logger LOG = LoggerFactory.getLogger(S.class);
  static { register(Foo.class); }
  Object types() { return new Object[] { java.util.List.class, int.class, String[].class, Map.Entry.class }; }
  Runnable r = new Runnable() { public void run() { use(Bar.class); } };
  static class Inner { Class<?> k = Baz.class; }
}
`);
    expect(result.classLiterals).toEqual([
      { type: "S", line: 2, context: "code" },
      { type: "Foo", line: 3, context: "code" },
      { type: "java.util.List", line: 4, context: "code" },
      { type: "int", line: 4, context: "code" },
      { type: "String[]", line: 4, context: "code" },
      { type: "Map.Entry", line: 4, context: "code" },
      { type: "Bar", line: 5, context: "code" },
      { type: "Baz", line: 6, context: "code" },
    ]);
  });

  it("treats an annotation element's default value as an annotation argument", () => {
    const result = structure(`@interface Uses {
  Class<?> value() default Helper.class;
  Class<?>[] more() default {A.class};
}
`);
    expect(result.classLiterals).toEqual([
      { type: "Helper", line: 2, context: "annotation" },
      { type: "A", line: 3, context: "annotation" },
    ]);
  });

  it("gives a file without class literals an empty list", () => {
    expect(structure(`class A { void f() {} }
`).classLiterals).toEqual([]);
  });
});

// name-binding-references, task 1.1: a top-level type records every annotation
// with its line and arguments. A single string literal is read as its decoded
// value; every other way of writing an argument is a null value.
describe("JavaExtractor - type annotation arguments", () => {
  const uses = (code: string) => structure(code).classes[0].annotationArguments;

  it("records an annotation with no parentheses and one with empty parentheses as having no arguments", () => {
    expect(uses(`@Named
@Named()
class A {}
`)).toEqual([
      { name: "Named", line: 1, arguments: [] },
      { name: "Named", line: 2, arguments: [] },
    ]);
  });

  it("reads a single string literal as the `value` argument", () => {
    expect(uses(`@Named("x")
class A {}
`)).toEqual([{ name: "Named", line: 1, arguments: [{ key: "value", value: "x" }] }]);
  });

  it("reads an explicit `value = \"x\"` the same way", () => {
    expect(uses(`@Named(value = "x")
class A {}
`)).toEqual([{ name: "Named", line: 1, arguments: [{ key: "value", value: "x" }] }]);
  });

  it("keeps every key of a multi-argument annotation, a non-string literal being null", () => {
    expect(uses(`@ManagedBean(name = "x", eager = true)
class A {}
`)).toEqual([{
      name: "ManagedBean",
      line: 1,
      arguments: [{ key: "name", value: "x" }, { key: "eager", value: null }],
    }]);
  });

  it("gives a constant, a concatenation, an array, a class literal and a nested annotation a null value", () => {
    expect(uses(`@Named(Names.X)
@Named("a" + "b")
@Named({"a", "b"})
@Named(value = {"a"})
@Named(Helper.class)
@Named(name = @Foo("x"))
@Named(("x"))
@Named('c')
class A {}
`)).toEqual([
      { name: "Named", line: 1, arguments: [{ key: "value", value: null }] },
      { name: "Named", line: 2, arguments: [{ key: "value", value: null }] },
      { name: "Named", line: 3, arguments: [{ key: "value", value: null }] },
      { name: "Named", line: 4, arguments: [{ key: "value", value: null }] },
      // The class literal is also listed (by-type-injection): the value stays null.
      {
        name: "Named",
        line: 5,
        arguments: [{ key: "value", value: null, classLiterals: [{ type: "Helper", line: 5 }] }],
      },
      { name: "Named", line: 6, arguments: [{ key: "name", value: null }] },
      { name: "Named", line: 7, arguments: [{ key: "value", value: null }] },
      { name: "Named", line: 8, arguments: [{ key: "value", value: null }] },
    ]);
  });

  it("decodes escape sequences of a string literal", () => {
    const [use] = uses(String.raw`@Named("q\"uote\\nA\t\101")
class A {}
`)!;
    // \" quote, \\ backslash then n, A 'A', \t tab, \101 octal 'A'
    expect(use.arguments).toEqual([{ key: "value", value: 'q"uote\\nA\tA' }]);
  });

  it("gives a string literal with an escape it cannot decode a null value, not a guess", () => {
    expect(uses(String.raw`@Named("a\qb")
class A {}
`)![0].arguments).toEqual([{ key: "value", value: null }]);
  });

  it("gives a text block a null value", () => {
    expect(uses(`@Named("""
  x
  """)
class A {}
`)![0].arguments).toEqual([{ key: "value", value: null }]);
  });

  it("reads an empty string literal as an empty value", () => {
    expect(uses(`@Named("")
class A {}
`)![0].arguments).toEqual([{ key: "value", value: "" }]);
  });

  it("writes the name as written, including a fully-qualified one", () => {
    expect(uses(`@javax.inject.Named("x")
class A {}
`)).toEqual([{ name: "javax.inject.Named", line: 1, arguments: [{ key: "value", value: "x" }] }]);
  });

  it("takes the line the annotation starts on, whatever it spans", () => {
    expect(uses(`package p;

public
@Named(
  value =
    "multi")
@Entity class A {}
`)).toEqual([
      { name: "Named", line: 4, arguments: [{ key: "value", value: "multi" }] },
      { name: "Entity", line: 7, arguments: [] },
    ]);
  });

  it("ignores a comment between the parentheses", () => {
    expect(uses(`@Named(/* the name */ "x" /* end */)
class A {}
`)![0].arguments).toEqual([{ key: "value", value: "x" }]);
  });

  it("covers interfaces, enums and records, and leaves `annotations` as it was", () => {
    const result = structure(`@Named("i") interface I {}
@Named("e") enum E { A }
@Named("r") record R() {}
`);
    expect(result.classes.map((c) => [c.name, c.annotations, c.annotationArguments])).toEqual([
      ["I", ["Named"], [{ name: "Named", line: 1, arguments: [{ key: "value", value: "i" }] }]],
      ["E", ["Named"], [{ name: "Named", line: 2, arguments: [{ key: "value", value: "e" }] }]],
      ["R", ["Named"], [{ name: "Named", line: 3, arguments: [{ key: "value", value: "r" }] }]],
    ]);
  });

  it("gives an unannotated type an empty list and records nothing for nested types or members", () => {
    const result = structure(`class Outer {
  @Named("inner") static class Inner {}
  @Named("m") void run() {}
}
`);
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].annotationArguments).toEqual([]);
    expect(result.functions[0].annotations).toEqual(["Named"]);
    expect(result.functions[0]).not.toHaveProperty("annotationArguments");
  });
});
