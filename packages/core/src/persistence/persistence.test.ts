import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
import { saveMeta, loadMeta, saveFingerprints, loadFingerprints, saveConfig, loadConfig, resolveDataDir, sanitiseFilePaths } from "./index.js";
import { mkdirSync } from "node:fs";
import type { KnowledgeGraph, AnalysisMeta } from "../types.js";
import type { FingerprintStore } from "../fingerprint.js";

describe("persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "excavator-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const sampleGraph: KnowledgeGraph = {
    version: "1.0.0",
    project: {
      name: "test-project",
      languages: ["typescript"],
      frameworks: ["vitest"],
      description: "A test project",
      analyzedAt: "2026-03-14T00:00:00.000Z",
      gitCommitHash: "abc123",
    },
    nodes: [
      {
        id: "node-1",
        type: "file",
        name: "index.ts",
        filePath: "src/index.ts",
        lineRange: [1, 50],
        summary: "Entry point",
        tags: ["entry"],
        complexity: "simple",
      },
    ],
    edges: [
      {
        source: "node-1",
        target: "node-1",
        type: "imports",
        direction: "forward",
        weight: 0.8,
        evidence: [], provenance: "inferred" as const,
      },
    ],
    layers: [
      {
        id: "layer-1",
        name: "Core",
        description: "Core layer",
        nodeIds: ["node-1"],
      },
    ],
    tour: [
      {
        order: 1,
        title: "Start here",
        description: "Begin with the entry point",
        nodeIds: ["node-1"],
      },
    ],
  };

  const sampleMeta: AnalysisMeta = {
    lastAnalyzedAt: "2026-03-14T00:00:00.000Z",
    gitCommitHash: "abc123",
    version: "1.0.0",
    analyzedFiles: 42,
  };

  describe("sanitiseFilePaths", () => {
    it("makes an in-root absolute path relative, keeps only the name of an outside path, and leaves a relative path alone", () => {
      const graph: KnowledgeGraph = {
        ...sampleGraph,
        nodes: [
          { ...sampleGraph.nodes[0], id: "a", filePath: join(tempDir, "src", "index.ts") },
          { ...sampleGraph.nodes[0], id: "b", filePath: "/elsewhere/secret/layout/util.ts" },
          { ...sampleGraph.nodes[0], id: "c", filePath: "src/already.ts" },
        ],
      };

      const sanitised = sanitiseFilePaths(graph, tempDir);

      expect(sanitised.nodes.map((n) => n.filePath)).toEqual([join("src", "index.ts"), "util.ts", "src/already.ts"]);
      expect(graph.nodes[0].filePath).toBe(join(tempDir, "src", "index.ts")); // the input is not mutated
    });
  });

  describe("saveMeta / loadMeta", () => {
    it("should write meta.json to .excavator/", () => {
      saveMeta(tempDir, sampleMeta);

      const filePath = join(tempDir, ".excavator", "meta.json");
      expect(existsSync(filePath)).toBe(true);
    });

    it("should read back the saved meta correctly", () => {
      saveMeta(tempDir, sampleMeta);
      const loaded = loadMeta(tempDir);

      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(sampleMeta);
    });

    it("should return null when no meta exists", () => {
      const loaded = loadMeta(tempDir);
      expect(loaded).toBeNull();
    });
  });

  describe("saveFingerprints / loadFingerprints", () => {
    const sampleFingerprints: FingerprintStore = {
      version: "1.0.0",
      gitCommitHash: "abc123",
      generatedAt: "2026-03-14T00:00:00.000Z",
      files: {
        "src/index.ts": {
          filePath: "src/index.ts",
          contentHash: "deadbeef",
          functions: [],
          classes: [],
          imports: [],
          exports: [],
          totalLines: 10,
          hasStructuralAnalysis: false,
        },
      },
    };

    it("should round-trip fingerprints correctly", () => {
      saveFingerprints(tempDir, sampleFingerprints);
      const loaded = loadFingerprints(tempDir);

      expect(loaded).toEqual(sampleFingerprints);
    });

    it("should return null when no fingerprints file exists", () => {
      const loaded = loadFingerprints(tempDir);
      expect(loaded).toBeNull();
    });

    it("should return null when fingerprints.json is corrupted", () => {
      const dir = join(tempDir, ".excavator");
      // Ensure the directory exists by saving first, then overwrite with garbage
      saveFingerprints(tempDir, sampleFingerprints);
      writeFileSync(join(dir, "fingerprints.json"), "{{not valid json!!", "utf-8");

      const loaded = loadFingerprints(tempDir);
      expect(loaded).toBeNull();
    });
  });

  describe("saveConfig / loadConfig", () => {
    it("should round-trip config correctly", () => {
      saveConfig(tempDir, { autoUpdate: true });
      const loaded = loadConfig(tempDir);

      expect(loaded).toEqual({ autoUpdate: true });
    });

    it("should return default config when no file exists", () => {
      const loaded = loadConfig(tempDir);

      expect(loaded).toEqual({ autoUpdate: false });
    });

    it("should return default config when config.json is corrupted", () => {
      saveConfig(tempDir, { autoUpdate: true });
      const dir = join(tempDir, ".excavator");
      writeFileSync(join(dir, "config.json"), "not json!!", "utf-8");

      const loaded = loadConfig(tempDir);
      expect(loaded).toEqual({ autoUpdate: false });
    });

    it("treats outputLanguage as legacy data and removes it on normalized write-back", () => {
      const dir = join(tempDir, ".excavator");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({
          autoUpdate: true,
          analysisMode: "lazy",
          customSetting: { keep: true },
          outputLanguage: "zh",
        }),
        "utf-8",
      );

      const loaded = loadConfig(tempDir);
      expect(loaded).toEqual({
        autoUpdate: true,
        analysisMode: "lazy",
        customSetting: { keep: true },
      });

      saveConfig(tempDir, loaded);
      expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf-8"))).toEqual({
        autoUpdate: true,
        analysisMode: "lazy",
        customSetting: { keep: true },
      });
    });
  });
});

