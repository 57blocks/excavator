import { describe, it, expect } from "vitest";
import { FrameworkRegistry } from "../languages/framework-registry.js";
import type { FrameworkConfig } from "../languages/types.js";
import { springConfig } from "../languages/frameworks/spring.js";
import { djangoConfig } from "../languages/frameworks/django.js";
import { mauiConfig } from "../languages/frameworks/maui.js";

// Purpose-built configs so the scenarios do not depend on any builtin keyword list.
const platform: FrameworkConfig = {
  id: "platform",
  displayName: "Platform",
  languages: ["java"],
  detectionKeywords: ["jakarta.jakartaee-api", "ejb-jar"],
  manifestFiles: ["pom.xml", "build.gradle", "ejb-jar.xml"],
  promptSnippetPath: "./frameworks/platform.md",
};
const faces: FrameworkConfig = {
  id: "faces",
  displayName: "Faces",
  languages: ["java"],
  detectionKeywords: ["primefaces", "jsf-api"],
  manifestFiles: ["pom.xml"],
  promptSnippetPath: "./frameworks/faces.md",
};

function registryOf(...configs: FrameworkConfig[]): FrameworkRegistry {
  const registry = new FrameworkRegistry();
  for (const config of configs) registry.register(config);
  return registry;
}

/** A pom whose `<artifactId>` declaration of `artifactId` sits on line `line`. */
function pomWithDeclarationAt(line: number, artifactId: string): string {
  const filler = Array.from({ length: line - 1 }, (_, i) => `<name>filler-${i + 1}</name>`);
  return [...filler, `<artifactId>${artifactId}</artifactId>`, ""].join("\n");
}

