import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { TypeScriptExtractor } from "../typescript-extractor.js";

const require = createRequire(import.meta.url);

let Parser: any;
const langs: Record<string, any> = {};

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  await Parser.init();
  langs.ts = await mod.Language.load(require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm"));
  langs.js = await mod.Language.load(require.resolve("tree-sitter-javascript/tree-sitter-javascript.wasm"));
});

/** Each call site as [line, callee, local]. */
function sites(code: string, lang: "ts" | "js") {
  const parser = new Parser();
  parser.setLanguage(langs[lang]);
  const tree = parser.parse(code);
  try {
    return new TypeScriptExtractor()
      .extractCallGraph(tree.rootNode)
      .map((entry) => [entry.lineNumber, entry.callee, entry.local === true]);
  } finally {
    tree.delete();
    parser.delete();
  }
}

const CODE = [
  `import { log, util } from "./logger";`,
  `import * as api from "./api";`,
  `function helper() {}`,
  `export function run(log, { fmt }, [first], ...rest) {`,
  `  log("a");`,
  `  fmt();`,
  `  first();`,
  `  rest();`,
  `  helper();`,
  `  util();`,
  `  api.get();`,
  `}`,
  `export function body(api) {`,
  `  api.get();`,
  `  const make = () => 1;`,
  `  make();`,
  `  function inner(log) {}`,
  `  inner();`,
  `  try { util(); } catch (util) { util(); }`,
  `  for (const step of []) step();`,
  `  this.save();`,
  `  log("b");`,
  `}`,
  `export const arrow = (helper) => helper();`,
  `export function nested() {`,
  `  return [1].map((log) => log());`,
  `}`,
  ``,
].join("\n");

describe("TypeScriptExtractor call sites an enclosing function binds", () => {
  it("marks a callee whose root a parameter or local binds, and no other", () => {
    expect(sites(CODE, "ts")).toEqual([
      [5, "log", true],
      [6, "fmt", true],
      [7, "first", true],
      [8, "rest", true],
      [9, "helper", false],
      [10, "util", false],
      [11, "api.get", false],
      [14, "api.get", true],
      [16, "make", true],
      [18, "inner", true],
      // A catch parameter counts for the whole function: the call before
      // the catch is marked too (a gap, never a wrong edge).
      [19, "util", true],
      [19, "util", true],
      [20, "step", true],
      [21, "this.save", false],
      // The parameter of the nested `inner` binds nothing in `body`.
      [22, "log", false],
      [24, "helper", true],
      // An array literal is no identifier to look up.
      [26, "[1].map", false],
      [26, "log", true],
    ]);
  });

  it("marks the same sites in the javascript grammar", () => {
    const js = [
      `const { log } = require("./logger");`,
      `function run(log) {`,
      `  log();`,
      `}`,
      `function direct() {`,
      `  log();`,
      `}`,
      ``,
    ].join("\n");
    expect(sites(js, "js")).toEqual([
      [3, "log", true],
      [6, "log", false],
    ]);
  });
});
