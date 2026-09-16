import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DOMAIN_CONTENT_LANGUAGE,
  DOMAIN_GRAPH_VERSION,
  saveDomainGraph,
  loadDomainGraph,
} from "../persistence/index.js";
import type { KnowledgeGraph } from "../types.js";

const testRoot = join(tmpdir(), "excavator-domain-persist-test");

function valueDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf-8").digest("hex")}`;
}

const domainGraph: KnowledgeGraph = {
  version: "1.0.0",
  languageAudit: {
    status: "accepted",
    inspected: 3,
    accepted: [
      { fieldPath: "project.description", valueDigest: valueDigest("test") },
      { fieldPath: "nodes[0].name", valueDigest: valueDigest("Orders") },
      { fieldPath: "nodes[0].summary", valueDigest: valueDigest("Order management") },
    ],
    rejected: [],
  },
  project: {
    name: "test",
    languages: ["typescript"],
    frameworks: [],
    description: "test",
    analyzedAt: "2026-04-01T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    {
      id: "domain:orders",
      type: "domain",
      name: "Orders",
      summary: "Order management",
      tags: [],
      complexity: "moderate",
    },
  ],
  edges: [],
  layers: [],
  tour: [],
};

describe("domain graph persistence", () => {
  beforeEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
  });

  it("saves and loads domain graph", () => {
    saveDomainGraph(testRoot, domainGraph);
    const loaded = loadDomainGraph(testRoot);
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes[0].id).toBe("domain:orders");
    expect(loaded!.version).toBe(DOMAIN_GRAPH_VERSION);
    expect(loaded!.contentLanguage).toBe(DOMAIN_CONTENT_LANGUAGE);
  });

  it("returns null when no domain graph exists", () => {
    const loaded = loadDomainGraph(testRoot);
    expect(loaded).toBeNull();
  });

  it("saves to domain-graph.json, not knowledge-graph.json", () => {
    saveDomainGraph(testRoot, domainGraph);
    const domainPath = join(testRoot, ".excavator", "domain-graph.json");
    const structuralPath = join(testRoot, ".excavator", "knowledge-graph.json");
    expect(existsSync(domainPath)).toBe(true);
    expect(existsSync(structuralPath)).toBe(false);
    const persisted = JSON.parse(readFileSync(domainPath, "utf-8"));
    expect(persisted.version).toBe(DOMAIN_GRAPH_VERSION);
    expect(persisted.contentLanguage).toBe(DOMAIN_CONTENT_LANGUAGE);
  });

  it("refuses an unaudited domain graph without creating a file", () => {
    const { languageAudit: _languageAudit, ...unaudited } = domainGraph;
    expect(() => saveDomainGraph(testRoot, unaudited as KnowledgeGraph))
      .toThrow(/accepted canonical-language audit/);
    expect(existsSync(join(testRoot, ".excavator", "domain-graph.json"))).toBe(false);
  });
});
