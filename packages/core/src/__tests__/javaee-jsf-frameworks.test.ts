import { describe, it, expect } from "vitest";
import { FrameworkRegistry } from "../languages/framework-registry.js";
import { builtinFrameworkConfigs } from "../languages/frameworks/index.js";

const registry = FrameworkRegistry.createDefault();

function detect(files: Array<{ path: string; content: string }>) {
  return registry.detectWithEvidence(files);
}

function detectedIds(files: Array<{ path: string; content: string }>): string[] {
  return detect(files).map((d) => d.id);
}

describe("builtin framework configs", () => {
  it("registers javaee and jsf beside the existing frameworks", () => {
    expect(builtinFrameworkConfigs).toHaveLength(14);
    expect(registry.getAllFrameworks()).toHaveLength(14);
    expect(new Set(builtinFrameworkConfigs.map((c) => c.id)).size).toBe(14);
    expect(registry.getById("javaee")?.displayName).toBe("Java EE / Jakarta EE");
    expect(registry.getById("jsf")?.displayName).toBe("JavaServer Faces");
  });

  it("points every promptSnippetPath at the addendum named by the id", () => {
    for (const config of builtinFrameworkConfigs) {
      expect(config.promptSnippetPath, config.id).toBe(`./frameworks/${config.id}.md`);
    }
  });

  it("lists javaee for java and kotlin, jsf for java", () => {
    expect(registry.getForLanguage("java").map((c) => c.id)).toEqual(
      expect.arrayContaining(["spring", "javaee", "jsf"]),
    );
    expect(registry.getForLanguage("kotlin").map((c) => c.id)).toEqual(expect.arrayContaining(["javaee"]));
    expect(registry.getForLanguage("kotlin").map((c) => c.id)).not.toContain("jsf");
  });
});

describe("javaee config", () => {
  const javaee = registry.getById("javaee")!;

  it("declares the manifests, keywords, entry points and layer hints of the spec", () => {
    expect(javaee.manifestFiles).toEqual(["pom.xml", "build.gradle", "build.gradle.kts", "ivy.xml", "ejb-jar.xml"]);
    expect(javaee.detectionKeywords).toEqual([
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
    ]);
    expect(javaee.entryPoints).toEqual(
      expect.arrayContaining(["**/WEB-INF/web.xml", "**/META-INF/ejb-jar.xml", "**/META-INF/application.xml"]),
    );
    expect(javaee.layerHints).toMatchObject({
      ejb: "service",
      rest: "api",
      entity: "data",
      interceptor: "middleware",
    });
  });

  it("has no keyword for Servlet, JPA or JMS", () => {
    for (const keyword of javaee.detectionKeywords) {
      expect(keyword).not.toMatch(/servlet|persistence|jms/i);
    }
  });

  it("detects the Jakarta EE platform API from a pom", () => {
    const pom = [
      "<dependency>",
      "  <groupId>jakarta.platform</groupId>",
      "  <artifactId>jakarta.jakartaee-api</artifactId>",
      "</dependency>",
      "",
    ].join("\n");
    expect(detect([{ path: "pom.xml", content: pom }])).toEqual([
      { id: "javaee", manifests: 1, evidence: { path: "pom.xml", line: 3, keyword: "jakarta.jakartaee-api" } },
    ]);
  });

  it("detects an Ant project from its EJB descriptor alone", () => {
    const descriptor = '<?xml version="1.0"?>\n<ejb-jar version="3.0">\n</ejb-jar>\n';
    expect(detect([{ path: "resources/META-INF/ejb-jar.xml", content: descriptor }])).toEqual([
      {
        id: "javaee",
        manifests: 1,
        evidence: { path: "resources/META-INF/ejb-jar.xml", line: 2, keyword: "ejb-jar" },
      },
    ]);
  });

  it("detects a project that only uses JAX-RS", () => {
    const gradle = "dependencies {\n  implementation 'jakarta.ws.rs:jakarta.ws.rs-api:3.1.0'\n}\n";
    expect(detectedIds([{ path: "build.gradle", content: gradle }])).toEqual(["javaee"]);
  });

  it("detects the older platform, EJB, CDI and JAX-RS coordinates", () => {
    for (const keyword of ["javaee-api", "javaee-web-api", "javax.ejb", "jsr311-api", "cdi-api", "javax.enterprise"]) {
      const pom = `<artifactId>${keyword}</artifactId>\n`;
      expect(detectedIds([{ path: "m/pom.xml", content: pom }]), keyword).toEqual(["javaee"]);
    }
  });

  it("does not detect a project that only uses Servlet, JPA and JMS", () => {
    const pom = [
      "<artifactId>jakarta.servlet-api</artifactId>",
      "<artifactId>jakarta.persistence-api</artifactId>",
      "<artifactId>jakarta.jms-api</artifactId>",
      "<artifactId>javax.servlet-api</artifactId>",
      "<artifactId>persistence-api</artifactId>",
      "",
    ].join("\n");
    expect(detectedIds([{ path: "pom.xml", content: pom }])).toEqual([]);
  });

  it("does not detect a platform API that is only excluded or commented out", () => {
    const pom = [
      "<!-- <artifactId>javaee-api</artifactId> -->",
      "<exclusions><exclusion><artifactId>jakarta.jakartaee-api</artifactId></exclusion></exclusions>",
      "",
    ].join("\n");
    expect(detectedIds([{ path: "pom.xml", content: pom }])).toEqual([]);
  });
});

