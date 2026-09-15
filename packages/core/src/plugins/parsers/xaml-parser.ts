import type { AnalyzerPlugin, StructuralAnalysis, SectionInfo, DefinitionInfo } from "../../types.js";

/**
 * Parses XAML view markup (.xaml, WPF/MAUI) into anchored, single-file facts.
 * The view becomes one section (named by the x:Class short name, else the root
 * element); x:Class becomes a "code-behind" definition, x:DataType a "datatype",
 * x:Name an "element", {Binding …} a "binding", and Command="{Binding …}" a
 * "command". Each binding/command records its file-level DataType context in
 * fields (context=<type> when the file has exactly one x:DataType, else
 * context=none). This is a single-file reader: it never asserts that a ViewModel
 * member exists and never emits a member edge — that cross-file resolution is a
 * later stage. Line-based and deterministic.
 */
export class XamlParser implements AnalyzerPlugin {
  name = "xaml-parser";
  languages = ["xaml"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    const { sections, definitions } = this.extract(content);
    return {
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      sections,
      definitions,
    };
  }

  private extract(content: string): { sections: SectionInfo[]; definitions: DefinitionInfo[] } {
    const lines = content.split("\n");
    const sections: SectionInfo[] = [];
    const definitions: DefinitionInfo[] = [];

    // Pre-pass: file-level DataType context, the x:Class (for the view name),
    // and the first real element line (the root, skipping the <?xml?> prolog).
    const dataTypes: string[] = [];
    let xClass: string | null = null;
    let rootLine = 0;
    let rootTag = "";
    for (let i = 0; i < lines.length; i++) {
      if (rootLine === 0) {
        const rt = lines[i].match(/^\s*<([A-Za-z][\w.]*)/);
        if (rt) {
          rootLine = i + 1;
          rootTag = rt[1];
        }
      }
      const dt = lines[i].match(/\bx:DataType\s*=\s*"([^"]+)"/);
      if (dt) dataTypes.push(dt[1]);
      if (xClass === null) {
        const xc = lines[i].match(/\bx:Class\s*=\s*"([^"]+)"/);
        if (xc) xClass = xc[1];
      }
    }
    const context = new Set(dataTypes).size === 1 ? dataTypes[0] : "none";

    if (rootLine > 0) {
      const viewName = xClass ? xClass.split(".").pop()! : rootTag;
      sections.push({ name: viewName, level: 1, lineRange: [rootLine, rootLine] });
    }

    // Main pass: emit definitions in file order.
    const nameRe = /\bx:Name\s*=\s*"([^"]+)"/g;
    const dtRe = /\bx:DataType\s*=\s*"([^"]+)"/g;
    const bindingRe = /([\w.:]+)\s*=\s*"(\{Binding\b[^"]*)"/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ln = i + 1;
      let m: RegExpExecArray | null;

      const xc = line.match(/\bx:Class\s*=\s*"([^"]+)"/);
      if (xc) definitions.push({ name: xc[1], kind: "code-behind", lineRange: [ln, ln], fields: [] });

      dtRe.lastIndex = 0;
      while ((m = dtRe.exec(line))) {
        definitions.push({ name: m[1], kind: "datatype", lineRange: [ln, ln], fields: [] });
      }

      nameRe.lastIndex = 0;
      while ((m = nameRe.exec(line))) {
        definitions.push({ name: m[1], kind: "element", lineRange: [ln, ln], fields: [] });
      }

      bindingRe.lastIndex = 0;
      while ((m = bindingRe.exec(line))) {
        const attr = m[1];
        const path = this.parseBindingPath(m[2]);
        const kind = /Command$/.test(attr) ? "command" : "binding";
        definitions.push({
          name: path || "(context)",
          kind,
          lineRange: [ln, ln],
          fields: [`context=${context}`],
        });
      }
    }

    return { sections, definitions };
  }

  /** Extract the bound property path from a `{Binding …}` markup value. */
  private parseBindingPath(value: string): string {
    const body = value.replace(/^\{Binding\b/, "").replace(/\}$/, "").trim();
    const pathEq = body.match(/(?:^|[\s,])Path\s*=\s*([^,}\s]+)/);
    if (pathEq) return pathEq[1];
    const first = body.split(/[,\s]/)[0] ?? "";
    return first.includes("=") ? "" : first;
  }
}