describe("FrameworkRegistry.detectWithEvidence: manifest participation", () => {
  it("detects a framework declared only in a submodule manifest, with its line", () => {
    const registry = registryOf(platform);
    const detected = registry.detectWithEvidence([
      { path: "pom.xml", content: "<project>\n<modules><module>orders</module></modules>\n</project>\n" },
      { path: "orders/pom.xml", content: pomWithDeclarationAt(31, "jakarta.jakartaee-api") },
    ]);
    expect(detected).toEqual([
      {
        id: "platform",
        manifests: 1,
        evidence: { path: "orders/pom.xml", line: 31, keyword: "jakarta.jakartaee-api" },
      },
    ]);
  });

  it("takes the first file in stable path order as evidence and counts every hit file", () => {
    const registry = registryOf(springConfig);
    const detected = registry.detectWithEvidence([
      { path: "b/pom.xml", content: "<groupId>org.springframework</groupId>\n" },
      { path: "a/pom.xml", content: "\n<groupId>org.springframework</groupId>\n" },
    ]);
    expect(detected).toHaveLength(1);
    expect(detected[0].id).toBe("spring");
    expect(detected[0].manifests).toBe(2);
    expect(detected[0].evidence).toEqual({ path: "a/pom.xml", line: 2, keyword: "org.springframework" });
  });

  it("orders paths by UTF-16 code unit, not by locale", () => {
    const registry = registryOf(springConfig);
    const detected = registry.detectWithEvidence([
      { path: "a/pom.xml", content: "org.springframework\n" },
      { path: "B/pom.xml", content: "org.springframework\n" },
    ]);
    // "B" (0x42) sorts before "a" (0x61) by code unit; localeCompare would say the opposite.
    expect(detected[0].evidence.path).toBe("B/pom.xml");
  });

  it("returns the same result for every input order", () => {
    const registry = registryOf(springConfig, platform, faces);
    const files = [
      { path: "z/pom.xml", content: "<artifactId>primefaces</artifactId>\n" },
      { path: "m/pom.xml", content: "<artifactId>spring-boot</artifactId>\n<artifactId>primefaces</artifactId>\n" },
      { path: "a/ejb-jar.xml", content: "<ejb-jar/>\n" },
      { path: "a/pom.xml", content: "nothing\n<artifactId>jakarta.jakartaee-api</artifactId>\n" },
      { path: "b/build.gradle", content: "implementation 'org.springframework:spring-core:6'\n" },
    ];
    const baseline = registry.detectWithEvidence(files);
    expect(baseline.map((d) => d.id)).toEqual(["faces", "platform", "spring"]);
    const orders = [
      [...files].reverse(),
      [files[2], files[4], files[0], files[3], files[1]],
      [files[1], files[0], files[3], files[4], files[2]],
    ];
    for (const order of orders) expect(registry.detectWithEvidence(order)).toEqual(baseline);
  });

  it("does not mutate the input array", () => {
    const registry = registryOf(springConfig);
    const files = [
      { path: "b/pom.xml", content: "org.springframework\n" },
      { path: "a/pom.xml", content: "org.springframework\n" },
    ];
    registry.detectWithEvidence(files);
    expect(files.map((f) => f.path)).toEqual(["b/pom.xml", "a/pom.xml"]);
  });

  it("reports nothing without manifests or without a keyword in them", () => {
    const registry = registryOf(springConfig, platform);
    expect(registry.detectWithEvidence([])).toEqual([]);
    expect(
      registry.detectWithEvidence([{ path: "pom.xml", content: "<project><artifactId>plain</artifactId></project>\n" }]),
    ).toEqual([]);
  });

  it("ignores a file that is not a declared manifest, even when it contains a keyword", () => {
    const registry = registryOf(springConfig);
    expect(
      registry.detectWithEvidence([
        { path: "docs/notes.txt", content: "org.springframework\n" },
        { path: "src/pom.xml.bak", content: "org.springframework\n" },
        { path: "mypom.xml", content: "org.springframework\n" },
      ]),
    ).toEqual([]);
  });

  it("matches an exact name, a path suffix and a *.ext manifest", () => {
    const registry = registryOf(platform, mauiConfig);
    const detected = registry.detectWithEvidence([
      { path: "ejb-jar.xml", content: "<ejb-jar/>" },
      { path: "src/App/App.csproj", content: "<UseMaui>true</UseMaui>" },
    ]);
    expect(detected.map((d) => [d.id, d.evidence.path])).toEqual([
      ["maui", "src/App/App.csproj"],
      ["platform", "ejb-jar.xml"],
    ]);
  });

  it("sorts the result by id, not by registration order", () => {
    const registry = registryOf(springConfig, djangoConfig);
    const detected = registry.detectWithEvidence([
      { path: "pom.xml", content: "org.springframework" },
      { path: "requirements.txt", content: "django==4.2" },
    ]);
    expect(detected.map((d) => d.id)).toEqual(["django", "spring"]);
  });
});