describe("jsf config", () => {
  const jsf = registry.getById("jsf")!;

  it("declares the manifests, keywords, entry points and layer hints of the spec", () => {
    expect(jsf.manifestFiles).toEqual([
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "ivy.xml",
      "faces-config.xml",
      "web.xml",
    ]);
    expect(jsf.detectionKeywords).toEqual([
      "javax.faces",
      "jakarta.faces",
      "jsf-api",
      "jsf-impl",
      "myfaces",
      "primefaces",
      "richfaces",
      "icefaces",
      "faces-config",
    ]);
    expect(jsf.entryPoints).toEqual(expect.arrayContaining(["**/WEB-INF/faces-config.xml"]));
    expect(jsf.layerHints).toMatchObject({
      webapp: "ui",
      beans: "ui",
      converter: "utility",
      validator: "utility",
    });
  });

  it("does not use resources as a layer hint (Maven's src/main/resources is not a JAX-RS layer)", () => {
    expect(Object.keys(registry.getById("javaee")!.layerHints ?? {})).not.toContain("resources");
    expect(Object.keys(jsf.layerHints ?? {})).not.toContain("resources");
  });

  it("detects a component library dependency", () => {
    const pom = "<dependency>\n  <groupId>org.primefaces</groupId>\n  <artifactId>primefaces</artifactId>\n</dependency>\n";
    expect(detect([{ path: "pom.xml", content: pom }])).toEqual([
      { id: "jsf", manifests: 1, evidence: { path: "pom.xml", line: 2, keyword: "primefaces" } },
    ]);
  });

  it("detects an Ant project from its faces-config.xml alone", () => {
    const descriptor = '<?xml version="1.0"?>\n<faces-config version="2.0">\n</faces-config>\n';
    expect(detect([{ path: "WEB-INF/faces-config.xml", content: descriptor }])).toEqual([
      { id: "jsf", manifests: 1, evidence: { path: "WEB-INF/faces-config.xml", line: 2, keyword: "faces-config" } },
    ]);
  });

  it("detects a web.xml that declares the FacesServlet, with the line", () => {
    const webXml = [
      "<web-app>",
      "  <servlet>",
      "    <servlet-name>faces</servlet-name>",
      "    <servlet-class>jakarta.faces.webapp.FacesServlet</servlet-class>",
      "  </servlet>",
      "</web-app>",
      "",
    ].join("\n");
    expect(detect([{ path: "src/main/webapp/WEB-INF/web.xml", content: webXml }])).toEqual([
      {
        id: "jsf",
        manifests: 1,
        evidence: { path: "src/main/webapp/WEB-INF/web.xml", line: 4, keyword: "jakarta.faces" },
      },
    ]);
  });

  it("does not detect a plain web.xml", () => {
    const webXml = [
      '<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee" version="4.0">',
      "  <servlet><servlet-name>orders</servlet-name><servlet-class>com.acme.orders.OrdersServlet</servlet-class></servlet>",
      "  <filter><filter-name>audit</filter-name><filter-class>com.acme.orders.AuditFilter</filter-class></filter>",
      "</web-app>",
      "",
    ].join("\n");
    expect(detectedIds([{ path: "WEB-INF/web.xml", content: webXml }])).toEqual([]);
  });

  it("detects the other component libraries and the older API coordinates", () => {
    for (const keyword of ["javax.faces", "jsf-api", "jsf-impl", "myfaces", "richfaces", "icefaces"]) {
      const pom = `<artifactId>${keyword}</artifactId>\n`;
      expect(detectedIds([{ path: "m/pom.xml", content: pom }]), keyword).toEqual(["jsf"]);
    }
  });

  it("does not detect a component library that is only commented out", () => {
    expect(detectedIds([{ path: "pom.xml", content: "<!-- <artifactId>primefaces</artifactId> -->\n" }])).toEqual([]);
  });
});

describe("javaee and jsf together", () => {
  it("reports both from different modules, sorted by id, with the manifests of each", () => {
    const detected = detect([
      { path: "web/pom.xml", content: "<artifactId>primefaces</artifactId>\n" },
      { path: "ejb/pom.xml", content: "<artifactId>jakarta.jakartaee-api</artifactId>\n" },
      { path: "ejb/src/META-INF/ejb-jar.xml", content: "<ejb-jar/>\n" },
      { path: "pom.xml", content: "<modules/>\n" },
    ]);
    expect(detected.map((d) => [d.id, d.manifests, d.evidence.path])).toEqual([
      ["javaee", 2, "ejb/pom.xml"],
      ["jsf", 1, "web/pom.xml"],
    ]);
  });
});
