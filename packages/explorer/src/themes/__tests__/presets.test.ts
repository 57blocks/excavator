import { describe, it, expect } from "vitest";
import { DEFAULT_THEME_CONFIG, PRESETS, getAccent, getPreset } from "../index.ts";

describe("theme presets", () => {
  it("defaults to light-violet with the violet accent", () => {
    expect(DEFAULT_THEME_CONFIG.presetId).toBe("light-violet");
    expect(DEFAULT_THEME_CONFIG.accentId).toBe("violet");
  });

  it("defines the dark violet preset", () => {
    const p = getPreset("dark-violet");
    expect(p.id).toBe("dark-violet");
    expect(p.isDark).toBe(true);
    expect(p.colors.root).toBe("#0C0C0E");
    expect(getAccent(p, "violet").accent).toBe("#7C5CFF");
  });

  it("defines the light violet preset", () => {
    const p = getPreset("light-violet");
    expect(p.id).toBe("light-violet");
    expect(p.isDark).toBe(false);
    expect(p.colors.root).toBe("#EDEDEF");
    expect(getAccent(p, "violet").accent).toBe("#6A4DFF");
  });

  it("falls back to light-violet for an unknown id", () => {
    expect(getPreset("unknown").id).toBe("light-violet");
  });

  it("lists light-violet before dark-violet, and the default preset has the default accent", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(ids.indexOf("light-violet")).toBeLessThan(ids.indexOf("dark-violet"));
    const preset = getPreset(DEFAULT_THEME_CONFIG.presetId);
    expect(preset.accentSwatches.map((s) => s.id)).toContain(DEFAULT_THEME_CONFIG.accentId);
  });

  it("keeps every earlier preset available", () => {
    const ids = PRESETS.map((p) => p.id);
    for (const id of ["dark-gold", "dark-ocean", "dark-forest", "dark-rose", "light-minimal"]) {
      expect(ids).toContain(id);
    }
  });
});
