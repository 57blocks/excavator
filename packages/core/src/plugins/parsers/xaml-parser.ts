import type { AnalyzerPlugin, StructuralAnalysis, SectionInfo, DefinitionInfo } from "../../types.js";

interface AttributeToken {
  name: string;
  value: string;
  offset: number;
}

interface StartTag {
  name: string;
  attributes: AttributeToken[];
  selfClosing: boolean;
}

/** Find the end of a tag without mistaking a quoted `>` for its delimiter. */
function tagEnd(content: string, start: number): number {
  let quote = "";
  for (let i = start + 1; i < content.length; i++) {
    const char = content[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }
  return -1;
}

/** Preserve UTF-16 offsets and line breaks while removing non-element content. */
function maskNonElements(content: string): string {
  const masked = content.split("");
  let cursor = 0;
  while (cursor < content.length) {
    const start = content.indexOf("<", cursor);
    if (start < 0) break;

    let end = -1;
    if (content.startsWith("<!--", start)) {
      const close = content.indexOf("-->", start + 4);
      end = close < 0 ? content.length : close + 3;
    } else if (content.startsWith("<![CDATA[", start)) {
      const close = content.indexOf("]]>", start + 9);
      end = close < 0 ? content.length : close + 3;
    } else if (content.startsWith("<?", start)) {
      const close = content.indexOf("?>", start + 2);
      end = close < 0 ? content.length : close + 2;
    } else if (content.startsWith("<!", start)) {
      const close = tagEnd(content, start);
      end = close < 0 ? content.length : close + 1;
    }

    if (end < 0) {
      cursor = start + 1;
      continue;
    }
    for (let i = start; i < end; i++) {
      if (masked[i] !== "\n") masked[i] = " ";
    }
    cursor = end;
  }
  return masked.join("");
}

/** Return null for an incomplete or ambiguous start tag instead of guessing. */
function parseStartTag(content: string, start: number, end: number): StartTag | null {
  let cursor = start + 1;
  const nameMatch = /^[A-Za-z_][\w.:-]*/.exec(content.slice(cursor, end));
  if (!nameMatch) return null;
  const name = nameMatch[0];
  cursor += name.length;
  const attributes: AttributeToken[] = [];
  let selfClosing = false;

  while (cursor < end) {
    while (cursor < end && /\s/.test(content[cursor])) cursor++;
    if (cursor >= end) break;
    if (content[cursor] === "/" && /^\s*$/.test(content.slice(cursor + 1, end))) {
      selfClosing = true;
      break;
    }

    const offset = cursor;
    const attrMatch = /^[A-Za-z_][\w.:-]*/.exec(content.slice(cursor, end));
    if (!attrMatch) return null;
    cursor += attrMatch[0].length;
    while (cursor < end && /\s/.test(content[cursor])) cursor++;
    if (content[cursor] !== "=") return null;
    cursor++;
    while (cursor < end && /\s/.test(content[cursor])) cursor++;
    const quote = content[cursor];
    if (quote !== '"' && quote !== "'") return null;
    const valueStart = ++cursor;
    const valueEnd = content.indexOf(quote, cursor);
    if (valueEnd < 0 || valueEnd >= end) return null;
    attributes.push({ name: attrMatch[0], value: content.slice(valueStart, valueEnd), offset });
    cursor = valueEnd + 1;
  }

  return { name, attributes, selfClosing };
}

function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] <= offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function dataTypeContext(value: string): string {
  return value && !value.trim().startsWith("{") ? value : "none";
}

/** Single-file XAML facts only; a lexical type hint is never a member edge. */
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
    const markup = maskNonElements(content);
    const starts = lineStarts(content);
    const sections: SectionInfo[] = [];
    const definitions: DefinitionInfo[] = [];
    const stack: Array<{ name: string; context: string }> = [];
    let contextAmbiguous = false;
    let rootSeen = false;
    let cursor = 0;

    while (cursor < markup.length) {
      const start = markup.indexOf("<", cursor);
      if (start < 0) break;
      const end = tagEnd(markup, start);
      if (end < 0) break;
      cursor = end + 1;

      if (markup[start + 1] === "/") {
        const closing = /^\/\s*([A-Za-z_][\w.:-]*)\s*$/.exec(markup.slice(start + 1, end));
        if (closing && stack.at(-1)?.name === closing[1]) stack.pop();
        else {
          stack.length = 0;
          contextAmbiguous = true;
        }
        continue;
      }

      const tag = parseStartTag(markup, start, end);
      if (!tag) {
        stack.length = 0;
        contextAmbiguous = true;
        continue;
      }
      const localType = tag.attributes.find((a) => a.name === "x:DataType");
      const inherited = contextAmbiguous ? "none" : (stack.at(-1)?.context ?? "none");
      const context = localType ? dataTypeContext(localType.value) : inherited;

      if (!rootSeen) {
        const xClass = tag.attributes.find((a) => a.name === "x:Class")?.value;
        sections.push({
          name: xClass ? xClass.split(".").pop()! : tag.name,
          level: 1,
          lineRange: [lineAt(starts, start), lineAt(starts, start)],
        });
        rootSeen = true;
      }

      for (const attr of tag.attributes) {
        const ln = lineAt(starts, attr.offset);
        if (attr.name === "x:Class") {
          definitions.push({ name: attr.value, kind: "code-behind", lineRange: [ln, ln], fields: [] });
        } else if (attr.name === "x:DataType") {
          definitions.push({ name: attr.value, kind: "datatype", lineRange: [ln, ln], fields: [] });
        } else if (attr.name === "x:Name") {
          definitions.push({ name: attr.value, kind: "element", lineRange: [ln, ln], fields: [] });
        } else if (/^\{Binding\b/.test(attr.value)) {
          const path = this.parseBindingPath(attr.value);
          const kind = /Command$/.test(attr.name) ? "command" : "binding";
          const alternateSource = /(?:^|[\s,])(?:Source|RelativeSource)\s*=/.test(attr.value);
          definitions.push({
            name: path || "(context)",
            kind,
            lineRange: [ln, ln],
            fields: [`context=${alternateSource ? "none" : context}`],
          });
        }
      }

      if (!tag.selfClosing) stack.push({ name: tag.name, context });
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
