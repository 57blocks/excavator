import type { LanguageConfig } from "../types.js";

// Gherkin feature file (.feature, SpecFlow / Cucumber). Not code: parsed by
// feature-parser into Feature/Scenario sections and Given/When/Then steps.
export const featureConfig = {
  id: "feature",
  displayName: "Gherkin feature",
  extensions: [".feature"],
  concepts: ["features", "scenarios", "steps", "given/when/then", "examples"],
  filePatterns: {
    entryPoints: [],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
