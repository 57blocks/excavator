import { describe, expect, it } from "vitest";
import { historyLabel, type HistoryNames } from "../historyLabel";

const names: HistoryNames = {
  domain: (id) => ({ "d:1": "Billing" })[id] ?? null,
  group: (domainId, groupId) => (domainId === "d:1" && groupId === "g:1" ? { label: "invoices", qualifier: "billing-service" } : domainId === "d:1" && groupId === "g:2" ? { label: "reports", qualifier: null } : null),
  layer: (id) => ({ "layer:api": "API" })[id] ?? null,
  folder: (id) => ({ "container:auth": "auth" })[id] ?? null,
};

const base = { viewMode: "domain" as const, activeDomainId: null, activeGroupId: null, navigationLevel: "overview" as const, activeLayerId: null, expandedContainers: new Set<string>() };

describe("historyLabel", () => {
  it("names the domain overview", () => {
    expect(historyLabel(base, names)).toBe("All domains");
  });
  it("names a domain level by its domain, not by what was selected", () => {
    expect(historyLabel({ ...base, activeDomainId: "d:1" }, names)).toBe("Billing");
  });
  it("names a group's lanes by its displayed name, label and qualifier", () => {
    expect(historyLabel({ ...base, activeDomainId: "d:1", activeGroupId: "g:1" }, names)).toBe("invoices · billing-service");
    expect(historyLabel({ ...base, activeDomainId: "d:1", activeGroupId: "g:2" }, names)).toBe("reports");
  });
  it("names the structural overview", () => {
    expect(historyLabel({ ...base, viewMode: "structural" }, names)).toBe("Project overview");
  });
  it("names a layer by its name", () => {
    expect(historyLabel({ ...base, viewMode: "structural", navigationLevel: "layer-detail", activeLayerId: "layer:api" }, names)).toBe("API");
  });
  it("names the folder an open layer shows when one is expanded", () => {
    const entry = { ...base, viewMode: "structural" as const, navigationLevel: "layer-detail" as const, activeLayerId: "layer:api", expandedContainers: new Set(["container:other", "container:auth"]) };
    expect(historyLabel(entry, names)).toBe("auth");
  });
  it("falls back to a plain name when the data has none", () => {
    expect(historyLabel({ ...base, activeDomainId: "d:gone" }, names)).toBe("Domain");
    expect(historyLabel({ ...base, viewMode: "structural", navigationLevel: "layer-detail", activeLayerId: "layer:gone" }, names)).toBe("Layer");
  });
});
