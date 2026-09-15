import type { FrameworkConfig } from "../types.js";

export const mauiConfig = {
  id: "maui",
  displayName: ".NET MAUI",
  languages: ["csharp"],
  detectionKeywords: ["UseMaui", "Microsoft.Maui.Controls", "Prism.Maui"],
  manifestFiles: ["*.csproj"],
  promptSnippetPath: "./frameworks/maui.md",
  entryPoints: ["MauiProgram.cs", "App.xaml.cs", "App.xaml"],
  layerHints: {
    views: "ui",
    viewmodels: "service",
    services: "service",
    models: "data",
  },
} satisfies FrameworkConfig;
