import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { JavaExtractor } from "../java-extractor.js";

// dead-code-detection, "Java type hierarchy edges": a qualified name wrapped
// across lines, or with a comment inside it, is recorded as its dotted name.
// Whitespace and comments inside a name never reach the structure result, so
// the fact graph never compares a wrapped spelling against a plain one.

const require = createRequire(import.meta.url);

let Parser: any;
let Language: any;
let javaLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  javaLang = await Language.load(require.resolve("tree-sitter-java/tree-sitter-java.wasm"));
});

const extractor = new JavaExtractor();

function extract(code: string) {
  const parser = new Parser();
  parser.setLanguage(javaLang);
  const tree = parser.parse(code);
  const structure = extractor.extractStructure(tree.rootNode);
  const callGraph = extractor.extractCallGraph(tree.rootNode);
  tree.delete();
  parser.delete();
  return { structure, callGraph };
}

describe("JavaExtractor - wrapped qualified names in imports and the package", () => {
  it("records a single-type import wrapped across lines as its dotted name", () => {
    const { structure } = extract(`package p;
import com.acme.api.records
    .RegisterRequest;
class A {}
`);
    expect(structure.imports).toEqual([
      { source: "com.acme.api.records.RegisterRequest", specifiers: ["RegisterRequest"], lineNumber: 2 },
    ]);
  });

  it("records a wrapped static import as its dotted name", () => {
    const { structure } = extract(`package p;
import static com.acme.util
    .Checks
    .notNull;
class A {}
`);
    expect(structure.imports).toEqual([
      { source: "com.acme.util.Checks.notNull", specifiers: ["notNull"], lineNumber: 2, isStatic: true },
    ]);
  });

  it("records wrapped on-demand imports, static and not, as their dotted scope", () => {
    const { structure } = extract(`package p;
import com.acme
    .records.*;
import static com.acme.util
    .Checks.*;
class A {}
`);
    expect(structure.imports).toEqual([
      { source: "com.acme.records", specifiers: ["*"], lineNumber: 2 },
      { source: "com.acme.util.Checks", specifiers: ["*"], lineNumber: 4, isStatic: true },
    ]);
  });

  it("drops block and line comments inside a dotted import", () => {
    const { structure } = extract(`package p;
import com.acme /* legacy */ .records.Loan;
import com.acme // moved
    .records.Account;
class A {}
`);
    expect(structure.imports.map((i) => [i.source, i.specifiers])).toEqual([
      ["com.acme.records.Loan", ["Loan"]],
      ["com.acme.records.Account", ["Account"]],
    ]);
  });

  it("records a wrapped package declaration as its dotted name in every qualified name", () => {
    const { structure } = extract(`package com.acme
    /* split */ .loans;
public class LoanService {}
interface LoanPort {}
`);
    expect(structure.classes.map((c) => c.qualifiedName)).toEqual([
      "com.acme.loans.LoanService",
      "com.acme.loans.LoanPort",
    ]);
  });
});

describe("JavaExtractor - wrapped qualified names in type texts", () => {
  const WRAPPED = `package p;
@com.acme
    .Audited
public class Svc<T extends com.acme
    .Model> extends com.acme.base
    .BaseService implements com.acme
    .Port<java.util
    .List<String>> {
  private com.acme.records
      .Loan current;
  public com.acme.records
      .Loan handle(com.acme.records
      .Loan loan, java.util
      .Map<String, /* id */ Long> ids, com.acme
      .Item... items) { return loan; }
  <K extends com.acme
      .Key> void keyed(K key) {}
  void body(Object o) {
    com.acme.records
        .Loan local = (com.acme
        .Loan) o;
    local.pay();
    new com.acme
        .Loan(1).pay();
    if (o instanceof com.acme
        .Loan matched) { matched.pay(); }
    try { o.wait(); } catch (com.acme
        .Oops e) { e.report(); }
    Object k = com.acme
        .Loan.class;
    java.util.function.Supplier<Object> make = com.acme
        .Loan::new;
    java.util.function.Function<Object, Object> wrap = com.acme
        .Box<String>::of;
  }
}
`;

  it("records parameter, return, field and bound types without the wrapping", () => {
    const { structure } = extract(WRAPPED);
    const handle = structure.functions.find((f) => f.name === "handle")!;
    expect(handle.paramTypes).toEqual([
      "com.acme.records.Loan",
      "java.util.Map<String, Long>",
      "com.acme.Item...",
    ]);
    expect(handle.returnType).toBe("com.acme.records.Loan");
    const keyed = structure.functions.find((f) => f.name === "keyed")!;
    expect(keyed.paramTypes).toEqual(["com.acme.Key"]);
    expect(keyed.typeParameters).toEqual([{ name: "K", bound: "com.acme.Key" }]);
    const svc = structure.classes[0];
    expect(svc.fieldTypes).toEqual([{ name: "current", type: "com.acme.records.Loan" }]);
    expect(svc.typeParameters).toEqual([{ name: "T", bound: "com.acme.Model" }]);
    expect(svc.annotations).toEqual(["com.acme.Audited"]);
  });

  it("records supertypes and class literals without the wrapping", () => {
    const { structure } = extract(WRAPPED);
    expect(structure.classes[0].supertypes).toEqual([
      { relation: "extends", type: "com.acme.base.BaseService", line: 5 },
      { relation: "implements", type: "com.acme.Port<java.util.List<String>>", line: 6 },
    ]);
    expect(structure.classLiterals).toEqual([{ type: "com.acme.Loan", line: 29, context: "code" }]);
  });

  it("records receiver types and method-reference qualifiers without the wrapping", () => {
    const { callGraph } = extract(WRAPPED);
    const at = (callee: string) => {
      const found = callGraph.filter((e) => e.callee === callee);
      expect(found, callee).toHaveLength(1);
      return found[0];
    };
    expect(at("local.pay").receiver).toEqual({ kind: "local", type: "com.acme.records.Loan" });
    expect(at("matched.pay").receiver).toEqual({ kind: "local", type: "com.acme.Loan" });
    expect(at("e.report").receiver).toEqual({ kind: "local", type: "com.acme.Oops" });
    expect(callGraph.filter((e) => e.callee === "new com.acme.Loan").map((e) => [e.receiver, e.argCount])).toEqual([
      [{ kind: "construct", type: "com.acme.Loan" }, 1],
      [{ kind: "construct", type: "com.acme.Loan" }, null],
    ]);
    expect(at("of").receiver).toEqual({ kind: "type", type: "com.acme.Box<String>" });
    for (const entry of callGraph) {
      if (entry.receiver?.kind !== "call") expect(JSON.stringify(entry.receiver)).not.toMatch(/\\n|\/\*/);
    }
  });

  it("keeps other whitespace, strings and non-ASCII text of a rebuilt type as written", () => {
    const { structure } = extract(`class A {
  void f(java.util
      .Map<@Tag("é 😀 . x") String,   Long> m, com.acme
      .List</* é */ String> l) {}
}
`);
    expect(structure.functions[0].paramTypes).toEqual([
      'java.util.Map<@Tag("é 😀 . x") String,   Long>',
      "com.acme.List< String>",
    ]);
  });

  it("keeps the receiver of a call on a wrapped cast without the wrapping", () => {
    const { callGraph } = extract(`class A {
  void f(Object o) {
    ((com.acme
        .Loan) o).pay();
  }
}
`);
    expect(callGraph[0].receiver).toEqual({ kind: "type", type: "com.acme.Loan" });
  });
});

