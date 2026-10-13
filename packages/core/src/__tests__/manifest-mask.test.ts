import { describe, it, expect } from "vitest";
import { maskManifestText } from "../languages/manifest-mask.js";

function newlineOffsets(text: string): number[] {
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n" || text[i] === "\r") offsets.push(i);
  }
  return offsets;
}

/**
 * Mask `text` as the manifest `path` and check what holds for every format:
 * same length, line breaks at the same offsets, and every changed character
 * became a space (masking can only blank, never add).
 */
function mask(path: string, text: string): string {
  const masked = maskManifestText(path, text);
  expect(masked).toHaveLength(text.length);
  expect(newlineOffsets(masked)).toEqual(newlineOffsets(text));
  for (let i = 0; i < text.length; i++) {
    if (masked[i] !== text[i]) expect(masked[i]).toBe(" ");
  }
  return masked;
}

describe("maskManifestText: XML", () => {
  it("blanks a comment and keeps the declaration after it", () => {
    const text = '<!-- <artifactId>primefaces</artifactId> -->\n<artifactId>jsf-api</artifactId>\n';
    const masked = mask("pom.xml", text);
    expect(masked).not.toContain("primefaces");
    expect(masked).toContain("jsf-api");
    expect(masked).toBe(" ".repeat(text.indexOf("\n")) + text.slice(text.indexOf("\n")));
  });

  it("blanks a multi-line comment and keeps every line break", () => {
    const text = "<a/>\n<!--\n  <artifactId>x</artifactId>\n-->\n<b/>\n";
    const masked = mask("pom.xml", text);
    expect(masked).not.toContain("artifactId");
    expect(masked).toContain("<a/>");
    expect(masked).toContain("<b/>");
  });

  it("blanks an unterminated comment to the end of the file", () => {
    const text = "<a/>\n<!-- never closed\n<artifactId>primefaces</artifactId>\n";
    const masked = mask("pom.xml", text);
    expect(masked).toContain("<a/>");
    expect(masked).not.toContain("primefaces");
    expect(masked.slice(text.indexOf("<!--")).trim()).toBe("");
  });

  it("treats a comment opener inside CDATA as text", () => {
    const text = "<d><![CDATA[ <!-- ]]></d>\n<artifactId>primefaces</artifactId>\n";
    const masked = mask("pom.xml", text);
    expect(masked).toContain("primefaces");
  });

  it("blanks a paired exclusions element with its whole content", () => {
    const text = [
      "<dependency>",
      "  <artifactId>a</artifactId>",
      "  <exclusions>",
      "    <exclusion><groupId>org.springframework</groupId></exclusion>",
      "  </exclusions>",
      "</dependency>",
      "",
    ].join("\n");
    const masked = mask("pom.xml", text);
    expect(masked).not.toContain("springframework");
    expect(masked).not.toContain("exclusion");
    expect(masked).toContain("<artifactId>a</artifactId>");
    expect(masked).toContain("</dependency>");
  });

  it("blanks a self-closing exclude element and nothing after it", () => {
    const text = '<x/>\n<exclude name="spring-boot"/>\n<artifactId>keep</artifactId>\n';
    const masked = mask("pom.xml", text);
    expect(masked).not.toContain("spring-boot");
    expect(masked).toContain("<artifactId>keep</artifactId>");
  });

  it("blanks a paired excludes element", () => {
    const text = "<excludes>\n  <exclude>**/spring-boot*.jar</exclude>\n</excludes>\n<artifactId>keep</artifactId>\n";
    const masked = mask("pom.xml", text);
    expect(masked).not.toContain("spring-boot");
    expect(masked).toContain("keep");
  });

  it("matches element names and end tags case-insensitively", () => {
    const text = "<EXCLUSIONS>\n<groupId>org.springframework</groupId>\n</Exclusions>\n<artifactId>keep</artifactId>\n";
    const masked = mask("pom.xml", text);
    expect(masked).not.toContain("springframework");
    expect(masked).toContain("keep");
  });

  it("does not blank a paired exclusions element with no end tag", () => {
    const text = "<exclusions>\n<groupId>org.springframework</groupId>\n";
    const masked = mask("pom.xml", text);
    expect(masked).toBe(text);
  });

  it("ends a paired element at the nearest end tag of the same name", () => {
    const text = "<exclude>one</exclude>\n<artifactId>keep</artifactId>\n<exclude>two</exclude>\n";
    const masked = mask("pom.xml", text);
    expect(masked).toContain("keep");
    expect(masked).not.toContain("one");
    expect(masked).not.toContain("two");
  });

  it("does not blank a lone exclusion element (singular) or similarly named elements", () => {
    const text = "<exclusion>a</exclusion>\n<excluded>b</excluded>\n<exclusionsList>c</exclusionsList>\n";
    expect(mask("pom.xml", text)).toBe(text);
  });

  it("finds the end of an opening tag past a quoted `>` and keeps `/` in a quoted value", () => {
    const text = '<exclude a="x>y" b="p/">spring-boot</exclude>\n<artifactId>keep</artifactId>\n';
    const masked = mask("pom.xml", text);
    expect(masked).not.toContain("spring-boot");
    expect(masked).toContain("keep");
  });

  it("does not blank an opening tag that never ends", () => {
    const text = '<artifactId>keep</artifactId>\n<exclude a="spring-boot';
    expect(mask("pom.xml", text)).toBe(text);
  });

  it("masks comments inside a paired element that has no end tag", () => {
    const text = "<exclusions>\n<!-- spring-boot -->\n<artifactId>keep</artifactId>\n";
    const masked = mask("pom.xml", text);
    expect(masked).not.toContain("spring-boot");
    expect(masked).toContain("keep");
  });

  it("applies the XML rules to every .xml and .csproj path, at any depth", () => {
    const text = "<!-- UseMaui -->\n<UseMaui>true</UseMaui>\n";
    for (const path of ["orders/ejb/pom.xml", "ivy.xml", "faces-config.xml", "App/App.csproj", "A.CSPROJ"]) {
      const masked = mask(path, text);
      expect(masked.match(/UseMaui/g)).toHaveLength(2);
      expect(masked.startsWith("<!--")).toBe(false);
    }
  });

  it("keeps CRLF line breaks", () => {
    const text = "<!-- a\r\nb -->\r\n<artifactId>keep</artifactId>\r\n";
    const masked = mask("pom.xml", text);
    expect(masked).toBe("      \r\n     \r\n<artifactId>keep</artifactId>\r\n");
  });
});

