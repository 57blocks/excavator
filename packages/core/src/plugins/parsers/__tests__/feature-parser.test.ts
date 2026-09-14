import { describe, it, expect } from "vitest";
import { FeatureParser } from "../feature-parser.js";
import { PluginRegistry } from "../../registry.js";
import { registerAllParsers } from "../index.js";

const parser = new FeatureParser();

// Line map (1-based):
// 1  @smoke @participants
// 2  Feature: Participant management
// 3    As a study manager I want to manage participants
// 4  (blank)
// 5    Background:
// 6      Given the study manager is signed in
// 7  (blank)
// 8    # happy path
// 9    Scenario: Pair the app
// 10     Given a participant exists
// 11     When the user taps "Pair App"
// 12     Then a QR code dialog is shown
// 13     And the old QR code becomes invalid
// 14 (blank)
// 15   Scenario Outline: End a participant
// 16     Given a participant in state "<state>"
// 17     When the manager confirms end
// 18     Then the participant is ended
// 19     """
// 20     Given this line is inside a docstring and must be ignored
// 21     """
// 22     Examples:
// 23       | state     |
// 24       | Recording |
const SAMPLE = `@smoke @participants
Feature: Participant management
  As a study manager I want to manage participants

  Background:
    Given the study manager is signed in

  # happy path
  Scenario: Pair the app
    Given a participant exists
    When the user taps "Pair App"
    Then a QR code dialog is shown
    And the old QR code becomes invalid

  Scenario Outline: End a participant
    Given a participant in state "<state>"
    When the manager confirms end
    Then the participant is ended
    """
    Given this line is inside a docstring and must be ignored
    """
    Examples:
      | state     |
      | Recording |
`;

describe("FeatureParser", () => {
  it("captures Feature and Scenario(-Outline) as anchored sections", () => {
    const s = parser.analyzeFile("Participants.feature", SAMPLE).sections ?? [];
    expect(s.map((x) => x.name)).toEqual([
      "Participant management",
      "Pair the app",
      "End a participant",
    ]);
    const feat = s.find((x) => x.name === "Participant management")!;
    expect(feat.level).toBe(1);
    expect(feat.lineRange).toEqual([2, 2]);
    const scen = s.find((x) => x.name === "Pair the app")!;
    expect(scen.level).toBe(2);
    expect(scen.lineRange).toEqual([9, 9]);
    const outline = s.find((x) => x.name === "End a participant")!;
    expect(outline.level).toBe(2);
    expect(outline.lineRange).toEqual([15, 15]);
  });

  it("captures Given/When/Then/And steps with original text and line", () => {
    const steps = parser.analyzeFile("x.feature", SAMPLE).steps ?? [];
    const tap = steps.find((x) => x.name === 'When the user taps "Pair App"');
    expect(tap).toBeDefined();
    expect(tap!.lineRange).toEqual([11, 11]);
    expect(steps.map((x) => x.name)).toContain("Given the study manager is signed in");
    expect(steps).toHaveLength(8);
  });

  it("ignores comments, tags, doc-string bodies, and data tables", () => {
    const a = parser.analyzeFile("x.feature", SAMPLE);
    const steps = a.steps ?? [];
    expect(steps.some((x) => x.name.includes("inside a docstring"))).toBe(false);
    expect((a.sections ?? []).length).toBe(3);
  });

  it("returns empty for empty content", () => {
    const a = parser.analyzeFile("empty.feature", "");
    expect(a.sections ?? []).toHaveLength(0);
    expect(a.steps ?? []).toHaveLength(0);
  });

  it("is deterministic across runs", () => {
    const a = JSON.stringify(parser.analyzeFile("x.feature", SAMPLE));
    const b = JSON.stringify(parser.analyzeFile("x.feature", SAMPLE));
    expect(a).toBe(b);
  });

  it("is registered so .feature resolves to the feature parser", () => {
    const registry = new PluginRegistry();
    registerAllParsers(registry);
    expect(registry.getLanguageForFile("Participants.feature")).toBe("feature");
    expect(registry.getPluginForFile("Participants.feature")?.name).toBe("feature-parser");
  });
});
