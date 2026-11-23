import type { FrameworkConfig } from "../types.js";

export const reactConfig = {
  id: "react",
  displayName: "React",
  languages: ["typescript", "javascript"],
  detectionKeywords: ["react", "react-dom", "@types/react"],
  manifestFiles: ["package.json"],
  promptSnippetPath: "./frameworks/react.md",
  routes: {
    importSources: ["react-router", "react-router-dom"],
    kind: "ui",
    join: "nested",
    elements: {
      tags: ["Route"],
      pathAttribute: "path",
      indexAttribute: "index",
      handlerAttributes: ["element", "Component", "lazy"],
      rootTags: ["BrowserRouter", "HashRouter", "MemoryRouter", "Router"],
    },
    objects: {
      pathKey: "path",
      indexKey: "index",
      handlerKeys: ["element", "Component", "lazy"],
      childrenKey: "children",
      containerTypes: ["RouteObject"],
      rootFactories: ["createBrowserRouter", "createHashRouter", "createMemoryRouter"],
    },
  },
  entryPoints: ["src/App.tsx", "src/App.jsx", "src/index.tsx", "src/main.tsx"],
  layerHints: {
    components: "ui",
    hooks: "service",
    pages: "ui",
    contexts: "service",
    utils: "utility",
    lib: "service",
  },
} satisfies FrameworkConfig;
