import { beforeEach, describe, expect, it } from "vitest";
import { useDashboardStore } from "../../store";

beforeEach(() => {
  useDashboardStore.setState(useDashboardStore.getInitialState(), true);
});

describe("the product views in the store", () => {
  it("starts with no product view, no row, the file level and every node type shown", () => {
    const s = useDashboardStore.getState();
    expect(s.productView).toBeNull();
    expect(s.productRow).toBeNull();
    expect(s.detailLevel).toBe("file");
    expect(Object.values(s.nodeTypeFilters).every((on) => on !== false)).toBe(true);
  });

  it("opens a view, switches to another, and toggles the active one off", () => {
    const store = useDashboardStore.getState();
    store.openProductView("unused");
    expect(useDashboardStore.getState().productView).toBe("unused");
    useDashboardStore.getState().toggleProductView("hotspots");
    expect(useDashboardStore.getState().productView).toBe("hotspots");
    useDashboardStore.getState().toggleProductView("hotspots");
    expect(useDashboardStore.getState().productView).toBeNull();
    useDashboardStore.getState().toggleProductView("doc-map");
    expect(useDashboardStore.getState().productView).toBe("doc-map");
  });

  it("forgets the row when the view changes or closes", () => {
    useDashboardStore.getState().openProductView("unused");
    useDashboardStore.getState().setProductRow({ id: "u1" });
    expect(useDashboardStore.getState().productRow).toEqual({ id: "u1" });
    useDashboardStore.getState().openProductView("hotspots");
    expect(useDashboardStore.getState().productRow).toBeNull();
    useDashboardStore.getState().setProductRow({ path: "src/a.js" });
    useDashboardStore.getState().closeProductView();
    expect(useDashboardStore.getState().productView).toBeNull();
    expect(useDashboardStore.getState().productRow).toBeNull();
  });

  it("keeps the selected node while a view opens and closes", () => {
    useDashboardStore.getState().selectNode("file:src/a.js");
    useDashboardStore.getState().openProductView("unused");
    expect(useDashboardStore.getState().selectedNodeId).toBe("file:src/a.js");
    useDashboardStore.getState().toggleProductView("unused");
    expect(useDashboardStore.getState().productView).toBeNull();
    expect(useDashboardStore.getState().selectedNodeId).toBe("file:src/a.js");
  });

  it("clears the view when the Domain or Structural switch is used", () => {
    useDashboardStore.getState().openProductView("doc-map");
    useDashboardStore.getState().setViewMode("domain");
    expect(useDashboardStore.getState().productView).toBeNull();
    expect(useDashboardStore.getState().productRow).toBeNull();
    expect(useDashboardStore.getState().viewMode).toBe("domain");
    useDashboardStore.getState().openProductView("hotspots");
    useDashboardStore.getState().setViewMode("structural");
    expect(useDashboardStore.getState().productView).toBeNull();
    expect(useDashboardStore.getState().viewMode).toBe("structural");
  });

  it("leaves the view mode alone when a view opens", () => {
    useDashboardStore.getState().setViewMode("domain");
    useDashboardStore.getState().openProductView("unused");
    expect(useDashboardStore.getState().viewMode).toBe("domain");
  });
});
