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
  it("captures Feature, Background and Scenario(-Outline) as anchored sections", () => {
    const s = parser.analyzeFile("Participants.feature", SAMPLE).sections ?? [];
    expect(s.map((x) => x.name)).toEqual([
      "Participant management",
      "",
      "Pair the app",
      "End a participant",
    ]);
    const background = s[1];
    expect(background.level).toBe(2);
    expect(background.lineRange).toEqual([5, 5]);
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
    expect((a.sections ?? []).length).toBe(4);
    expect(a.unplaced).toBeUndefined();
  });

  it("returns empty for empty content", () => {
    const a = parser.analyzeFile("empty.feature", "");
    expect(a.sections ?? []).toHaveLength(0);
    expect(a.steps ?? []).toHaveLength(0);
    expect(a.unplaced).toBeUndefined();
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

// One line per argument, numbered from 1 in the order given.
function gherkin(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

function analyze(content: string) {
  const a = parser.analyzeFile("x.feature", content);
  return {
    sections: (a.sections ?? []).map((s) => [s.name, s.level, s.lineRange[0]]),
    steps: (a.steps ?? []).map((s) => s.name),
    unplaced: a.unplaced ?? [],
  };
}

describe("FeatureParser places lines by the Gherkin reference grammar", () => {
  it("skips a backtick doc string", () => {
    const a = analyze(gherkin(
      "Feature: Documents",
      "  Scenario: Upload",
      "    Given a request body",
      "      ```json",
      "      Scenario: not a scenario",
      "      Given not a step",
      "      ```",
      "    Then the body is stored",
    ));
    expect(a.sections).toEqual([["Documents", 1, 1], ["Upload", 2, 2]]);
    expect(a.steps).toEqual(["Given a request body", "Then the body is stored"]);
    expect(a.unplaced).toEqual([]);
  });

  it("does not take three single quotes as a doc string separator", () => {
    const a = analyze(gherkin(
      "Feature: Notes",
      "  Scenario: Save",
      "    Given a note",
      "    '''",
      "    Then the note is saved",
    ));
    expect(a.steps).toEqual(["Given a note", "Then the note is saved"]);
    expect(a.unplaced).toEqual([{ reason: "out-of-place", lineRange: [4, 4] }]);
  });

  it("reads a step keyword in a Feature description as description text", () => {
    const a = analyze(gherkin(
      "Feature: Accounts",
      "  Given a manager signs in, the account list loads",
      "  Scenario: Sign in",
      "    Given a manager",
      "    When the manager signs in",
    ));
    expect(a.sections).toEqual([["Accounts", 1, 1], ["Sign in", 2, 3]]);
    expect(a.steps).toEqual(["Given a manager", "When the manager signs in"]);
    expect(a.unplaced).toEqual([]);
  });

  it("does not open a doc string from a description", () => {
    const a = analyze(gherkin(
      "Feature: Accounts",
      '  """ quoted in the description',
      "  Scenario: Sign in",
      "    Given a manager",
    ));
    expect(a.sections).toEqual([["Accounts", 1, 1], ["Sign in", 2, 3]]);
    expect(a.steps).toEqual(["Given a manager"]);
    expect(a.unplaced).toEqual([]);
  });

  it("records Rule, Background, Example and Scenario Template as sections", () => {
    const a = analyze(gherkin(
      "Feature: Orders",
      "  Background:",
      "    Given a signed-in user",
      "  Rule: Orders need stock",
      "    Background:",
      "      Given a stocked item",
      "    Example: Order an item",
      "      When the user orders it",
      "      Then the order is placed",
      "    Scenario Template: Order <count> items",
      "      When the user orders <count>",
      "      Then the order is <state>",
      "      Scenarios:",
      "        | count | state  |",
      "        | 1     | placed |",
    ));
    expect(a.sections).toEqual([
      ["Orders", 1, 1],
      ["", 2, 2],
      ["Orders need stock", 2, 4],
      ["", 3, 5],
      ["Order an item", 3, 7],
      ["Order <count> items", 3, 10],
    ]);
    expect(a.steps).toEqual([
      "Given a signed-in user",
      "Given a stocked item",
      "When the user orders it",
      "Then the order is placed",
      "When the user orders <count>",
      "Then the order is <state>",
    ]);
    expect(a.unplaced).toEqual([]);
  });

  it("reads Business Need and Ability as Feature headers", () => {
    for (const keyword of ["Business Need", "Ability"]) {
      const a = analyze(gherkin(
        `${keyword}: Checkout`,
        "  Scenario: Pay",
        "    Given a full cart",
      ));
      expect(a.sections, keyword).toEqual([["Checkout", 1, 1], ["Pay", 2, 2]]);
      expect(a.steps, keyword).toEqual(["Given a full cart"]);
      expect(a.unplaced, keyword).toEqual([]);
    }
  });

  it("records * and But steps", () => {
    const a = analyze(gherkin(
      "Feature: Dialogs",
      "  Scenario: Close",
      "    * the app is open",
      "    When the user closes the dialog",
      "    But no other dialog is shown",
    ));
    expect(a.steps).toEqual([
      "* the app is open",
      "When the user closes the dialog",
      "But no other dialog is shown",
    ]);
  });

  it("records a non-empty file with no Gherkin structure as unplaced", () => {
    const a = analyze(gherkin(
      "These are release notes,",
      "not a feature file.",
      "Given this line, nothing here is a step.",
    ));
    expect(a.sections).toEqual([]);
    expect(a.steps).toEqual([]);
    expect(a.unplaced).toEqual([{ reason: "out-of-place", lineRange: [1, 3] }]);
  });

  it("records free text after a step as unplaced and keeps the steps around it", () => {
    const a = analyze(gherkin(
      "Feature: Search",
      "  Scenario: Find",
      "    Given an index",
      "    the index is warm",
      "    When the user searches",
    ));
    expect(a.steps).toEqual(["Given an index", "When the user searches"]);
    expect(a.unplaced).toEqual([{ reason: "out-of-place", lineRange: [4, 4] }]);
  });

  it("records an unclosed doc string to the last non-empty line", () => {
    const a = analyze(gherkin(
      "Feature: Import",
      "  Scenario: Upload",
      "    Given a file",
      '      """',
      "      Scenario: inside the doc string",
      "  Scenario: Later",
      "    Then nothing is read",
      "",
    ));
    expect(a.sections).toEqual([["Import", 1, 1], ["Upload", 2, 2]]);
    expect(a.steps).toEqual(["Given a file"]);
    expect(a.unplaced).toEqual([{ reason: "unclosed-doc-string", lineRange: [4, 7] }]);
  });

  it("records a file in another language as unplaced and reads none of it", () => {
    // Dutch keywords; "Scenario" is one of them, so an English reading
    // would take line 3 for a scenario.
    const a = analyze(gherkin(
      "# language: nl",
      "Functionaliteit: Zoeken",
      "  Scenario: Vinden",
      "    Gegeven een index",
    ));
    expect(a.sections).toEqual([]);
    expect(a.steps).toEqual([]);
    expect(a.unplaced).toEqual([{ reason: "unsupported-language", lineRange: [1, 4] }]);
  });

  it("records Examples after Background steps and a step after Examples rows as unplaced", () => {
    const a = analyze(gherkin(
      "Feature: Tables",
      "  Background:",
      "    Given a table",
      "  Examples:",
      "  Scenario Outline: Use <n> rows",
      "    Given <n> rows",
      "    Examples:",
      "      | n |",
      "      | 1 |",
      "    Then a step after the rows",
    ));
    expect(a.steps).toEqual(["Given a table", "Given <n> rows"]);
    expect(a.unplaced).toEqual([
      { reason: "out-of-place", lineRange: [4, 4] },
      { reason: "out-of-place", lineRange: [10, 10] },
    ]);
  });
});
