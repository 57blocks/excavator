import type { FrameworkConfig } from "../types.js";

// Servlet, JPA and JMS are deliberately not keywords: they are just as common
// in Spring and plain Java projects, which would receive guidance that does
// not apply to them.
export const javaeeConfig = {
  id: "javaee",
  displayName: "Java EE / Jakarta EE",
  languages: ["java", "kotlin"],
  detectionKeywords: [
    "javaee-api",
    "javaee-web-api",
    "jakarta.jakartaee-api",
    "jakarta.jakartaee-web-api",
    "javax.ejb",
    "jakarta.ejb",
    "javax.ws.rs",
    "jakarta.ws.rs",
    "jsr311-api",
    "cdi-api",
    "javax.enterprise",
    "jakarta.enterprise",
    "ejb-jar",
  ],
  manifestFiles: ["pom.xml", "build.gradle", "build.gradle.kts", "ivy.xml", "ejb-jar.xml"],
  promptSnippetPath: "./frameworks/javaee.md",
  entryPoints: ["**/WEB-INF/web.xml", "**/META-INF/ejb-jar.xml", "**/META-INF/application.xml"],
  layerHints: {
    ejb: "service",
    service: "service",
    rest: "api",
    resource: "api",
    entity: "data",
    model: "data",
    dao: "data",
    interceptor: "middleware",
    filter: "middleware",
  },
} satisfies FrameworkConfig;