describe("maskManifestText: Gradle", () => {
  it("blanks a // comment to the end of the line", () => {
    const text = "implementation 'a:b:1' // org.springframework\nimplementation 'org.springframework:x:1'\n";
    const masked = mask("build.gradle", text);
    expect(masked.split("\n")[0]).toBe("implementation 'a:b:1' " + " ".repeat("// org.springframework".length));
    expect(masked.split("\n")[1]).toContain("org.springframework");
  });

  it("blanks a block comment across lines and keeps the code after it", () => {
    const text = "/* old\n   implementation 'spring-boot'\n*/ implementation 'jsf-api'\n";
    const masked = mask("build.gradle", text);
    expect(masked).not.toContain("spring-boot");
    expect(masked).toContain("jsf-api");
  });

  it("blanks an unterminated block comment to the end of the file", () => {
    const text = "implementation 'a:b:1'\n/* never closed\nimplementation 'spring-boot'\n";
    const masked = mask("build.gradle", text);
    expect(masked).toContain("a:b:1");
    expect(masked).not.toContain("spring-boot");
  });

  it("blanks an inline exclude statement to the end of the line", () => {
    const text = "implementation('x:y:1') {\n  exclude group: 'org.springframework.boot'\n}\nimplementation 'jsf-api'\n";
    const masked = mask("build.gradle", text);
    expect(masked).not.toContain("springframework");
    expect(masked).toContain("jsf-api");
    expect(masked).toContain("implementation('x:y:1') {");
  });

  it("blanks the Kotlin DSL form and a chained .exclude call", () => {
    const text = [
      "implementation(\"x:y:1\") { exclude(group = \"org.springframework\") }",
      "implementation(\"a:b:1\").exclude(\"spring-boot\")",
      "implementation(\"jsf-api\")",
      "",
    ].join("\n");
    const masked = mask("build.gradle.kts", text);
    expect(masked).not.toContain("springframework");
    expect(masked).not.toContain("spring-boot");
    expect(masked).toContain("jsf-api");
    expect(masked).toContain('implementation("x:y:1")');
  });

  it("matches `exclude` as a whole word only", () => {
    const text = "implementation 'excluded:lib:1'\nimplementation 'spring-boot' // excluding nothing\n";
    const masked = mask("build.gradle", text);
    expect(masked).toContain("excluded:lib:1");
    expect(masked).toContain("implementation 'spring-boot'");
  });

  it("applies to settings.gradle and nested paths", () => {
    const masked = mask("app/settings.gradle", "// spring-boot\ninclude 'a'\n");
    expect(masked).not.toContain("spring-boot");
    expect(masked).toContain("include 'a'");
  });
});