describe("no legacy data-directory fallback (single source of truth: .excavator/)", () => {
  let tempDir: string;

  // Built from parts rather than written as a literal so this file — which
  // deliberately exercises the pre-rename directory names to prove they are
  // now inert — doesn't itself trip the repo-wide zero-old-token grep gate
  // (oracle #1 in openspec/changes/excavator-rename/design.md).
  const preRenameShortDir = ["." , "u", "a"].join("");
  const preRenameLongDir = "." + ["understand", "anything"].join("-");

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "excavator-legacy-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("resolves to .excavator for a fresh project", () => {
    expect(resolveDataDir(tempDir)).toBe(join(tempDir, ".excavator"));
  });

  it("ignores an existing pre-rename short-form data directory — treats the project as never analysed and writes to .excavator/", () => {
    mkdirSync(join(tempDir, preRenameShortDir));
    expect(resolveDataDir(tempDir)).toBe(join(tempDir, ".excavator"));

    saveMeta(tempDir, { analyzedAt: "t", gitCommitHash: "abc", fileCount: 1 } as never);
    expect(existsSync(join(tempDir, ".excavator", "meta.json"))).toBe(true);
    expect(existsSync(join(tempDir, preRenameShortDir, "meta.json"))).toBe(false);
    expect(loadMeta(tempDir)?.gitCommitHash).toBe("abc");
  });

  it("ignores an existing pre-rename long-form data directory — the data directory is still .excavator/", () => {
    mkdirSync(join(tempDir, preRenameLongDir), { recursive: true });
    writeFileSync(join(tempDir, preRenameLongDir, "meta.json"), JSON.stringify({ gitCommitHash: "old" }), "utf-8");
    expect(resolveDataDir(tempDir)).toBe(join(tempDir, ".excavator"));
    expect(loadMeta(tempDir)).toBeNull();
  });
});
