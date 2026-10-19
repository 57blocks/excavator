import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { TypeScriptExtractor } from "../typescript-extractor.js";
import { isIntrinsicJsxName } from "../typescript-jsx.js";

const require = createRequire(import.meta.url);

let Parser: any;
const langs: Record<string, any> = {};

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  await Parser.init();
  langs.tsx = await mod.Language.load(require.resolve("tree-sitter-typescript/tree-sitter-tsx.wasm"));
  langs.ts = await mod.Language.load(require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm"));
  langs.js = await mod.Language.load(require.resolve("tree-sitter-javascript/tree-sitter-javascript.wasm"));
});

function jsx(code: string, lang: "tsx" | "ts" | "js") {
  const parser = new Parser();
  parser.setLanguage(langs[lang]);
  const tree = parser.parse(code);
  try {
    return new TypeScriptExtractor().extractStructure(tree.rootNode).jsx;
  } finally {
    tree.delete();
    parser.delete();
  }
}

const COMMON = [
  `import Btn from "./button";`,
  `import * as UI from "./ui";`,
  `export function Page() {`,
  `  return (`,
  `    <div className="p">`,
  `      <Btn />`,
  `      <UI.Panel.Header>title</UI.Panel.Header>`,
  `      <my-element />`,
  `      <svg:rect />`,
  `      <>`,
  `        <Card>body</Card>`,
  `      </>`,
  `    </div>`,
  `  );`,
  `}`,
].join("\n");

describe.each(["tsx", "js"] as const)("JSX elements (%s grammar)", (lang) => {
  it("records opening and self-closing tags with their lines, counts intrinsic ones, skips closing tags and fragments", () => {
    expect(jsx(COMMON, lang)).toEqual({
      elements: [
        { name: "Btn", lineNumber: 6 },
        { name: "UI.Panel.Header", lineNumber: 7 },
        { name: "Card", lineNumber: 11 },
      ],
      intrinsic: 3,
    });
  });

  it("marks a root name bound by a parameter, a destructured name, a local, a catch or a loop variable", () => {
    const code = [
      `import { Icon, Row, Item, Err, Loop, Inner, Outer, Fallback } from "./ui";`,
      `function List({ Icon, a: { Row }, b = Fallback }, [Item]) {`,
      `  const { Box } = props;`,
      `  try {} catch (Err) {}`,
      `  for (const Loop of xs) {}`,
      `  function Inner() { const Hidden = 1; return <Hidden />; }`,
      `  return <div><Icon /><Row /><Item /><Box /><Err /><Loop /><Inner /><Outer /><Fallback /><Hidden /></div>;`,
      `}`,
      `const Arrow = (P) => <P.X />;`,
    ].join("\n");
    const elements = jsx(code, lang)!.elements;
    const local = (name: string, line: number) =>
      elements.find((e) => e.name === name && e.lineNumber === line)?.local === true;
    for (const name of ["Icon", "Row", "Item", "Box", "Err", "Loop", "Inner"]) expect(local(name, 7), name).toBe(true);
    expect(local("P.X", 9)).toBe(true);
    // Bound inside the nested function, where its own element is local.
    expect(local("Hidden", 6)).toBe(true);
    // Bound only inside the nested function, by nothing, or only as a default value.
    for (const name of ["Hidden", "Outer", "Fallback"]) expect(local(name, 7), name).toBe(false);
  });

  it("records an element at the top level of the module", () => {
    expect(jsx(`const routes = [<Home key="h" />];\n`, lang)).toEqual({ elements: [{ name: "Home", lineNumber: 1 }], intrinsic: 0 });
  });

  it("records nothing for a file without JSX", () => {
    expect(jsx(`export function f() { return 1 < 2; }\n`, lang)).toBeUndefined();
  });
});

describe("JSX elements, grammar specifics", () => {
  it("reads a tag with type arguments by its name (tsx)", () => {
    expect(jsx(`function P() { return <Select<string> value="a" />; }\n`, "tsx")!.elements).toEqual([{ name: "Select", lineNumber: 1 }]);
  });

  it("records no JSX for a .ts file, whose grammar has none", () => {
    expect(jsx(`function f<T>(x: T) { return <T>x; }\n`, "ts")).toBeUndefined();
  });

  it("flags a tag the javascript grammar recovered from an error, whatever name it reports", () => {
    // tree-sitter-javascript cannot parse `<this.Foo/>` and recovers it as a
    // tag named `Foo`, which may not resolve to what the source refers to.
    const elements = jsx(`function T() { return <div><this.Foo /><X /></div>; }\n`, "js")!.elements;
    expect(elements.find((e) => e.name !== "X")).toMatchObject({ syntaxError: true });
    expect(elements.find((e) => e.name === "X")).toEqual({ name: "X", lineNumber: 1 });
  });

  it("reads `<this.Foo/>` as a member tag in the tsx grammar", () => {
    expect(jsx(`function T() { return <this.Foo />; }\n`, "tsx")!.elements).toEqual([{ name: "this.Foo", lineNumber: 1 }]);
  });
});

describe("isIntrinsicJsxName", () => {
  it("follows React: lowercase, hyphenated and namespaced tags are host elements; member tags never are", () => {
    for (const name of ["div", "my-element", "svg:rect", "x"]) expect(isIntrinsicJsxName(name), name).toBe(true);
    for (const name of ["Button", "motion.div", "UI.Button", "_Private", "$Comp", "this.Foo"]) expect(isIntrinsicJsxName(name), name).toBe(false);
  });
});
