import type {
  AnalyzerPlugin,
  StructuralAnalysis,
  SectionInfo,
  StepInfo,
  UnplacedLines,
} from "../../types.js";

// English keywords of the Gherkin reference grammar (cucumber/gherkin,
// gherkin-languages.json "en"). A title keyword is followed by a colon, a step
// keyword by a space.
const TITLES = [
  { kind: "feature", keywords: ["Feature", "Business Need", "Ability"] },
  { kind: "rule", keywords: ["Rule"] },
  { kind: "background", keywords: ["Background"] },
  { kind: "scenario", keywords: ["Scenario", "Example", "Scenario Outline", "Scenario Template"] },
  { kind: "examples", keywords: ["Examples", "Scenarios"] },
] as const;
const STEP = /^(?:Given|When|Then|And|But|\*) /;
const DOC_STRING = /^("""|```)/;
const LANGUAGE = /^#\s*language\s*:\s*([a-zA-Z\-_]+)\s*$/;

type TitleKind = (typeof TITLES)[number]["kind"];
type LineKind = TitleKind | "step" | "row" | "doc-string" | "text";

// Where the last accepted header left the reader: before the Feature line,
// in a Feature's or Rule's header, or in a Background, Scenario or Examples.
type Context = "start" | "container" | "background" | "scenario" | "examples";

/**
 * Parses Gherkin feature files (.feature) into anchored structure, placing
 * each line where the reference grammar places it. Feature, Rule, Background
 * and each Scenario / Scenario Outline become sections (level 1 for Feature,
 * 2 for Rule, and 2 or 3 for the rest depending on whether they sit under a
 * Rule). A step line under a Background or Scenario becomes a step whose
 * name is the original step text. Description text, tags, comments, data
 * tables, Examples, and doc strings produce no record. A header, step, table
 * row, doc string or text that has no place where it stands, an unclosed doc
 * string, and a file in a language other than English are recorded as
 * unplaced lines instead of being dropped. Rules that only decide whether a
 * file is valid are not checked: what may follow a tag, and how many
 * arguments a step takes. A line that breaks one keeps the role its place
 * gives it. Line-based and deterministic.
 */
export class FeatureParser implements AnalyzerPlugin {
  name = "feature-parser";
  languages = ["feature"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    const { sections, steps, unplaced } = this.extract(content);
    return {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      sections,
      steps,
      ...(unplaced.length > 0 ? { unplaced } : {}),
    };
  }

  private extract(content: string): {
    sections: SectionInfo[];
    steps: StepInfo[];
    unplaced: UnplacedLines[];
  } {
    const lines = content.split("\n");
    const sections: SectionInfo[] = [];
    const steps: StepInfo[] = [];
    const unplaced: UnplacedLines[] = [];
    let lastLine = 0;
    for (let i = lines.length - 1; i >= 0 && lastLine === 0; i--) {
      if (lines[i].trim() !== "") lastLine = i + 1;
    }

    const unplace = (reason: string, from: number, to: number): void => {
      const previous = unplaced[unplaced.length - 1];
      if (previous && previous.reason === reason && previous.lineRange[1] === from - 1) {
        previous.lineRange[1] = to;
      } else {
        unplaced.push({ reason, lineRange: [from, to] });
      }
    };

    let context: Context = "start";
    // Set by the first step (Background, Scenario) or table row (Examples):
    // from there on the block has no description.
    let body = false;
    let inRule = false;
    let docString: string | null = null;
    let docStringStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const ln = i + 1;
      const text = lines[i].trimStart();

      if (docString !== null) {
        if (text.startsWith(docString)) docString = null;
        continue;
      }
      if (text.trim() === "") continue;
      if (text.startsWith("#")) {
        const language = context === "start" ? LANGUAGE.exec(text) : null;
        if (language && language[1] !== "en") {
          unplace("unsupported-language", ln, lastLine);
          return { sections: [], steps: [], unplaced };
        }
        continue;
      }
      if (text.startsWith("@")) continue;

      const { kind, title } = classify(text);
      const inSteps = context === "background" || context === "scenario";
      const level = inRule ? 3 : 2;
      // Each accepted line moves on to the next line; a line no case
      // accepts falls through to the check below.
      switch (kind) {
        case "feature":
          if (context !== "start") break;
          sections.push({ name: title, level: 1, lineRange: [ln, ln] });
          context = "container";
          continue;
        case "rule":
          if (context === "start") break;
          sections.push({ name: title, level: 2, lineRange: [ln, ln] });
          context = "container";
          inRule = true;
          continue;
        case "background":
          if (context !== "container") break;
          sections.push({ name: title, level, lineRange: [ln, ln] });
          context = "background";
          body = false;
          continue;
        case "scenario":
          if (context === "start") break;
          sections.push({ name: title, level, lineRange: [ln, ln] });
          context = "scenario";
          body = false;
          continue;
        case "examples":
          if (context !== "scenario" && context !== "examples") break;
          context = "examples";
          body = false;
          continue;
        case "step":
          if (!inSteps) break;
          steps.push({ name: text.trim(), lineRange: [ln, ln] });
          body = true;
          continue;
        case "row":
          if (context === "examples") {
            body = true;
            continue;
          }
          if (inSteps && body) continue;
          break;
        case "doc-string":
          if (!inSteps || !body) break;
          docString = DOC_STRING.exec(text)![1];
          docStringStart = ln;
          continue;
      }

      // The grammar reads a line it does not accept in a description as
      // description text; anywhere else it rejects the line.
      const inDescription = context === "container" || (context !== "start" && !body);
      if (!inDescription) unplace("out-of-place", ln, ln);
    }

    if (docString !== null) unplace("unclosed-doc-string", docStringStart, lastLine);
    return { sections, steps, unplaced };
  }
}

function classify(text: string): { kind: LineKind; title: string } {
  for (const { kind, keywords } of TITLES) {
    for (const keyword of keywords) {
      if (text.startsWith(`${keyword}:`)) {
        return { kind, title: text.slice(keyword.length + 1).trim() };
      }
    }
  }
  if (STEP.test(text)) return { kind: "step", title: "" };
  if (text.startsWith("|")) return { kind: "row", title: "" };
  if (DOC_STRING.test(text)) return { kind: "doc-string", title: "" };
  return { kind: "text", title: "" };
}
