// dead-code-detection, task 2.1: every Java method reference is a call site.
// `X::m`, `expr::m`, `this::m` and `super::m` call `m` on a receiver
// described as an ordinary call of that shape would be; `X::new` constructs
// `X`; the argument count is unknown (`null`).
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

function calls(code: string) {
  const parser = new Parser();
  parser.setLanguage(javaLang);
  const tree = parser.parse(code);
  const result = extractor.extractCallGraph(tree.rootNode);
  tree.delete();
  parser.delete();
  return result;
}

/** The entry for the site written as `callee` on line `line`. */
function site(entries: ReturnType<typeof calls>, callee: string, line: number) {
  const found = entries.filter((e) => e.callee === callee && e.lineNumber === line);
  expect(found, `${callee}@${line}`).toHaveLength(1);
  return found[0];
}

describe("JavaExtractor - method references as call sites", () => {
  it("records each method reference form with the receiver an ordinary call of that shape gets", () => {
    const entries = calls(`class Svc extends Base {
  void run(Helper h, java.util.List<Loan> loans) {
    f(PlatformCache::isEhcacheEnabled);
    f(h::assist);
    f(this::go);
    f(super::go);
    f(this.helper::assist);
    f(java.util.Objects::isNull);
    f(java.util.List<String>::size);
    f(Mapper::<String>toData);
    f(make()::go);
    f(Iface.super::go);
    f(int[]::clone);
  }
}
`);
    const ref = (callee: string, line: number) => {
      const entry = site(entries, callee, line);
      expect(entry).toMatchObject({ caller: "run", argCount: null, enclosingType: "Svc" });
      return entry.receiver;
    };
    expect(ref("isEhcacheEnabled", 3)).toEqual({ kind: "name", name: "PlatformCache" });
    expect(ref("assist", 4)).toEqual({ kind: "local", type: "Helper" });
    expect(ref("go", 5)).toEqual({ kind: "this" });
    expect(ref("go", 6)).toEqual({ kind: "super" });
    expect(ref("assist", 7)).toEqual({ kind: "field", object: { kind: "this" }, name: "helper" });
    expect(ref("isNull", 8)).toEqual({
      kind: "field", object: { kind: "field", object: { kind: "name", name: "java" }, name: "util" }, name: "Objects",
    });
    expect(ref("size", 9)).toEqual({ kind: "type", type: "java.util.List<String>" });
    expect(ref("toData", 10)).toEqual({ kind: "name", name: "Mapper" });
    const make = entries.findIndex((e) => e.callee === "make" && e.lineNumber === 11);
    expect(entries[make]).toMatchObject({ argCount: 0, receiver: { kind: "none" } });
    expect(ref("go", 11)).toEqual({ kind: "call", site: make });
    // `X.super::m`, like `X.super.m()`, is not resolved.
    expect(ref("go", 12)).toEqual({ kind: "unknown" });
    expect(ref("clone", 13)).toEqual({ kind: "type", type: "int[]" });
  });

  it("records constructor references as construction of the named type, arrays included", () => {
    const entries = calls(`class Svc {
  void run() {
    f(LoanData::new);
    f(java.util.ArrayList<String>::new);
    f(Outer.Inner::new);
    f(int[]::new);
    f(String[][]::new);
  }
}
`);
    const ref = (callee: string, line: number) => {
      const entry = site(entries, callee, line);
      expect(entry).toMatchObject({ caller: "run", argCount: null, enclosingType: "Svc" });
      return entry.receiver;
    };
    expect(ref("new LoanData", 3)).toEqual({ kind: "construct", type: "LoanData" });
    expect(ref("new java.util.ArrayList<String>", 4)).toEqual({ kind: "construct", type: "java.util.ArrayList<String>" });
    expect(ref("new Outer.Inner", 5)).toEqual({ kind: "construct", type: "Outer.Inner" });
    expect(ref("new int[]", 6)).toEqual({ kind: "construct", type: "int[]" });
    expect(ref("new String[][]", 7)).toEqual({ kind: "construct", type: "String[][]" });
  });

  it("attributes a method reference inside a lambda to the enclosing method", () => {
    const entries = calls(`class Svc {
  void run(java.util.List<Loan> loans) {
    loans.forEach(l -> f(PlatformCache::isEhcacheEnabled));
    loans.stream().map(l -> l).map(Loan::principal);
  }
}
`);
    expect(site(entries, "isEhcacheEnabled", 3)).toMatchObject({
      caller: "run", argCount: null, enclosingType: "Svc", receiver: { kind: "name", name: "PlatformCache" },
    });
    expect(site(entries, "principal", 4)).toMatchObject({
      caller: "run", argCount: null, receiver: { kind: "name", name: "Loan" },
    });
  });

  it("does not resolve a local class through same-named types, except as an array", () => {
    const entries = calls(`class Svc {
  void run() {
    class Loan { void pay() {} }
    f(Loan::new);
    f(Loan::pay);
    f(Loan[]::new);
  }
}
`);
    expect(site(entries, "new Loan", 4).receiver).toEqual({ kind: "unknown" });
    expect(site(entries, "pay", 5).receiver).toEqual({ kind: "unknown" });
    expect(site(entries, "new Loan[]", 6).receiver).toEqual({ kind: "construct", type: "Loan[]" });
  });

  it("marks method references inside an anonymous class with no enclosing type", () => {
    const entries = calls(`class Svc {
  void run() {
    new Runnable() { public void run() { f(Helper::assist); } };
  }
}
`);
    expect(site(entries, "assist", 3)).toMatchObject({ argCount: null, enclosingType: null });
  });

  it("leaves ordinary call sites exactly as before", () => {
    const entries = calls(`class Svc {
  void run(Helper h) {
    h.assist(1);
    f(h::assist);
    new Loan(2);
  }
}
`);
    expect(entries.map((e) => [e.caller, e.callee, e.lineNumber, e.argCount])).toEqual([
      ["run", "h.assist", 3, 1],
      ["run", "f", 4, 1],
      ["run", "assist", 4, null],
      ["run", "new Loan", 5, 1],
    ]);
  });
});
