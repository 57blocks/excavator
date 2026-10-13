import type { FrameworkConfig } from "../types.js";

export const jsfConfig = {
  id: "jsf",
  displayName: "JavaServer Faces",
  languages: ["java"],
  detectionKeywords: [
    "javax.faces",
    "jakarta.faces",
    "jsf-api",
    "jsf-impl",
    "myfaces",
    "primefaces",
    "richfaces",
    "icefaces",
    "faces-config",
  ],
  manifestFiles: [
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "ivy.xml",
    "faces-config.xml",
    "web.xml",
  ],
  promptSnippetPath: "./frameworks/jsf.md",
  entryPoints: ["**/WEB-INF/faces-config.xml"],
  layerHints: {
    webapp: "ui",
    pages: "ui",
    views: "ui",
    beans: "ui",
    converter: "utility",
    validator: "utility",
  },
} satisfies FrameworkConfig;
