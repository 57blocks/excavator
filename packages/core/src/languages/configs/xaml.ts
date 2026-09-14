import type { LanguageConfig } from "../types.js";

// XAML view markup (.xaml, WPF/MAUI). Not code: parsed by xaml-parser into the
// view section, x:Class code-behind link, x:DataType, and binding/command/x:Name
// definitions. Distinct from generic xml so files dispatch to the XAML parser.
export const xamlConfig = {
  id: "xaml",
  displayName: "XAML",
  extensions: [".xaml"],
  concepts: ["views", "x:Class", "data binding", "commands", "x:Name", "x:DataType"],
  filePatterns: {
    entryPoints: ["App.xaml"],
    barrels: [],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
