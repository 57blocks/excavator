import type { FrameworkConfig } from "../types.js";

export const angularConfig = {
  id: "angular",
  displayName: "Angular",
  languages: ["typescript"],
  detectionKeywords: ["@angular/core", "@angular/cli", "@angular-devkit"],
  manifestFiles: ["package.json", "angular.json"],
  promptSnippetPath: "./frameworks/angular.md",
  entryPoints: ["src/main.ts", "src/app/app.module.ts"],
  layerHints: {
    components: "ui",
    pages: "ui",
    directives: "ui",
    services: "service",
    guards: "service",
    interceptors: "service",
    resolvers: "service",
    store: "service",
    effects: "service",
    pipes: "utility",
    modules: "config",
  },
} satisfies FrameworkConfig;
