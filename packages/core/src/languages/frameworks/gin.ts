import type { FrameworkConfig } from "../types.js";

export const ginConfig = {
  id: "gin",
  displayName: "Gin",
  languages: ["go"],
  detectionKeywords: ["github.com/gin-gonic/gin"],
  manifestFiles: ["go.mod"],
  promptSnippetPath: "./frameworks/gin.md",
  entryPoints: ["main.go", "cmd/server/main.go"],
  routes: {
    importSources: ["github.com/gin-gonic/gin"],
    kind: "http",
    join: "append",
    receivers: {
      rootFactories: ["gin.Default", "gin.New"],
      rootParamTypes: ["*gin.Engine"],
      prefixParamTypes: ["*gin.RouterGroup"],
      groupMethods: ["Group"],
    },
    calls: {
      verbs: {
        GET: "GET", POST: "POST", PUT: "PUT", PATCH: "PATCH", DELETE: "DELETE",
        HEAD: "HEAD", OPTIONS: "OPTIONS", Any: "ANY",
      },
      pathArgument: 0,
    },
  },
  layerHints: {
    handlers: "api",
    routes: "api",
    models: "data",
    middleware: "middleware",
    services: "service",
    repository: "data",
  },
} satisfies FrameworkConfig;
