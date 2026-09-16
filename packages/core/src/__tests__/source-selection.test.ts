import { describe, expect, it } from "vitest";

import {
  PRIVATE_KEY_PREFIX_BYTES,
  SOURCE_SELECTION_POLICY_VERSION,
  buildSourceSelectionLedger,
  createSourceSelectionPolicy,
  sourceSelectionConservationViolations,
} from "../source-selection.js";

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
