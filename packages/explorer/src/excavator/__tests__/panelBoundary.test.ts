import { describe, expect, it, vi } from "vitest";
import { PanelBoundary } from "../panel/PanelBoundary";

const make = (resetKey: string) => {
  const boundary = new PanelBoundary({ resetKey, children: "content" });
  // setState is applied by hand: the boundary is exercised without a renderer.
  boundary.setState = vi.fn((update: unknown) => {
    boundary.state = { ...boundary.state, ...(update as object) };
  }) as never;
  return boundary;
};

const text = (node: unknown): string => {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  if (node !== null && typeof node === "object" && "props" in node) return text((node as { props: { children?: unknown } }).props.children);
  return "";
};

describe("the side panel's error boundary", () => {
  it("renders its content while nothing failed", () => {
    expect(make("a").render()).toBe("content");
  });

  it("turns an error into a muted line with the message", () => {
    const boundary = make("a");
    boundary.state = PanelBoundary.getDerivedStateFromError(new Error("boom"));
    expect(text(boundary.render())).toBe("This panel could not be shown: boom");
    expect(PanelBoundary.getDerivedStateFromError("plain").error).toBe("plain");
  });

  it("resets when the selection or view changes, and only then", () => {
    const boundary = make("node:a");
    boundary.state = PanelBoundary.getDerivedStateFromError(new Error("boom"));
    boundary.componentDidUpdate({ resetKey: "node:a", children: "content" });
    expect(boundary.state.error).toBe("boom");
    Object.assign(boundary, { props: { resetKey: "node:b", children: "content" } });
    boundary.componentDidUpdate({ resetKey: "node:a", children: "content" });
    expect(boundary.state.error).toBeNull();
    expect(boundary.render()).toBe("content");
  });
});
