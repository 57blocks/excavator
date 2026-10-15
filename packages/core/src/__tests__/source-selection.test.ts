import ignore from "ignore";
import { describe, expect, it } from "vitest";

import { DEFAULT_IGNORE_PATTERNS } from "../ignore-filter.js";
import {
  PRIVATE_KEY_PREFIX_BYTES,
  SOURCE_SELECTION_POLICY_VERSION,
  buildSourceSelectionLedger,
  createSourceSelectionPolicy,
  sourceSelectionConservationViolations,
} from "../source-selection.js";

/** Default file patterns, read from the constant itself rather than listed by hand. */
const FILE_PATTERNS = DEFAULT_IGNORE_PATTERNS.filter(
  (pattern) => !pattern.endsWith("/") && !pattern.startsWith("!"),
);
/**
 * The defaults without the derived directory negations. With only positive
 * rules, order and repetition do not matter, so this decides like the rule set
 * before the negations existed.
 */
const POSITIVE_DEFAULTS = DEFAULT_IGNORE_PATTERNS.filter((pattern) => !pattern.startsWith("!"));
/** Archive names are rejected by the archive check before any pattern is consulted. */
const ARCHIVE_NAME = /\.(zip|tar|gz)$/i;

/** A concrete name a file pattern matches: every `*` becomes `x`. */
function concreteName(pattern: string): string {
  return pattern.replaceAll("*", "x");
}

function filteredByDefaults(path: string, detail = "default-pattern") {
  return { kind: "filtered-by-defaults", reason: "filtered-by-defaults", detail, path };
}

