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

function structure(code: string, lang: "ts" | "js" = "ts") {
  const parser = new Parser();
  parser.setLanguage(langs[lang]);
  const tree = parser.parse(code);
  try {
    return new TypeScriptExtractor().extractStructure(tree.rootNode);
  } finally {
    tree.delete();
    parser.delete();
  }
}

describe("TypeScriptExtractor import bindings", () => {
  it("maps each local name to the name it imports", () => {
    const result = structure(`import Btn, { Card as C, Panel } from "./ui";\nimport * as Icons from "./icons";\nimport "./side-effect.css";\n`);
    expect(result.imports).toEqual([
      {
        source: "./ui",
        specifiers: ["Btn", "C", "Panel"],
        lineNumber: 1,
        bindings: [
          { local: "Btn", imported: "default" },
          { local: "C", imported: "Card" },
          { local: "Panel", imported: "Panel" },
        ],
      },
      { source: "./icons", specifiers: ["* as Icons"], lineNumber: 2, bindings: [{ local: "Icons", imported: "*" }] },
      { source: "./side-effect.css", specifiers: [], lineNumber: 3 },
    ]);
  });
});

describe("TypeScriptExtractor re-exports", () => {
  it("records every export ... from as an import with its forwarded names", () => {
    const result = structure(
      `export { Button, Card as Tile } from "./button";\nexport * from "./card";\nexport * as Icons from "./icons";\nexport { default as Badge } from "./badge";\n`,
    );
    expect(result.imports).toEqual([
      {
        source: "./button",
        specifiers: [],
        lineNumber: 1,
        reexports: [
          { exported: "Button", imported: "Button" },
          { exported: "Tile", imported: "Card" },
        ],
      },
      { source: "./card", specifiers: [], lineNumber: 2, reexports: [{ exported: "*", imported: "*" }] },
      { source: "./icons", specifiers: [], lineNumber: 3, reexports: [{ exported: "Icons", imported: "*" }] },
      { source: "./badge", specifiers: [], lineNumber: 4, reexports: [{ exported: "Badge", imported: "default" }] },
    ]);
    // The export entries a re-export clause already produced are unchanged
    // and carry no `local`: the names live in the source module.
    expect(result.exports).toEqual([
      { name: "Button", lineNumber: 1 },
      { name: "Tile", lineNumber: 1 },
      { name: "Badge", lineNumber: 4 },
    ]);
  });

  it("reads `default as` in the javascript grammar, where `default` is a keyword node", () => {
    const result = structure(`export { default as Badge } from "./badge";\n`, "js");
    expect(result.imports[0]?.reexports).toEqual([{ exported: "Badge", imported: "default" }]);
  });
});

describe("TypeScriptExtractor local export names", () => {
  it("records `local` only where the declaration's name differs from the exported name", () => {
    const result = structure(
      [
        "function Home() {}",
        "function Inner() {}",
        "export { Inner as Outer, Home };",
        "export default Home;",
        "export function Named() {}",
      ].join("\n"),
    );
    expect(result.exports).toEqual([
      { name: "Outer", lineNumber: 3, local: "Inner" },
      { name: "Home", lineNumber: 3 },
      { name: "default", lineNumber: 4, isDefault: true, local: "Home" },
      { name: "Named", lineNumber: 5, isDefault: false },
    ]);
  });

  it("names the declaration of a default-exported class", () => {
    const result = structure(`export default class Shell {}\n`);
    expect(result.exports).toEqual([{ name: "default", lineNumber: 1, isDefault: true, local: "Shell" }]);
  });

  it("keeps `export default function X` as name X and records no anonymous default value", () => {
    const result = structure(`export default function Page() {}\n`);
    expect(result.exports).toEqual([{ name: "Page", lineNumber: 1, isDefault: true }]);
    expect(structure(`export default memo(Page);\n`).exports).toEqual([]);
  });

  it("records `export { X as default }` as a default export of X", () => {
    const result = structure(`function Page() {}\nexport { Page as default };\n`);
    expect(result.exports).toEqual([{ name: "default", lineNumber: 2, local: "Page" }]);
  });
});