describe("FrameworkRegistry.detectWithEvidence: keywords and evidence", () => {
  it("matches keywords case-insensitively and reports the keyword as configured", () => {
    const registry = registryOf(mauiConfig);
    const detected = registry.detectWithEvidence([{ path: "A.csproj", content: "<USEMAUI>true</USEMAUI>" }]);
    expect(detected[0].evidence.keyword).toBe("UseMaui");
  });

  it("picks the earliest hit in the file whichever keyword it is", () => {
    const registry = registryOf(faces);
    const detected = registry.detectWithEvidence([
      { path: "pom.xml", content: "<x/>\n<artifactId>jsf-api</artifactId>\n<y/>\n<artifactId>primefaces</artifactId>\n" },
    ]);
    // `primefaces` is listed first in the config, but `jsf-api` comes first in the file.
    expect(detected[0].evidence).toEqual({ path: "pom.xml", line: 2, keyword: "jsf-api" });
  });

  it("breaks a tie at the same position by keyword order in the config", () => {
    const content = "<artifactId>spring-boot-starter-web</artifactId>\n";
    const shortFirst = registryOf({ ...springConfig, detectionKeywords: ["spring-boot", "spring-boot-starter"] });
    const longFirst = registryOf({ ...springConfig, detectionKeywords: ["spring-boot-starter", "spring-boot"] });
    expect(shortFirst.detectWithEvidence([{ path: "pom.xml", content }])[0].evidence.keyword).toBe("spring-boot");
    expect(longFirst.detectWithEvidence([{ path: "pom.xml", content }])[0].evidence.keyword).toBe("spring-boot-starter");
  });

  it("counts a manifest once however many keywords it contains", () => {
    const registry = registryOf(faces);
    const detected = registry.detectWithEvidence([
      { path: "pom.xml", content: "primefaces\njsf-api\nprimefaces\n" },
    ]);
    expect(detected[0].manifests).toBe(1);
  });

  it("numbers lines from 1 and keeps them under CRLF and non-ASCII text", () => {
    const registry = registryOf(springConfig);
    const crlf = registry.detectWithEvidence([{ path: "pom.xml", content: "a\r\nb\r\norg.springframework\r\n" }]);
    expect(crlf[0].evidence.line).toBe(3);
    // U+0130 lower-cases to two code units; the line must still be the original one.
    const wide = registry.detectWithEvidence([{ path: "pom.xml", content: "İİ\nİ\norg.springframework\n" }]);
    expect(wide[0].evidence.line).toBe(3);
    const first = registry.detectWithEvidence([{ path: "pom.xml", content: "org.springframework" }]);
    expect(first[0].evidence.line).toBe(1);
  });
});

describe("FrameworkRegistry.detectWithEvidence: comments and exclusions do not count", () => {
  it("does not count a Maven exclusion", () => {
    const registry = registryOf(springConfig);
    const pom = [
      "<dependency>",
      "  <artifactId>widget</artifactId>",
      "  <exclusions>",
      "    <exclusion>",
      "      <groupId>org.springframework</groupId>",
      "      <artifactId>spring-core</artifactId>",
      "    </exclusion>",
      "  </exclusions>",
      "</dependency>",
      "",
    ].join("\n");
    expect(registry.detectWithEvidence([{ path: "pom.xml", content: pom }])).toEqual([]);
  });

  it("counts the files that really declare it when another only excludes it", () => {
    const registry = registryOf(springConfig);
    const detected = registry.detectWithEvidence([
      { path: "a/pom.xml", content: "<exclusions><exclusion><groupId>org.springframework</groupId></exclusion></exclusions>\n" },
      { path: "b/pom.xml", content: "<groupId>org.springframework</groupId>\n" },
    ]);
    expect(detected[0].manifests).toBe(1);
    expect(detected[0].evidence.path).toBe("b/pom.xml");
  });

  it("does not count a commented-out dependency", () => {
    const registry = registryOf(faces);
    expect(
      registry.detectWithEvidence([{ path: "pom.xml", content: "<!-- <artifactId>primefaces</artifactId> -->\n" }]),
    ).toEqual([]);
  });

  it("does not count a Gradle exclude statement", () => {
    const registry = registryOf(springConfig);
    const gradle = "implementation('x:y:1') {\n  exclude group: 'org.springframework.boot'\n}\n";
    expect(registry.detectWithEvidence([{ path: "build.gradle", content: gradle }])).toEqual([]);
  });

  it("does not let a glob inside a string hide the declarations after it", () => {
    const registry = registryOf(springConfig);
    const gradle = [
      "plugins {",
      "  id 'java'",
      "}",
      "",
      "include '**/*.java'",
      "",
      "dependencies {",
      "  // runtime",
      "  implementation 'org.springframework:spring-core:5.3.0'",
      "}",
      "",
    ].join("\n");
    // the glob opens a `/*` for a scanner that ignores strings, and nothing after it closes it
    expect(gradle.indexOf("*/", gradle.indexOf("/*") + 2)).toBe(-1);
    expect(registry.detectWithEvidence([{ path: "build.gradle", content: gradle }])).toEqual([
      { id: "spring", manifests: 1, evidence: { path: "build.gradle", line: 9, keyword: "org.springframework" } },
    ]);
  });

  it("does not count a dependency left in an exclusions element by an end tag inside a comment", () => {
    const registry = registryOf(springConfig);
    const pom = [
      "<dependency>",
      "  <artifactId>widget</artifactId>",
      "  <exclusions>",
      "    <!-- </exclusions> -->",
      "    <exclusion><groupId>org.springframework</groupId></exclusion>",
      "  </exclusions>",
      "</dependency>",
      "",
    ].join("\n");
    expect(registry.detectWithEvidence([{ path: "pom.xml", content: pom }])).toEqual([]);
  });

  it("does not count a dependency inside a block comment that opens at the end of an exclude line", () => {
    const registry = registryOf(springConfig);
    const gradle = [
      "exclude group: 'x' /* old",
      "implementation 'org.springframework:spring-core:5.3.0'",
      "*/",
      "",
    ].join("\n");
    expect(registry.detectWithEvidence([{ path: "build.gradle", content: gradle }])).toEqual([]);
  });

  it("counts a declaration after a commented one and keeps its line", () => {
    const registry = registryOf(faces);
    const lines = Array.from({ length: 50 }, () => "<x/>");
    lines[9] = "<!-- <artifactId>primefaces</artifactId> -->";
    lines[39] = "<artifactId>primefaces</artifactId>";
    const detected = registry.detectWithEvidence([{ path: "pom.xml", content: lines.join("\n") }]);
    expect(detected[0].evidence).toEqual({ path: "pom.xml", line: 40, keyword: "primefaces" });
  });

  it("keeps the line of a hit that follows a multi-line comment", () => {
    const registry = registryOf(faces);
    const content = "<!--\n primefaces\n jsf-api\n-->\n<artifactId>jsf-api</artifactId>\n";
    const detected = registry.detectWithEvidence([{ path: "pom.xml", content }]);
    expect(detected[0].evidence.line).toBe(5);
  });

  it("does not mask a format that has no masking rules", () => {
    const registry = registryOf({ ...faces, manifestFiles: ["package.json"] });
    const detected = registry.detectWithEvidence([{ path: "package.json", content: '// primefaces\n{"primefaces": 1}\n' }]);
    expect(detected[0].evidence.line).toBe(1);
  });
});

