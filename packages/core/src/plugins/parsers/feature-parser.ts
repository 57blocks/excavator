import type { AnalyzerPlugin, StructuralAnalysis, SectionInfo, StepInfo } from "../../types.js";

/**
 * Parses Gherkin feature files (.feature) into anchored structure:
 * - Feature -> section (level 1)
 * - Scenario / Scenario Outline -> section (level 2)
 * - Given/When/Then/And/But lines -> steps (name is the original step text)
 *
 * Tag lines (@...), comments (#), doc-string bodies ("""/'''), data tables (|)
 * and Examples/description lines are ignored. Line-based and deterministic.
 */
export class FeatureParser implements AnalyzerPlugin {
  name = "feature-parser";
  languages = ["feature"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    const lines = content.split("\n");
    const sections: SectionInfo[] = [];
    const steps: StepInfo[] = [];
    let inDocString = false;
    let docDelim = "";

    for (let i = 0; i < lines.length; i++) {
      const ln = i + 1;
      const trimmed = lines[i].trim();

      // Doc strings ("""...""" or '''...''') are step arguments: skip their body.
      const docMatch = trimmed.match(/^("""|''')/);
      if (docMatch) {
        if (inDocString && docMatch[1] === docDelim) {
          inDocString = false;
          docDelim = "";
        } else if (!inDocString) {
          inDocString = true;
          docDelim = docMatch[1];
        }
        continue;
      }
      if (inDocString) continue;
      if (trimmed === "" || trimmed.startsWith("#")) continue;

      const feat = trimmed.match(/^Feature:\s*(.*)$/);
      if (feat) {
        sections.push({ name: feat[1].trim(), level: 1, lineRange: [ln, ln] });
        continue;
      }

      const scen = trimmed.match(/^(?:Scenario Outline|Scenario):\s*(.*)$/);
      if (scen) {
        sections.push({ name: scen[1].trim(), level: 2, lineRange: [ln, ln] });
        continue;
      }

      if (/^(?:Given|When|Then|And|But)\b/.test(trimmed)) {
        steps.push({ name: trimmed, lineRange: [ln, ln] });
        continue;
      }
    }

    return { functions: [], classes: [], imports: [], exports: [], sections, steps };
  }
}
