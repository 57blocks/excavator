import type { AnalyzerPlugin, StructuralAnalysis, DefinitionInfo } from "../../types.js";

/**
 * Parses MSBuild project files (.csproj) into anchored definitions. Each
 * <PackageReference> becomes a "dependency" definition (its version — whether an
 * attribute or a <Version> child element — carried in fields, and an absent
 * version left empty rather than guessed); <TargetFramework(s)> becomes a
 * "target" and <UseMaui> a "property". Line-based and deterministic. Does not
 * evaluate MSBuild imports, conditions, or property substitution.
 */
export class CsprojParser implements AnalyzerPlugin {
  name = "csproj-parser";
  languages = ["csproj"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    return {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      definitions: this.extractDefinitions(content),
    };
  }

  private extractDefinitions(content: string): DefinitionInfo[] {
    const lines = content.split("\n");
    const definitions: DefinitionInfo[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ln = i + 1;

      const tf = line.match(/<TargetFrameworks?>([^<]+)<\/TargetFrameworks?>/);
      if (tf) {
        definitions.push({ name: tf[1].trim(), kind: "target", lineRange: [ln, ln], fields: [] });
      }

      const um = line.match(/<UseMaui>([^<]*)<\/UseMaui>/);
      if (um) {
        definitions.push({
          name: "UseMaui",
          kind: "property",
          lineRange: [ln, ln],
          fields: [`value=${um[1].trim()}`],
        });
      }

      const pr = line.match(/<PackageReference\b([^>]*)>/);
      if (pr) {
        let attrs = pr[1];
        const selfClosing = attrs.trimEnd().endsWith("/");
        if (selfClosing) attrs = attrs.trimEnd().slice(0, -1);
        const inc = attrs.match(/\bInclude\s*=\s*["']([^"']+)["']/);
        if (inc) {
          const fields: string[] = [];
          const ver = attrs.match(/\bVersion\s*=\s*["']([^"']+)["']/);
          if (ver) {
            fields.push(`version=${ver[1]}`);
          } else if (!selfClosing) {
            // Version given as a child element before the closing tag.
            for (let j = i + 1; j < lines.length; j++) {
              if (/<\/PackageReference>/.test(lines[j])) break;
              const cv = lines[j].match(/<Version>([^<]+)<\/Version>/);
              if (cv) {
                fields.push(`version=${cv[1].trim()}`);
                break;
              }
            }
          }
          definitions.push({ name: inc[1], kind: "dependency", lineRange: [ln, ln], fields });
        }
      }
    }

    return definitions;
  }
}
