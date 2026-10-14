import type { LanguageConfig } from "../types.js";

// Facelets view (.xhtml). Markup with no structural extractor, like html.
export const xhtmlConfig = {
  id: "xhtml",
  displayName: "XHTML (Facelets)",
  extensions: [".xhtml"],
  concepts: ["facelets", "templates", "composition", "expression language", "components", "namespaces", "forms"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
