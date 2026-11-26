import type { DashboardFreshnessReport, GraphFreshnessResult, GraphFreshnessUnknownReason } from "../freshness";

/** The sentences that say how a graph relates to the project's current source, one per graph that is not fresh. */

type GraphName = "knowledge" | "domain";

const plural = (count: number, singular: string) => `${count} ${count === 1 ? singular : `${singular}s`}`;

const UNKNOWN_SUMMARY: Record<GraphFreshnessUnknownReason, string> = {
  "missing-graph-commit": "does not include a Git commit hash to compare with HEAD",
  "git-head-unavailable": "could not be compared because the dashboard could not read Git HEAD",
  "graph-commit-unavailable": "references a commit that is not available in this checkout",
  "git-command-timeout": "could not be checked because Git freshness commands timed out",
  "freshness-request-failed": "could not be refreshed because the freshness request failed",
};

/** `kind:` and the first 8 characters of a revision's digest, as the view page writes it. */
function shortRevision(revision: string): string {
  const colon = revision.indexOf(":");
  return colon < 0 ? revision.slice(0, 12) : revision.slice(0, colon + 9);
}

function sentence(name: GraphName, result: GraphFreshnessResult): string | null {
  const subject = `The ${name} graph`;
  switch (result.status) {
    case "fresh":
      return null;
    case "stale": {
      const files = `${plural(result.changedFileCount, "file")} ${result.changedFileCount === 1 ? "has" : "have"} changed since analysis.`;
      if (result.relation === "behind") return `${subject} is ${plural(result.commitsBehind, "project commit")} behind HEAD; ${files}`;
      if (result.relation === "ahead") return `${subject} comes from a newer project history than HEAD; ${files}`;
      return `${subject} and HEAD come from different project histories; ${files}`;
    }
    case "dirty": {
      const n = result.changedFileCount;
      return `${plural(n, "working-tree file")} ${n === 1 ? "has" : "have"} changed and ${n === 1 ? "is" : "are"} not represented by the ${name} graph's commit metadata.`;
    }
    case "revision": {
      const now = `this page was packed at ${shortRevision(result.currentRevision)}`;
      return result.graphRevision === null
        ? `${subject} records no source revision; ${now}.`
        : `${subject} was made from ${shortRevision(result.graphRevision)}; ${now}.`;
    }
    case "unknown":
      return result.reason === "freshness-request-failed"
        ? "The dashboard could not refresh graph freshness data."
        : `${subject} ${UNKNOWN_SUMMARY[result.reason]}.`;
  }
}

/** One line per graph that is not fresh: "Knowledge graph: ...". Empty for no report or all fresh. */
export function freshnessLines(report: DashboardFreshnessReport | null): string[] {
  if (!report) return [];
  const lines: string[] = [];
  const knowledge = sentence("knowledge", report.graphs.knowledge);
  if (knowledge !== null) lines.push(`Knowledge graph: ${knowledge}`);
  if (report.graphs.domain) {
    const domain = sentence("domain", report.graphs.domain);
    if (domain !== null) lines.push(`Domain graph: ${domain}`);
  }
  return lines;
}