describe("JavaExtractor - sources with no wrapped names", () => {
  // Multi-line generics, chained calls across lines, comments outside names,
  // a string with " . " inside a type annotation: none of them is a wrapped
  // dotted name, so the output keeps its exact bytes from before qualified
  // names were rebuilt from their tokens.
  const UNWRAPPED = `package com.acme.loans;

import java.util.List;
import java.util.Map;
import static java.util.Objects.requireNonNull;
import java.util.concurrent.*;
import static org.junit.Assert.*;

/** A comment that is not inside any name. */
@Service(name = "svc", value = Helper.class)
public class LoanService<T extends java.io.Serializable> extends com.acme.base.BaseService<T>
    implements Comparable<LoanService<T>>, java.lang.Runnable {
  // field comment
  private final Map<String,
      List<Foo>> byKey = new java.util.HashMap<>();
  private int counts[];
  protected static final Logger LOG = LoggerFactory.getLogger(LoanService.class);

  public LoanService(@Nonnull List<@Pattern(regexp = "a . b") String> names, int... sizes) {
    super(names.size());
  }

  @Override
  public <K extends Comparable<K>> java.util.Optional<K> find(K key, java.util.Map.Entry<K, T> entry, String[] rest) throws java.io.IOException {
    List<Foo> foos = (List<Foo>) byKey.get("a");
    for (Foo f : foos) { f.run(); }
    try (java.io.InputStream in = open()) {
      in.read();
    } catch (java.io.IOException | RuntimeException e) {
      e.printStackTrace();
    } catch (IllegalStateException e) {
      e.getMessage();
    }
    if (key instanceof com.acme.Key k) { k.use(); }
    Runnable r = com.acme.Util::helper;
    java.util.function.Supplier<Foo> s = Foo::new;
    java.util.function.IntFunction<int[]> a = int[]::new;
    var made = new com.acme.Thing(1);
    made.go();
    long n = foos.stream()
        .map(x -> x)
        .count();
    Object c = java.util.List.class;
    requireNonNull(key);
    return java.util.Optional.empty();
  }

  public void run() { this.find(null, null, null); }

  public int compareTo(LoanService<T> other) { return 0; }

  enum Kind { A, B; void k() {} }

  interface Port { default void open() {} void close(); }

  record Pair(String left, java.util.List<String> right) {}
}

interface Api extends java.io.Closeable, Comparable<Api> {
  String NAME = "api";
  void call(java.util.Map<String, ? extends Number> args);
}
`;

  // Frozen from the extractor before qualified names were rebuilt from tokens,
  // then refrozen when call sites outside method bodies became recorded: the
  // only difference is the two field initializer sites (`new
  // java.util.HashMap<>` as `<init>`, `LoggerFactory.getLogger` as `<clinit>`),
  // and again when top-level types gained `annotationArguments`
  // (name-binding-references): with that one field removed the output hashes to
  // the previous value, 4605cbaac6df9e53...; and again when a Java file gained
  // `memberAnnotations` (annotation-injection-references): with that one field
  // removed the output hashes to the previous value, 809861bf0062d212....
  const UNWRAPPED_SHA256 = "8855a9412d14aaf60a667d4aff83fef6bdd72c8691d67c6dc780853dcf161aa2";

  it("produces byte-identical structure and call graph output", () => {
    const json = JSON.stringify(extract(UNWRAPPED));
    expect(json).toContain('"type":"Map<String,\\n      List<Foo>>"');
    expect(json).toContain('"callee":"foos.stream()\\n        .map(x -> x).count"');
    expect(json).toContain('"caller":"<clinit>","callee":"LoggerFactory.getLogger"');
    expect(createHash("sha256").update(json).digest("hex"), json).toBe(UNWRAPPED_SHA256);
  });
});
