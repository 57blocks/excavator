import { afterEach, describe, expect, it } from "vitest";
import { readStored, writeStored } from "../safeStorage";

const scope = globalThis as Record<string, unknown>;

function useStorage(storage: unknown) {
  scope.window = { localStorage: storage };
}

afterEach(() => {
  delete scope.window;
});

describe("safeStorage", () => {
  it("reads and writes through a working storage", () => {
    const map = new Map<string, string>();
    useStorage({ getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) });
    expect(readStored("k")).toBeNull();
    writeStored("k", "1");
    expect(readStored("k")).toBe("1");
  });

  it("a storage whose methods throw reads as empty and ignores writes", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    useStorage({ getItem: boom, setItem: boom });
    expect(readStored("k")).toBeNull();
    expect(() => writeStored("k", "1")).not.toThrow();
  });

  it("a localStorage getter that throws reads as empty and ignores writes", () => {
    Object.defineProperty(scope, "window", {
      configurable: true,
      get() {
        return {
          get localStorage(): never {
            throw new Error("SecurityError");
          },
        };
      },
    });
    expect(readStored("k")).toBeNull();
    expect(() => writeStored("k", "1")).not.toThrow();
  });

  it("no window at all reads as empty and ignores writes", () => {
    expect(readStored("k")).toBeNull();
    expect(() => writeStored("k", "1")).not.toThrow();
  });
});