describe("maskManifestText: go.mod", () => {
  it("blanks // comments", () => {
    const text = "require github.com/foo/bar v1.0.0 // indirect: github.com/gin-gonic/gin\n";
    const masked = mask("go.mod", text);
    expect(masked).not.toContain("gin-gonic");
    expect(masked).toContain("github.com/foo/bar");
  });

  it("blanks an exclude line", () => {
    const text = "exclude github.com/gin-gonic/gin v1.6.0\nrequire github.com/foo/bar v1.0.0\n";
    const masked = mask("services/api/go.mod", text);
    expect(masked).not.toContain("gin-gonic");
    expect(masked).toContain("require github.com/foo/bar v1.0.0");
  });

  it("blanks an exclude ( ... ) block and keeps what follows", () => {
    const text = [
      "module m",
      "exclude (",
      "  github.com/gin-gonic/gin v1.6.0",
      "  github.com/other/lib v1.0.0 // pinned (see note)",
      "  github.com/gin-gonic/gin v1.6.1",
      ")",
      "require github.com/foo/bar v1.0.0",
      "",
    ].join("\n");
    const masked = mask("go.mod", text);
    expect(masked).not.toContain("gin-gonic");
    expect(masked).not.toContain("other/lib");
    expect(masked).toContain("module m");
    expect(masked).toContain("require github.com/foo/bar v1.0.0");
  });

  it("falls back to the line when an exclude block never closes", () => {
    const text = "exclude (\n  github.com/gin-gonic/gin v1.6.0\n";
    const masked = mask("go.mod", text);
    expect(masked).toContain("github.com/gin-gonic/gin");
    expect(masked.split("\n")[0].trim()).toBe("");
  });

  it("does not read a go.mod block into a Gradle file", () => {
    const text = "exclude (\nimplementation 'spring-boot'\n)\n";
    const masked = mask("build.gradle", text);
    expect(masked).toContain("spring-boot");
  });
});

describe("maskManifestText: # comments", () => {
  const FILES = ["requirements.txt", "Pipfile", "pyproject.toml", "setup.cfg", "setup.py", "Gemfile"];

  it.each(FILES)("blanks # to the end of the line in %s", (name) => {
    const text = "django==4.2 # flask\n# fastapi\nrails\n";
    const masked = mask(`backend/${name}`, text);
    expect(masked).toContain("django==4.2");
    expect(masked).toContain("rails");
    expect(masked).not.toContain("flask");
    expect(masked).not.toContain("fastapi");
    expect(masked).toBe("django==4.2 " + " ".repeat("# flask".length) + "\n" + " ".repeat("# fastapi".length) + "\nrails\n");
  });

  it("does not treat // or /* */ as comments", () => {
    const text = "// django\n/* flask */\n";
    expect(mask("requirements.txt", text)).toBe(text);
  });
});

