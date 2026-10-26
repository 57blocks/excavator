import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FONT_REQUESTS, fontsStylesheet, inlineFaces } from "../../../scripts/fonts.mjs";
import { EXPLORER_TEMPLATE, checkExplorerTemplate, checkNotices, upstreamNotice } from "../../../scripts/template.mjs";
import { NOTICE_HEADING } from "../../../scripts/licenses.mjs";

const LICENSE = readFileSync(new URL("../../../LICENSE.upstream", import.meta.url), "utf-8");
const THIRD_PARTY = `<!--\n${NOTICE_HEADING}\n${["react", "react-dom", "@xyflow/react", "elkjs", "d3-force", "@dagrejs/dagre", "zustand", "graphology", "react-markdown", "prism-react-renderer", "@fontsource/dm-serif-display", "@fontsource/inter", "@fontsource/jetbrains-mono"].map((n) => `${n} 1.0.0 MIT`).join("\n")}\n-->\n`;
const PAGE = `<head><meta charset="UTF-8" /><!-- xv:csp --><title>Excavator</title><style>a{}</style></head><body><!-- xv:data --><script type="module">1</script></body>`;
const good = () => upstreamNotice(LICENSE) + THIRD_PARTY + PAGE;

describe("the template's notices and contract", () => {
  it("accepts the upstream notice first, then the third-party list", () => {
    expect(checkExplorerTemplate([EXPLORER_TEMPLATE], good(), LICENSE)).toEqual([]);
  });

  it("rejects a template that starts with the third-party list", () => {
    const html = THIRD_PARTY + upstreamNotice(LICENSE) + PAGE;
    expect(checkExplorerTemplate([EXPLORER_TEMPLATE], html, LICENSE)).toContain(`${EXPLORER_TEMPLATE} does not start with the upstream MIT notice`);
  });

  it("rejects a template whose list lacks a bundled package", () => {
    const html = good().replace("zustand 1.0.0 MIT\n", "");
    expect(checkNotices(html, LICENSE)).toMatch(/does not list zustand/);
  });

  it("rejects a <link> tag, a second file and a missing data marker", () => {
    expect(checkExplorerTemplate([EXPLORER_TEMPLATE], good().replace("<title>", '<link rel="icon" href="x"><title>'), LICENSE).join("\n")).toMatch(/<link>/);
    expect(checkExplorerTemplate([EXPLORER_TEMPLATE, "x.js"], good(), LICENSE).join("\n")).toMatch(/more than explorer\.html/);
    expect(checkExplorerTemplate([EXPLORER_TEMPLATE], good().replace("<!-- xv:data -->", ""), LICENSE).join("\n")).toMatch(/xv:data/);
  });
});

describe("the inlined fonts", () => {
  const css = (subset: string, weight: number, file = `inter-${subset}-${weight}-normal.woff2`) =>
    `/* inter-${subset}-${weight}-normal */\n@font-face {\n  font-family: 'Inter';\n  font-style: normal;\n  font-display: swap;\n  font-weight: ${weight};\n  src: url(./files/${file}) format('woff2'), url(./files/x.woff) format('woff');\n  unicode-range: U+0000-00FF;\n}\n`;

  it("writes each wanted face as a data URL with its unicode-range and drops the other subsets", () => {
    const rules = inlineFaces(css("latin", 400) + css("vietnamese", 400) + css("cyrillic-ext", 400), ["latin", "cyrillic-ext"], () => new Uint8Array([1, 2, 3]));
    expect(rules).toHaveLength(2);
    expect(rules[0]).toContain("src: url(data:font/woff2;base64,AQID)");
    expect(rules[0]).toContain("unicode-range: U+0000-00FF;");
    expect(rules[0]).toContain("font-display: block;");
    expect(rules.join("")).not.toMatch(/https?:|\.\/files/);
  });

  it("fails when a requested (weight, subset) has no face", () => {
    const fake = (_root: string, file: string) => Buffer.from(file.endsWith(".css") ? css("latin", 400) : "x");
    expect(() => fontsStylesheet(fake, () => "root")).toThrow(/expected \d+ faces/);
  });

  it("builds one face per requested weight and subset from the installed packages", () => {
    const sheet = fontsStylesheet();
    const expected = FONT_REQUESTS.reduce((n, r) => n + r.weights.length * r.subsets.length, 0);
    expect(sheet.split("@font-face").length - 1).toBe(expected);
    expect(sheet).not.toMatch(/url\((?!data:)/);
  });
});
