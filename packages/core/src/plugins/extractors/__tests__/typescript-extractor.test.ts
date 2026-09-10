import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { TypeScriptExtractor } from "../typescript-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + TypeScript grammar once
let Parser: any;
let Language: any;
let tsLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-typescript/tree-sitter-typescript.wasm",
  );
  tsLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(tsLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("TypeScriptExtractor", () => {
  const extractor = new TypeScriptExtractor();

  // Regression guard: a plain class is still extracted.
  it("extracts a plain class declaration", () => {
    const { tree, parser, root } = parse(`class Widget {
  run(): void {
    console.log("x");
  }
}
`);
    const result = extractor.extractStructure(root);
    expect(result.classes.some((c) => c.name === "Widget")).toBe(true);
    tree.delete();
    parser.delete();
  });

  // ---- Abstract classes ----

  describe("extractStructure - abstract classes", () => {
    it("extracts an abstract class as a class node with its concrete methods", () => {
      const { tree, parser, root } = parse(`abstract class Repository {
  abstract find(id: string): Promise<string>;
  save(value: string): void {
    this.items.push(value);
  }
  private items: string[] = [];
}
`);
      const result = extractor.extractStructure(root);

      const repo = result.classes.find((c) => c.name === "Repository");
      expect(repo).toBeDefined();
      expect(repo!.methods).toContain("save");
      // abstract method signatures (no body) are captured too
      expect(repo!.methods).toContain("find");

      tree.delete();
      parser.delete();
    });

    it("records an exported abstract class in exports", () => {
      const { tree, parser, root } = parse(`export abstract class Base {
  abstract run(): void;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes.some((c) => c.name === "Base")).toBe(true);
      const baseExport = result.exports.find((e) => e.name === "Base");
      expect(baseExport).toBeDefined();
      expect(baseExport!.isDefault).toBe(false);

      tree.delete();
      parser.delete();
    });
  });
  // Identity (design D2): a declaration is (path, owner, name). These cases
  // are the ones that used to collapse or disappear entirely.
  describe("extractStructure - owner and object literals", () => {
    it("reports object-literal methods and arrow properties owned by the binding", () => {
      const { tree, parser, root } = parse(`const api = {
  list() {
    return [];
  },
  get: (id: string) => id,
};
`);
      const result = extractor.extractStructure(root);
      const owned = result.functions.map((f) => `${f.owner}.${f.name}`);

      expect(owned).toContain("api.list");
      expect(owned).toContain("api.get");
      expect(result.functions).toHaveLength(2);

      tree.delete();
      parser.delete();
    });

    it("extends the owner path through nested object literals", () => {
      const { tree, parser, root } = parse(`export const api = {
  nested: {
    deep() {
      return 1;
    },
  },
};
`);
      const result = extractor.extractStructure(root);
      expect(result.functions.map((f) => `${f.owner}.${f.name}`)).toEqual([
        "api.nested.deep",
      ]);

      tree.delete();
      parser.delete();
    });

    it("reports class methods as anchored functions owned by the class", () => {
      const { tree, parser, root } = parse(`class Api {
  list(): string[] {
    return [];
  }

  get(id: string): string {
    return id;
  }
}
`);
      const result = extractor.extractStructure(root);
      const list = result.functions.find((f) => f.name === "list");

      expect(result.functions.map((f) => `${f.owner}.${f.name}`).sort()).toEqual([
        "Api.get",
        "Api.list",
      ]);
      // A method's anchor is its own line span, not the class's.
      expect(list!.lineRange).toEqual([2, 4]);
      expect(result.classes[0].methods.sort()).toEqual(["get", "list"]);

      tree.delete();
      parser.delete();
    });

    it("distinguishes two same-named callables in one file by owner", () => {
      const { tree, parser, root } = parse(`const api = {
  get: (id: string) => id,
};

class Api {
  get(id: string): string {
    return id;
  }
}
`);
      const result = extractor.extractStructure(root);
      const gets = result.functions.filter((f) => f.name === "get");

      expect(gets).toHaveLength(2);
      expect(gets.map((f) => f.owner).sort()).toEqual(["Api", "api"]);

      tree.delete();
      parser.delete();
    });

    it("leaves a free function and an arrow const without an owner", () => {
      const { tree, parser, root } = parse(`function free() {}
const alsoFree = () => 1;
`);
      const result = extractor.extractStructure(root);
      // `owner` is present only where a declaring scope exists, so its absence
      // is the statement "this is not a member".
      expect(result.functions.map((f) => [f.name, f.owner])).toEqual([
        ["free", undefined],
        ["alsoFree", undefined],
      ]);

      tree.delete();
      parser.delete();
    });
  });
});