describe("maskManifestText: single-line strings", () => {
  const SPRING = "implementation 'org.springframework:spring-core:5.3.0'";

  it("does not open a block comment on a glob inside a string", () => {
    const text = ["plugins { id 'java' }", "include '**/*.java'", "", "dependencies {", `  ${SPRING}`, "}", ""].join("\n");
    const masked = mask("build.gradle", text);
    expect(masked).toBe(text);
  });

  it("handles the double-quoted and Kotlin DSL forms of a glob", () => {
    const text = ['tasks.jar { include("org/**/*.class") }', `exclude2("a")`, `  ${SPRING}`, ""].join("\n");
    expect(mask("build.gradle.kts", text)).toBe(text);
    const groovy = ['copy { from "src/**/*.md" }', `  ${SPRING}`, ""].join("\n");
    expect(mask("build.gradle", groovy)).toBe(groovy);
  });

  it("does not read a // inside a URL string as a comment, but masks a real comment after it", () => {
    const text = ['url "http://repo.example.com/maven"', `// ${SPRING}`, ""].join("\n");
    const masked = mask("build.gradle", text);
    const [urlLine, commentLine] = masked.split("\n");
    expect(urlLine).toBe('url "http://repo.example.com/maven"');
    expect(commentLine).toBe(" ".repeat(`// ${SPRING}`.length));
  });

  it("masks a // comment that follows a string on the same line", () => {
    const text = "implementation 'a:b:1' // 'org.springframework'\n";
    const masked = mask("build.gradle", text);
    expect(masked).toBe("implementation 'a:b:1' " + " ".repeat("// 'org.springframework'".length) + "\n");
  });

  it("does not take the word exclude inside a string as a statement, and still masks a bare one", () => {
    const text = [`ext.tag = "exclude"; ${SPRING}`, "  exclude group: 'x'", ""].join("\n");
    const masked = mask("build.gradle", text);
    const [stringLine, bareLine] = masked.split("\n");
    expect(stringLine).toBe(`ext.tag = "exclude"; ${SPRING}`);
    expect(bareLine).toBe("  " + " ".repeat("exclude group: 'x'".length));
  });

  it("lets a backslash escape the quote, so the string goes on", () => {
    const text = ["println 'it\\'s /* not a comment'", SPRING, ""].join("\n");
    expect(mask("build.gradle", text)).toBe(text);
  });

  it("lets a backslash escape a backslash, so the next quote closes the string", () => {
    const text = ["println 'a\\\\' // real comment", ""].join("\n");
    const masked = mask("build.gradle", text);
    expect(masked).toBe("println 'a\\\\' " + " ".repeat("// real comment".length) + "\n");
  });

  it("treats a quote with no closing quote on its line as an ordinary character", () => {
    const text = `def x = "abc // implementation 'org.springframework'\n`;
    const masked = mask("build.gradle", text);
    expect(masked).toBe(`def x = "abc ` + " ".repeat(`// implementation 'org.springframework'`.length) + "\n");
  });

  it("does not let a string run onto the next line", () => {
    const text = ["def x = 'unclosed", "/* real comment */ " + SPRING, ""].join("\n");
    const masked = mask("build.gradle", text);
    expect(masked.split("\n")[1]).toBe(" ".repeat("/* real comment */".length) + ` ${SPRING}`);
  });

  it("does not let a trailing backslash carry a string onto the next line", () => {
    const text = ["def x = 'abc\\", "/* c */ " + SPRING, ""].join("\n");
    const masked = mask("build.gradle", text);
    expect(masked.split("\n")[1]).toBe("       " + ` ${SPRING}`);
  });

  it("does not look at quotes inside a comment or an exclude statement", () => {
    const block = `/* don't */ ${SPRING}\n`;
    expect(mask("build.gradle", block)).toBe(" ".repeat("/* don't */".length) + ` ${SPRING}\n`);
    const line = `// it's\n${SPRING}\n`;
    expect(mask("build.gradle", line)).toBe(" ".repeat("// it's".length) + `\n${SPRING}\n`);
    const exclusion = `exclude group: "a\n${SPRING}\n`;
    expect(mask("build.gradle", exclusion)).toBe(" ".repeat('exclude group: "a'.length) + `\n${SPRING}\n`);
  });

  it("skips strings in go.mod and keeps the exclude block as it was", () => {
    const text = [
      'require "example.com/a" v1.0.0 // direct',
      "exclude (",
      "  example.com/b v1.0.0 // pinned (see note)",
      '  example.com/c v"1',
      ")",
      "require example.com/d v1.0.0",
      "",
    ].join("\n");
    const masked = mask("go.mod", text);
    const lines = masked.split("\n");
    expect(lines[0]).toBe('require "example.com/a" v1.0.0 ' + " ".repeat("// direct".length));
    expect(lines.slice(1, 5).join("").trim()).toBe("");
    expect(lines[5]).toBe("require example.com/d v1.0.0");
  });

  it("does not take a # inside a string as a comment, but masks a real one after it", () => {
    const interpolated = 'gem "foo", "#{ver}"\n';
    expect(mask("Gemfile", interpolated)).toBe(interpolated);
    const text = "gem 'rails' # comment\n";
    expect(mask("Gemfile", text)).toBe("gem 'rails' " + " ".repeat("# comment".length) + "\n");
  });

  it("applies the string rule to every # format", () => {
    const text = 'install_requires=["django # kept"]  # dropped\n';
    for (const name of ["requirements.txt", "Pipfile", "pyproject.toml", "setup.cfg", "setup.py", "Gemfile"]) {
      const masked = mask(name, text);
      expect(masked, name).toContain("django # kept");
      expect(masked, name).not.toContain("dropped");
    }
  });

  it("takes an unclosed quote before a # as an ordinary character", () => {
    const text = "description = Django's tools # comment\n";
    const masked = mask("setup.cfg", text);
    expect(masked).toBe("description = Django's tools " + " ".repeat("# comment".length) + "\n");
  });

  it("leaves XML alone: a quote is not a string there", () => {
    const text = "<a b=\"x\"/>\n<!-- 'org.springframework' -->\n";
    const masked = mask("pom.xml", text);
    expect(masked.split("\n")[0]).toBe('<a b="x"/>');
    expect(masked).not.toContain("springframework");
  });
});

describe("maskManifestText: other manifests", () => {
  it("returns package.json unchanged", () => {
    const text = '{\n  "dependencies": { "react": "^18" } // not a comment here\n}\n';
    expect(maskManifestText("package.json", text)).toBe(text);
  });

  it("returns unknown and angular.json content unchanged", () => {
    const text = "# <!-- exclude // /* spring-boot */ -->\n";
    expect(maskManifestText("angular.json", text)).toBe(text);
    expect(maskManifestText("notes.md", text)).toBe(text);
    expect(maskManifestText("", text)).toBe(text);
  });

  it("returns empty text for every format", () => {
    for (const path of ["pom.xml", "build.gradle", "go.mod", "requirements.txt", "package.json"]) {
      expect(maskManifestText(path, "")).toBe("");
    }
  });
});
