import type { LanguageConfig } from "../types.js";

// MSBuild project file (.csproj). Not code: parsed by csproj-parser into
// dependency / target-framework / property definitions for the SOUP inventory.
export const csprojConfig = {
  id: "csproj",
  displayName: "MSBuild project (.csproj)",
  extensions: [".csproj"],
  concepts: ["package references", "target frameworks", "MSBuild properties", "project references"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
