// Group 4 (openspec: changes/full-semantic-isolation, capability
// `consumer-freshness`): every graph-consuming skill now checks freshness
// through the ONE shared, deterministic helper (skills/excavator/
// consumer-freshness.mjs) instead of computing its own gitCommitHash/
// git-diff comparison. This replaces the pre-Slice-D version of this test,
// which asserted the presence of exactly the ad hoc logic this migration
// deletes.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

const graphConsumerSkills = [
  "excavator-chat",
  "excavator-explain",
  "excavator-diff",
  "excavator-onboard",
  "excavator-domain",
];

// Every skill must invoke the shared helper the same way, and document the
// same freshness contract — the whole point of a SHARED helper is that no
// skill computes its own commit/diff comparison any more.
const requiredFreshnessInstructions = [
  'consumer-freshness.mjs" "$PROJECT_ROOT"',
  "source-manifest.json",
  "sourceRevision",
  "fresh",
  "stale",
  "missing",
  "HEAD only",
  "content hash",
  "warn",
  "continue",
  "Run `/excavator`",
];

// The ad hoc, per-skill freshness-CHECKING logic this migration deletes —
// none of it may survive in any graph-consuming skill. This deliberately
// does NOT include the bare word "gitCommitHash": that is still a real
// knowledge-graph.json schema field (documented in each skill's "Graph
// Structure Reference" section, and legitimately named in prose explaining
// what freshness logic was replaced) — only the ad hoc COMPARISON constructs
// built around it are forbidden.
const forbiddenLegacyFreshnessInstructions = [
  "GRAPH_COMMIT_RAW",
  'git rev-parse --verify --end-of-options "${GRAPH_COMMIT_RAW}^{commit}"',
  'git diff --name-only "$GRAPH_COMMIT" HEAD -- .',
  "git diff --cached --name-only -- .",
  "git ls-files --others --exclude-standard -- .",
];

describe("graph-consuming skills", () => {
  it.each(graphConsumerSkills)(
    "%s checks freshness via the shared consumer-freshness helper",
    (skillName) => {
      const skillPath = resolve(repoRoot, "skills", skillName, "SKILL.md");
      const content = readFileSync(skillPath, "utf-8");

      for (const instruction of requiredFreshnessInstructions) {
        expect(content).toContain(instruction);
      }
      for (const legacy of forbiddenLegacyFreshnessInstructions) {
        expect(content).not.toContain(legacy);
      }
    },
  );

  it("excavator-domain applies the preflight only to its existing-graph path", () => {
    const content = readFileSync(
      resolve(repoRoot, "skills", "excavator-domain", "SKILL.md"),
      "utf-8",
    );

    expect(content).toContain("When `--full` is used, skip this preflight");
    expect(content).toContain("Phase 3: Derive from Existing Graph");
  });

  it("every consumer resolves $PLUGIN_ROOT before invoking the helper (a bare relative script path would fail)", () => {
    for (const skillName of graphConsumerSkills) {
      const content = readFileSync(
        resolve(repoRoot, "skills", skillName, "SKILL.md"),
        "utf-8",
      );
      expect(content).toContain('PLUGIN_ROOT/skills/excavator/consumer-freshness.mjs');
    }
  });
});