describe("FrameworkRegistry.detectFrameworks delegates to detectWithEvidence", () => {
  it("considers every matching manifest, not only the first", () => {
    const registry = registryOf(springConfig);
    const detected = registry.detectFrameworks({
      "a/pom.xml": "<project/>",
      "b/pom.xml": "<groupId>org.springframework</groupId>",
    });
    expect(detected.map((c) => c.id)).toEqual(["spring"]);
  });

  it("ignores a keyword that only appears in a comment", () => {
    const registry = registryOf(springConfig);
    expect(registry.detectFrameworks({ "pom.xml": "<!-- org.springframework -->" })).toEqual([]);
  });

  it("returns configs in registration order, not id order", () => {
    const registry = registryOf(springConfig, djangoConfig);
    const detected = registry.detectFrameworks({
      "pom.xml": "org.springframework",
      "requirements.txt": "django",
    });
    expect(detected.map((c) => c.id)).toEqual(["spring", "django"]);
  });
});

describe("FrameworkRegistry.isManifestPath", () => {
  it("applies the same matching rule as detection", () => {
    const registry = registryOf(springConfig, mauiConfig);
    expect(registry.isManifestPath("pom.xml")).toBe(true);
    expect(registry.isManifestPath("a/b/build.gradle.kts")).toBe(true);
    expect(registry.isManifestPath("src/App.csproj")).toBe(true);
    expect(registry.isManifestPath("mypom.xml")).toBe(false);
    expect(registry.isManifestPath("pom.xml.bak")).toBe(false);
    expect(registry.isManifestPath("Gemfile")).toBe(false);
  });
});
