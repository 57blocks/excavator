import { describe, expect, it } from "vitest";
import { buildFreshnessBanner } from "../../components/StalenessBanner";
import { isDashboardFreshnessReport, type GraphFreshnessResult } from "../../freshness";

// The pack's freshness report (openspec: changes/viewer-explorer, design D2): a graph from another
// source revision than the one packed beside it, or one that records none, is a "revision" result.

const GIT_NOW = `git:${"a".repeat(40)}`;
const GIT_THEN = `git:${"b".repeat(40)}`;
const fresh = (revision: string): GraphFreshnessResult => ({
  status: "fresh",
  graphCommitHash: revision,
  headCommitHash: revision,
  changedFileCount: 0,
  changedFiles: [],
  commitsBehind: 0,
  commitsAhead: 0,
});

describe("the revision freshness result", () => {
  it("is accepted with a graph revision or none, and refused when it names the current revision or misses one", () => {
    expect(isDashboardFreshnessReport({ graphs: { knowledge: { status: "revision", graphRevision: GIT_THEN, currentRevision: GIT_NOW } } })).toBe(true);
    expect(isDashboardFreshnessReport({ graphs: { knowledge: { status: "revision", graphRevision: null, currentRevision: GIT_NOW } } })).toBe(true);
    expect(isDashboardFreshnessReport({ graphs: { knowledge: { status: "revision", graphRevision: GIT_NOW, currentRevision: GIT_NOW } } })).toBe(false);
    expect(isDashboardFreshnessReport({ graphs: { knowledge: { status: "revision", graphRevision: GIT_THEN } } })).toBe(false);
    expect(isDashboardFreshnessReport({ graphs: { knowledge: { status: "revision", graphRevision: "", currentRevision: GIT_NOW } } })).toBe(false);
  });

  it("shows no banner when both graphs are the current revision", () => {
    expect(buildFreshnessBanner({ graphs: { knowledge: fresh(GIT_NOW), domain: fresh(GIT_NOW) } })).toBeNull();
  });

  it("names both revisions, shortened, and says the code shown is the current source", () => {
    const banner = buildFreshnessBanner({ graphs: { knowledge: { status: "revision", graphRevision: GIT_THEN, currentRevision: GIT_NOW } } });
    expect(banner).toEqual({
      title: "Knowledge graph may not match the current source",
      summary: "The knowledge graph was made from git:bbbbbbbb; this page was packed at git:aaaaaaaa. Code shown here is the source packed with this page, so its lines may not match the graph.",
      action: "Run /excavator to refresh it before relying on impact or onboarding answers.",
      changedFiles: [],
    });
  });

  it("says when a graph records no revision, and names only the graphs that differ", () => {
    const banner = buildFreshnessBanner({
      graphs: { knowledge: fresh(GIT_NOW), domain: { status: "revision", graphRevision: null, currentRevision: GIT_NOW } },
    });
    expect(banner?.title).toBe("Domain graph may not match the current source");
    expect(banner?.summary.startsWith("The domain graph records no source revision; this page was packed at git:aaaaaaaa.")).toBe(true);
    expect(banner?.action).toBe("Run /excavator-domain to refresh it before relying on impact or onboarding answers.");
  });
});