describe("source selection policy", () => {
  it("returns one tagged decision for defaults, project ignores, sensitive inputs, and selected inputs", () => {
    const policy = createSourceSelectionPolicy({ projectPatterns: ["generated/"] });
    const decisions = [
      policy.decide({ path: "coverage/report.json" }),
      policy.decide({ path: "generated/client.ts" }),
      policy.decide({ path: "config/signing.key", size: 42 }),
      policy.decide({ path: "src/app.ts" }),
    ];

    expect(policy.version).toBe(SOURCE_SELECTION_POLICY_VERSION);
    expect(decisions.map((decision) => decision.kind)).toEqual([
      "filtered-by-defaults",
      "filtered-by-ignore",
      "sensitive",
      "selected",
    ]);
    expect(buildSourceSelectionLedger(decisions)).toMatchObject({
      candidates: 4,
      selected: 1,
      filteredByDefaults: 1,
      filteredByIgnore: 1,
      sensitive: 1,
    });
  });

  it.each([
    ["src\\Thumbs.db", "src/Thumbs.db"],
    ["EHTHUMBS.DB", "EHTHUMBS.DB"],
    ["nested\\ehthumbs_vista.DB", "nested/ehthumbs_vista.DB"],
    ["DESKTOP.INI", "DESKTOP.INI"],
    [".VS\\cache.bin", ".VS/cache.bin"],
    ["$RECYCLE.BIN\\item", "$RECYCLE.BIN/item"],
    ["System Volume Information\\item", "System Volume Information/item"],
    ["src/.DS_Store", "src/.DS_Store"],
    ["src/._metadata", "src/._metadata"],
    ["__MACOSX/content", "__MACOSX/content"],
    [".gradle/caches/state.bin", ".gradle/caches/state.bin"],
  ])("normalizes and default-filters cross-platform metadata %s", (inputPath, normalizedPath) => {
    expect(createSourceSelectionPolicy().decide({ path: inputPath })).toEqual({
      kind: "filtered-by-defaults",
      reason: "filtered-by-defaults",
      detail: "default-pattern",
      path: normalizedPath,
    });
  });

  it.each([
    ["bin\\rails", "bin/rails"],
    ["gradle\\wrapper\\gradle-wrapper.properties", "gradle/wrapper/gradle-wrapper.properties"],
  ])("keeps source-like cross-platform control %s selected", (inputPath, normalizedPath) => {
    expect(createSourceSelectionPolicy().decide({ path: inputPath })).toEqual({
      kind: "selected",
      path: normalizedPath,
    });
  });

  it("publishes every cross-platform default in selection identity descriptors", () => {
    const expectedPatterns = [
      ".DS_Store",
      "._*",
      "__MACOSX/",
      "Thumbs.db",
      "ehthumbs.db",
      "ehthumbs_vista.db",
      "Desktop.ini",
      "$RECYCLE.BIN/",
      "System Volume Information/",
      ".vs/",
      ".gradle/",
    ];
    expect(createSourceSelectionPolicy().descriptors).toEqual(
      expect.arrayContaining(expectedPatterns.map((pattern) => `default:${pattern}`)),
    );
  });

  it("allows a project rule to negate an ordinary cross-platform default", () => {
    const policy = createSourceSelectionPolicy({ projectPatterns: ["!.DS_Store"] });
    expect(policy.decide({ path: ".DS_Store" })).toEqual({ kind: "selected", path: ".DS_Store" });
  });

  it("allows an ordinary default to be negated", () => {
    const policy = createSourceSelectionPolicy({ projectPatterns: ["!LICENSE"] });
    expect(policy.decide({ path: "LICENSE" })).toEqual({ kind: "selected", path: "LICENSE" });
  });

  it("attributes a CLI re-exclusion after a project negation to the CLI layer", () => {
    const policy = createSourceSelectionPolicy({
      projectPatterns: ["!LICENSE"],
      cliPatterns: ["LICENSE"],
    });
    expect(policy.decide({ path: "LICENSE" })).toEqual({
      kind: "filtered-by-ignore",
      reason: "filtered-by-ignore",
      detail: "cli-rule",
      path: "LICENSE",
    });
  });

  it.each([
    ".excavator/knowledge-graph.json",
    ".excavator.bak/knowledge-graph.json",
    "nested/.excavator-old/meta.json",
    "unmc.zip",
  ])("does not let project or CLI negation recover hard safety path %s", (path) => {
    const policy = createSourceSelectionPolicy({
      projectPatterns: ["!.excavator/", "!*.zip"],
      cliPatterns: ["!**/.excavator-*/", "!unmc.zip"],
    });
    expect(policy.decide({ path }).kind).toBe("filtered-by-defaults");
  });

  it.each(["pem", "key", "ks", "jks", "pfx", "p12", "set"])(
    "does not let negation recover a .%s sensitive extension",
    (extension) => {
      const path = `config/credential.${extension}`;
      const decision = createSourceSelectionPolicy({ projectPatterns: [`!${path}`] }).decide({ path, size: 17 });
      expect(decision).toEqual({
        kind: "sensitive",
        reason: "sensitive",
        detail: "sensitive-extension",
        path,
        size: 17,
      });
    },
  );

  it("detects a private-key header from a bounded prefix without rejecting a same-sized ordinary control", () => {
    const policy = createSourceSelectionPolicy();
    const secret = Buffer.from(
      "-----BEGIN PRIVATE KEY-----\nEXCAVATOR_FAKE_SECRET_CANARY_bounded\n-----END PRIVATE KEY-----\n",
    );
    const control = Buffer.alloc(secret.byteLength, 0x61);

    expect(policy.decide({ path: "config/unknown.txt", size: secret.byteLength, contentPrefix: secret })).toEqual({
      kind: "sensitive",
      reason: "sensitive",
      detail: "private-key-header",
      path: "config/unknown.txt",
      size: secret.byteLength,
    });
    expect(policy.decide({ path: "config/control.txt", size: control.byteLength, contentPrefix: control })).toEqual({
      kind: "selected",
      path: "config/control.txt",
    });
  });

  it("never scans for a header past the bounded prefix", () => {
    const bytes = Buffer.concat([
      Buffer.alloc(PRIVATE_KEY_PREFIX_BYTES, 0x61),
      Buffer.from("-----BEGIN PRIVATE KEY-----"),
    ]);
    expect(createSourceSelectionPolicy().decide({ path: "late.txt", contentPrefix: bytes }).kind).toBe("selected");
  });

  it("returns safe sensitive metadata with no content, excerpt, or content hash", () => {
    const decision = createSourceSelectionPolicy().decide({
      path: "private.pem",
      size: 123,
      contentPrefix: Buffer.from("do not retain"),
    });
    expect(decision).toEqual({
      kind: "sensitive",
      reason: "sensitive",
      detail: "sensitive-extension",
      path: "private.pem",
      size: 123,
    });
    expect(decision).not.toHaveProperty("content");
    expect(decision).not.toHaveProperty("excerpt");
    expect(decision).not.toHaveProperty("contentHash");
  });
});

describe("default file patterns do not exclude directories", () => {
  const policy = createSourceSelectionPolicy();
  const before = createSourceSelectionPolicy({ defaultPatterns: POSITIVE_DEFAULTS });

  it("reads a non-empty set of file patterns whose concrete names they match", () => {
    expect(FILE_PATTERNS).toEqual(expect.arrayContaining(["LICENSE", "*.lock", "*.log", "*.map", ".eslintrc*"]));
    for (const pattern of FILE_PATTERNS) {
      expect(ignore().add([pattern]).ignores(concreteName(pattern)), pattern).toBe(true);
    }
  });

  it("keeps the selection policy version: the derived rules reach the digest through the descriptors", () => {
    expect(SOURCE_SELECTION_POLICY_VERSION).toBe("source-selection-v1");
    expect(policy.descriptors).toEqual(expect.arrayContaining(["default:LICENSE", "default:!LICENSE/"]));
  });

  // Scenario: every file pattern lets a directory of the same name through.
  it.each(FILE_PATTERNS)("file pattern %s excludes files of that name, not directories", (pattern) => {
    for (const name of [concreteName(pattern).toLowerCase(), concreteName(pattern).toUpperCase()]) {
      for (const path of [`${name}/Foo.java`, `src/${name}/Foo.java`]) {
        expect(policy.decide({ path })).toEqual({ kind: "selected", path });
      }
      const detail = ARCHIVE_NAME.test(name) ? "archive" : "default-pattern";
      for (const path of [name, `src/${name}`, `${name}/${name}`]) {
        expect(policy.decide({ path })).toEqual(filteredByDefaults(path, detail));
        expect(policy.decide({ path })).toEqual(before.decide({ path }));
      }
    }
  });

  // Scenario: a source directory named license is selected.
  it.each([
    "src/main/java/org/example/license/LicenseService.java",
    "app/Services/License/LicenseService.php",
    "src/Services/License/ILicenseProvider.cs",
  ])("selects %s under a directory named like LICENSE", (path) => {
    expect(policy.decide({ path })).toEqual({ kind: "selected", path });
  });

  // Scenario: license files are still excluded.
  it.each([
    "LICENSE",
    "docs/LICENSE",
    "docs/legal/license",
    "src/main/java/org/example/license/LICENSE",
  ])("still excludes the license file %s by default pattern", (path) => {
    expect(policy.decide({ path })).toEqual(filteredByDefaults(path));
  });

  it.each(["LICENSE.md", "License.txt"])("decides %s exactly as before the directory negations", (path) => {
    expect(policy.decide({ path })).toEqual(before.decide({ path }));
    expect(policy.decide({ path })).toEqual({ kind: "selected", path });
  });

  // Scenario: directory patterns are unchanged.
  it.each([
    "node_modules/license/index.js",
    "build/license/Gen.java",
    "license/build/Gen.java",
    "license/node_modules/pkg/index.js",
  ])("still excludes %s because a directory pattern excludes an ancestor", (path) => {
    expect(policy.decide({ path })).toEqual(filteredByDefaults(path));
  });

  // Scenario: a project rule can still exclude the directory.
  it("lets a project rule exclude a directory named like LICENSE", () => {
    const projectPolicy = createSourceSelectionPolicy({ projectPatterns: ["license/"] });
    for (const path of ["src/license/A.java", "src/main/java/org/example/License/LicenseService.java"]) {
      expect(projectPolicy.decide({ path })).toEqual({
        kind: "filtered-by-ignore",
        reason: "filtered-by-ignore",
        detail: "project-rule",
        path,
      });
    }
  });

  it("lets a CLI rule exclude a directory named like LICENSE", () => {
    const path = "src/license/A.java";
    expect(createSourceSelectionPolicy({ cliPatterns: ["license/"] }).decide({ path })).toEqual({
      kind: "filtered-by-ignore",
      reason: "filtered-by-ignore",
      detail: "cli-rule",
      path,
    });
  });

  it("lets a project negation re-include a license file inside a license directory", () => {
    const path = "src/main/java/org/example/license/LICENSE";
    const projectPolicy = createSourceSelectionPolicy({ projectPatterns: ["!LICENSE"] });
    expect(projectPolicy.decide({ path })).toEqual({ kind: "selected", path });
  });
});

describe("source selection ledger", () => {
  it("conserves every unique candidate in exactly one bucket", () => {
    const policy = createSourceSelectionPolicy({ projectPatterns: ["generated/"] });
    const ledger = buildSourceSelectionLedger([
      policy.decide({ path: "src/app.ts" }),
      policy.decide({ path: "coverage/report.json" }),
      policy.decide({ path: "generated/client.ts" }),
      policy.decide({ path: "private.pem", size: 10 }),
    ]);
    expect(sourceSelectionConservationViolations(ledger)).toEqual([]);
    expect(ledger.candidates).toBe(
      ledger.selected + ledger.filteredByDefaults + ledger.filteredByIgnore + ledger.sensitive,
    );
  });

  it("fails closed on duplicate candidate paths", () => {
    const decision = createSourceSelectionPolicy().decide({ path: "src/app.ts" });
    expect(() => buildSourceSelectionLedger([decision, decision])).toThrow(/duplicate candidate path/);
  });

  it("detects swapped bucket counts even when the total still matches", () => {
    const policy = createSourceSelectionPolicy();
    const ledger = buildSourceSelectionLedger([
      policy.decide({ path: "src/app.ts" }),
      policy.decide({ path: "private.key" }),
    ]);
    const corrupted = { ...ledger, selected: 2, sensitive: 0 };
    expect(sourceSelectionConservationViolations(corrupted)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^selected=/), expect.stringMatching(/^sensitive=/)]),
    );
  });
});
