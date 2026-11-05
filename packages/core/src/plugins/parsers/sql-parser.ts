import type {
  AnalyzerPlugin,
  StructuralAnalysis,
  DefinitionInfo,
  UnplacedLines,
} from "../../types.js";

/**
 * Parses SQL files into statements and extracts what each CREATE statement defines.
 *
 * Extracted: TABLE (columns), VIEW, INDEX as definitions; PROCEDURE, FUNCTION and
 * TRIGGER as free functions (owner ""); PACKAGE as a class whose methods are the
 * subprograms declared in the package body (owner = package name). Names may be
 * schema-qualified and quoted with double quotes or backticks; the last segment wins.
 *
 * Statements are found on a masked copy of the file in which comments, string
 * literals and `$tag$` bodies are blanked (line structure kept), so text inside
 * them never yields a fact. A statement ends at a top-level `;`; stored code
 * (PL/SQL, MySQL bodies) ends at a lone `/` line, the next CREATE line, or EOF;
 * a `$tag$` body ends at the first `;` after its closing delimiter.
 *
 * Every other CREATE statement (SEQUENCE, SYNONYM, TYPE, ...) is returned as
 * `unplaced` with reason `unextracted-sql-object:<kind>`. DML, ALTER and GRANT
 * are not object definitions and produce nothing.
 *
 * Masking also covers: MySQL backslash escapes in strings (trade-off: a standard-SQL
 * string ending in a backslash runs on to the next quote), MySQL `#` comments at the
 * start of a line, PostgreSQL `COPY ... FROM stdin` data rows up to `\.`, and MySQL
 * `DELIMITER` blocks (the custom delimiter becomes the only terminator and `$$` is
 * not a dollar quote there). A statement without `;` also ends before the next line
 * that starts with CREATE (Hibernate-style DDL).
 *
 * Not done: calls between procedures, table reads/writes inside PL/SQL bodies,
 * and a separate node type for views. When there is no `/` terminator, a stored
 * code range extends to the next CREATE, so a GRANT in between is counted in it.
 */

type FunctionRecord = StructuralAnalysis["functions"][number];

// One name segment: bare identifier, "quoted" or `quoted`.
const SEGMENT = String.raw`(?:"[^"]+"|` + "`[^`]+`" + String.raw`|[\w$#]+)`;
const QUALIFIED_NAME = new RegExp(`${SEGMENT}(?:\\s*\\.\\s*${SEGMENT})*`, "y");
const SEGMENT_G = new RegExp(SEGMENT, "g");

const MODIFIERS = new RegExp(
  "^\\s+(?:OR\\s+(?:REPLACE|ALTER)|GLOBAL|TEMPORARY|TEMP|UNLOGGED|UNIQUE|BITMAP|PUBLIC|" +
    "EDITIONABLE|NONEDITIONABLE|FORCE|NOFORCE|EDITIONING|RECURSIVE|CLUSTERED|NONCLUSTERED|" +
    "FULLTEXT|SPATIAL|ALGORITHM\\s*=\\s*\\w+|SQL\\s+SECURITY\\s+\\w+|" +
    "DEFINER\\s*=\\s*(?:CURRENT_USER(?:\\(\\s*\\))?|[\\w%.`]*\\s*@\\s*[\\w%.`]*|\\s*))(?![\\w$#])",
  "i",
);
const KIND = /^\s+(MATERIALIZED\s+VIEW|PACKAGE\s+BODY|TYPE\s+BODY|[A-Za-z_]+)/i;
const IF_NOT_EXISTS = /^\s+IF\s+NOT\s+EXISTS\b/i;
const STORED_KINDS = new Set(["procedure", "function", "trigger", "package", "package body"]);
const PARAM_MODES = new Set(["IN", "OUT", "INOUT", "VARIADIC"]);

interface Region {
  start: number;
  end: number;
}

interface Masked {
  text: string;
  dollar: Region[];
  /** Spans where a MySQL `DELIMITER` directive made a custom delimiter the only terminator. */
  custom: Region[];
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\w$#]/.test(ch);
}

function blank(ch: string): string {
  return ch === "\n" || ch === "\r" ? ch : " ";
}

/** Blank comments, string literals and `$tag$` bodies; offsets and newlines stay put. */
function maskSource(src: string): Masked {
  const out = src.split("");
  const dollar: Region[] = [];
  const custom: Region[] = [];
  const n = src.length;
  let i = 0;
  let delimiter: string | null = null;
  let delimiterFrom = 0;
  const blankRange = (from: number, to: number): void => {
    for (let k = from; k < to; k++) out[k] = blank(src[k]);
  };
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (i === 0 || src[i - 1] === "\n") {
      const line = lineDirective(src, i);
      if (line?.delimiter !== undefined) {
        blankRange(i, line.end);
        if (delimiter !== null) custom.push({ start: delimiterFrom, end: i });
        delimiter = line.delimiter === ";" ? null : line.delimiter;
        delimiterFrom = line.end;
        i = line.end;
        continue;
      }
      if (line?.copyDataEnd !== undefined) {
        // COPY ... FROM stdin: the rows up to `\.` are data, not SQL. The COPY line stays visible.
        blankRange(line.end, line.copyDataEnd);
        i = line.copyDataEnd;
        continue;
      }
    }
    if (delimiter !== null && src.startsWith(delimiter, i) && !/^(?:--|\/\*|['"`])/.test(src.slice(i, i + 2))) {
      out[i] = ";";
      for (let k = 1; k < delimiter.length; k++) out[i + k] = " ";
      i += delimiter.length;
      continue;
    }
    if (ch === "-" && next === "-") {
      let e = i;
      while (e < n && src[e] !== "\n") e++;
      blankRange(i, e);
      i = e;
    } else if (ch === "#" && /^[ \t]*$/.test(src.slice(src.lastIndexOf("\n", i - 1) + 1, i))) {
      // MySQL `#` comment: only when it is the first non-blank character of a line,
      // so `#` inside Oracle identifiers is untouched.
      let e = i;
      while (e < n && src[e] !== "\n") e++;
      blankRange(i, e);
      i = e;
    } else if (ch === "/" && next === "*") {
      const close = src.indexOf("*/", i + 2);
      const e = close === -1 ? n : close + 2;
      blankRange(i, e);
      i = e;
    } else if (ch === "'") {
      let e: number;
      const q = src[i - 1];
      if ((q === "q" || q === "Q") && !isWordChar(src[i - 2]) && next !== undefined && !/\s/.test(next)) {
        // Oracle alternative quoting: q'[ ... ]'
        const closers: Record<string, string> = { "[": "]", "(": ")", "{": "}", "<": ">" };
        const closing = (closers[next] ?? next) + "'";
        const close = src.indexOf(closing, i + 2);
        e = close === -1 ? n : close + 2;
        out[i - 1] = " ";
      } else {
        e = i + 1;
        while (e < n) {
          if (src[e] === "\\") {
            // MySQL backslash escape. Trade-off: a standard-SQL string that ends in a
            // backslash now runs on to the next quote.
            e += 2;
            continue;
          }
          if (src[e] === "'") {
            if (src[e + 1] === "'") {
              e += 2;
              continue;
            }
            e++;
            break;
          }
          e++;
        }
      }
      blankRange(i, e);
      i = e;
    } else if (ch === '"' || ch === "`") {
      let e = i + 1;
      while (e < n && src[e] !== ch && src[e] !== "\n") e++;
      i = e < n && src[e] === ch ? e + 1 : e;
    } else if (ch === "$" && delimiter === null && !isWordChar(src[i - 1])) {
      const open = /^\$(?:[A-Za-z_]\w*)?\$/.exec(src.slice(i, i + 64));
      if (open && dollarOpens(src, i, open[0])) {
        const delim = open[0];
        const close = src.indexOf(delim, i + delim.length);
        const bodyEnd = close === -1 ? n : close;
        blankRange(i + delim.length, bodyEnd);
        const regionEnd = close === -1 ? n : close + delim.length;
        dollar.push({ start: i, end: regionEnd });
        i = regionEnd;
      } else {
        i++;
      }
    } else {
      // Under a custom delimiter only the delimiter ends a statement.
      if (delimiter !== null && ch === ";") out[i] = " ";
      i++;
    }
  }
  if (delimiter !== null) custom.push({ start: delimiterFrom, end: n });
  return { text: out.join(""), dollar, custom };
}

/**
 * A line that is not SQL: a MySQL `DELIMITER <tok>` directive, or a PostgreSQL
 * `COPY ... FROM stdin;` line, whose data rows run to a line that is exactly `\.`.
 */
function lineDirective(
  src: string,
  at: number,
): { end: number; delimiter?: string; copyDataEnd?: number } | null {
  let nl = src.indexOf("\n", at);
  if (nl === -1) nl = src.length;
  const line = src.slice(at, nl);
  const d = /^[ \t]*DELIMITER[ \t]+(\S+)[ \t]*\r?$/i.exec(line);
  if (d) return { end: nl, delimiter: d[1] };
  if (/^[ \t]*COPY\s[^;]*?\bFROM\s+STDIN\b[^;]*;[ \t]*\r?$/i.test(line)) {
    // Keep the COPY line itself visible; blank only the data rows.
    const term = /^\\\.[ \t]*\r?$/m.exec(src.slice(nl + 1));
    const dataEnd = term ? nl + 1 + term.index + term[0].length : src.length;
    return { end: nl, copyDataEnd: dataEnd };
  }
  return null;
}

/** `$$DEBUG` style conditional-compilation flags are not bodies; `AS $$` / `DO $$` are. */
function dollarOpens(src: string, at: number, delim: string): boolean {
  if (delim !== "$$" || !isWordChar(src[at + 2])) return true;
  return /\b(?:AS|DO)\s*$/i.test(src.slice(Math.max(0, at - 16), at));
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOfOffset(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function stripQuotes(seg: string): string {
  const first = seg[0];
  return (first === '"' || first === "`") && seg.length >= 2 ? seg.slice(1, -1) : seg;
}

/** Last segment of a qualified name at `from`, with the offset just past the name. */
function readName(text: string, from: number): { name: string; end: number } | null {
  let p = from;
  while (p < text.length && /\s/.test(text[p])) p++;
  QUALIFIED_NAME.lastIndex = p;
  const m = QUALIFIED_NAME.exec(text);
  if (!m) return null;
  const segs = m[0].match(SEGMENT_G);
  if (!segs) return null;
  return { name: stripQuotes(segs[segs.length - 1]), end: p + m[0].length };
}

/** Offset of the `)` matching the `(` at `open`, or -1. */
function matchParen(text: string, open: number, limit: number): number {
  let depth = 0;
  for (let i = open; i < limit; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

function parseParams(body: string): string[] {
  const names: string[] = [];
  for (const part of splitTopLevel(body)) {
    const words = part.trim().match(/"[^"]+"|`[^`]+`|[\w$#]+/g);
    if (!words) continue;
    const skipMode = words.length >= 3 && PARAM_MODES.has(words[0].toUpperCase());
    names.push(stripQuotes(words[skipMode ? 1 : 0]));
  }
  return names;
}

function parseReturnType(text: string): string | undefined {
  const m = /^\s*RETURNS?\s+(SETOF\s+)?([\w.%$"`]+)/i.exec(text);
  if (!m) return undefined;
  return (m[1] ? "SETOF " : "") + m[2];
}

/** Params and (for functions) return type from the text right after a name. */
function parseSignature(text: string, from: number, limit: number): { params: string[]; returnType?: string } {
  let p = from;
  while (p < limit && /\s/.test(text[p])) p++;
  let params: string[] = [];
  if (text[p] === "(") {
    const close = matchParen(text, p, limit);
    if (close !== -1) {
      params = parseParams(text.slice(p + 1, close));
      p = close + 1;
    }
  }
  return { params, returnType: parseReturnType(text.slice(p, Math.min(limit, p + 200))) };
}

interface Statement {
  start: number;
  end: number; // exclusive
  endLine: number;
  resume: number;
}

interface PackageInfo {
  name: string;
  startLine: number;
  endLine: number;
  methods: string[];
}

export class SQLParser implements AnalyzerPlugin {
  name = "sql-parser";
  languages = ["sql"];

  analyzeFile(_filePath: string, content: string): StructuralAnalysis {
    const masked = maskSource(content);
    const m = masked.text;
    const starts = lineStarts(m);
    const lineOf = (off: number): number => lineOfOffset(starts, Math.max(0, off));

    const definitions: DefinitionInfo[] = [];
    const functions: FunctionRecord[] = [];
    const unplaced: UnplacedLines[] = [];
    const packages = new Map<string, PackageInfo>();

    let pos = 0;
    while (pos < m.length) {
      while (pos < m.length && /\s/.test(m[pos])) pos++;
      if (pos >= m.length) break;

      if (!/^CREATE\b/i.test(m.slice(pos, pos + 7))) {
        pos = this.skipNonCreate(m, pos, masked.custom);
        continue;
      }

      const head = this.readHead(m, pos);
      const stmt = STORED_KINDS.has(head.kind)
        ? this.storedStatement(m, pos, head.kind, masked.dollar, masked.custom, starts)
        : this.plainStatement(m, pos, masked.custom, lineOf);
      const startLine = lineOf(pos);
      const range: [number, number] = [startLine, Math.max(startLine, stmt.endLine)];

      if (!this.extract(m, pos, stmt, head, range, lineOf, definitions, functions, packages)) {
        unplaced.push({ reason: `unextracted-sql-object:${head.kind}`, lineRange: range });
      }
      pos = Math.max(stmt.resume, pos + 1);
    }

    const classes = [...packages.values()].map((pkg) => ({
      name: pkg.name,
      lineRange: [pkg.startLine, pkg.endLine] as [number, number],
      methods: pkg.methods,
      properties: [] as string[],
    }));

    const result: StructuralAnalysis = {
      functions,
      classes,
      imports: [],
      exports: [],
      definitions,
    };
    if (unplaced.length > 0) result.unplaced = unplaced;
    return result;
  }

  private skipNonCreate(m: string, pos: number, custom: Region[]): number {
    if (m[pos] === "/") {
      const nl = m.indexOf("\n", pos);
      return nl === -1 ? m.length : nl + 1;
    }
    return this.plainEnd(m, pos, custom);
  }

  /**
   * End of a statement that is not stored code: the first `;`, or the start of a
   * line whose first token is CREATE (DDL without semicolons), whichever is first.
   * Inside a custom-delimiter block only the delimiter ends it.
   */
  private plainEnd(m: string, pos: number, custom: Region[]): number {
    const semi = m.indexOf(";", pos);
    const end = semi === -1 ? m.length : semi + 1;
    if (custom.some((r) => pos >= r.start && pos < r.end)) return end;
    const next = /^[ \t]*CREATE\b/im.exec(m.slice(pos + 1, end));
    return next ? pos + 1 + next.index : end;
  }

  /** Object kind of the CREATE at `pos` and the offset just past the kind words. */
  private readHead(m: string, pos: number): { kind: string; after: number } {
    let p = pos + "CREATE".length;
    const window = (): string => m.slice(p, p + 200);
    for (;;) {
      const mod = MODIFIERS.exec(window());
      if (!mod) break;
      p += mod[0].length;
    }
    const k = KIND.exec(window());
    if (!k) return { kind: "unknown", after: p };
    p += k[0].length;
    return { kind: k[1].toLowerCase().replace(/\s+/g, " "), after: p };
  }

  /** A statement ending at the first top-level `;`, or EOF. */
  private plainStatement(m: string, pos: number, custom: Region[], lineOf: (o: number) => number): Statement {
    const end = this.plainEnd(m, pos, custom);
    // A custom delimiter is a terminator, not content: a lone `//` line is not part of the body.
    const inCustom = custom.some((r) => pos >= r.start && pos < r.end) && m[end - 1] === ";";
    const contentEnd = inCustom ? end - 1 : end;
    return { start: pos, end, endLine: this.lastContentLine(m, pos, contentEnd, lineOf), resume: end };
  }

  private lastContentLine(m: string, from: number, to: number, lineOf: (o: number) => number): number {
    const trimmed = m.slice(from, to).trimEnd();
    return lineOf(from + Math.max(0, trimmed.length - 1));
  }

  private storedStatement(
    m: string,
    pos: number,
    kind: string,
    dollar: Region[],
    custom: Region[],
    starts: number[],
  ): Statement {
    const lineOf = (o: number): number => lineOfOffset(starts, o);
    // Under a custom delimiter the body's own `;` are blanked and the delimiter is the end.
    if (custom.some((r) => pos >= r.start && pos < r.end)) return this.plainStatement(m, pos, custom, lineOf);
    const semi = m.indexOf(";", pos);

    // `$tag$` body: the statement ends at the first `;` after the body's closing delimiter.
    const body = dollar.find((r) => r.start > pos);
    if (body && (semi === -1 || body.start < semi)) {
      const endSemi = m.indexOf(";", body.end);
      const end = endSemi === -1 ? m.length : endSemi + 1;
      return { start: pos, end, endLine: this.lastContentLine(m, pos, end, lineOf), resume: end };
    }

    // Trigger that only names a function (PostgreSQL): ends at its own `;`.
    if (kind === "trigger" && semi !== -1) {
      const upToSemi = m.slice(pos, semi);
      if (/\bEXECUTE\s+(?:FUNCTION|PROCEDURE)\b/i.test(upToSemi) && !/\b(?:BEGIN|DECLARE)\b/i.test(upToSemi)) {
        return { start: pos, end: semi + 1, endLine: lineOf(semi), resume: semi + 1 };
      }
    }

    const rest = m.slice(pos + 1);
    const slash = /^[ \t]*\/[ \t]*\r?$/m.exec(rest);
    const create = /^[ \t]*CREATE\b/im.exec(rest);
    const slashAt = slash ? pos + 1 + slash.index : Infinity;
    const createAt = create ? pos + 1 + create.index : Infinity;

    if (slashAt < createAt) {
      const slashOffset = slashAt + slash![0].indexOf("/");
      const nl = m.indexOf("\n", slashOffset);
      return {
        start: pos,
        end: slashAt,
        endLine: lineOf(slashOffset) - 1,
        resume: nl === -1 ? m.length : nl + 1,
      };
    }
    const end = createAt === Infinity ? m.length : createAt;
    return { start: pos, end, endLine: this.lastContentLine(m, pos, end, lineOf), resume: end };
  }

  /** Returns false when the statement produced no fact (the caller records it as unplaced). */
  private extract(
    m: string,
    pos: number,
    stmt: Statement,
    head: { kind: string; after: number },
    range: [number, number],
    lineOf: (o: number) => number,
    definitions: DefinitionInfo[],
    functions: FunctionRecord[],
    packages: Map<string, PackageInfo>,
  ): boolean {
    let after = head.after;
    const ine = IF_NOT_EXISTS.exec(m.slice(after, after + 40));
    if (ine) after += ine[0].length;

    switch (head.kind) {
      case "table": {
        const nm = readName(m, after);
        if (!nm) return false;
        definitions.push({
          name: nm.name,
          kind: "table",
          lineRange: range,
          fields: this.extractColumns(m, nm.end, stmt.end),
        });
        return true;
      }
      case "view": {
        const nm = readName(m, after);
        if (!nm) return false;
        definitions.push({ name: nm.name, kind: "view", lineRange: range, fields: [] });
        return true;
      }
      case "index": {
        const conc = /^\s+CONCURRENTLY\b/i.exec(m.slice(after, after + 20));
        if (conc) after += conc[0].length;
        const ine2 = IF_NOT_EXISTS.exec(m.slice(after, after + 40));
        if (ine2) after += ine2[0].length;
        const nm = readName(m, after);
        // `CREATE INDEX ON t (...)` has no name; do not take ON for one.
        if (!nm || (/^ON$/i.test(nm.name) && !/["`]/.test(m.slice(after, nm.end)))) return false;
        definitions.push({ name: nm.name, kind: "index", lineRange: range, fields: [] });
        return true;
      }
      case "procedure":
      case "function":
      case "trigger": {
        const nm = readName(m, after);
        if (!nm) return false;
        const fn: FunctionRecord = { name: nm.name, lineRange: range, params: [], owner: "" };
        if (head.kind !== "trigger") {
          const sig = parseSignature(m, nm.end, stmt.end);
          fn.params = sig.params;
          if (head.kind === "function" && sig.returnType) fn.returnType = sig.returnType;
        }
        functions.push(fn);
        return true;
      }
      case "package":
      case "package body": {
        const nm = readName(m, after);
        if (!nm) return false;
        const key = nm.name.toLowerCase();
        const info = packages.get(key) ?? { name: nm.name, startLine: range[0], endLine: range[1], methods: [] };
        info.startLine = Math.min(info.startLine, range[0]);
        info.endLine = Math.max(info.endLine, range[1]);
        if (head.kind === "package body") {
          for (const sub of this.scanSubprograms(m, nm.end, stmt.end, lineOf)) {
            functions.push({
              name: sub.name,
              lineRange: sub.lineRange,
              params: sub.params,
              ...(sub.returnType ? { returnType: sub.returnType } : {}),
              owner: nm.name,
            });
            if (!info.methods.includes(sub.name)) info.methods.push(sub.name);
          }
        }
        packages.set(key, info);
        return true;
      }
      default:
        return false;
    }
  }

  private extractColumns(m: string, from: number, limit: number): string[] {
    const open = m.indexOf("(", from);
    if (open === -1 || open >= limit) return [];
    if (/\b(?:AS|LIKE)\b/i.test(m.slice(from, open))) return [];
    const close = matchParen(m, open, limit);
    if (close === -1) return [];

    const fields: string[] = [];
    for (const part of splitTopLevel(m.slice(open + 1, close))) {
      const trimmed = part.trim();
      if (/^(?:PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|INDEX|KEY)\b/i.test(trimmed)) continue;
      const col = /^(?:`|")?([\w$#]+)(?:`|")?\s+/.exec(trimmed);
      if (col) fields.push(col[1]);
    }
    return fields;
  }

  /**
   * Subprograms declared directly in a package body. A small block tracker over
   * word tokens (BEGIN, CASE, END, subprogram IS/AS) finds where each one ends, so
   * nested subprograms and CASE expressions do not end an outer one early.
   */
  private scanSubprograms(
    m: string,
    from: number,
    limit: number,
    lineOf: (o: number) => number,
  ): Array<{ name: string; lineRange: [number, number]; params: string[]; returnType?: string }> {
    const tokens: Array<{ t: string; up: string; off: number }> = [];
    const re = /"[^"]*"|`[^`]*`|[A-Za-z_][\w$#]*|[();]/g;
    const slice = m.slice(from, limit);
    for (let t = re.exec(slice); t; t = re.exec(slice)) {
      tokens.push({ t: t[0], up: t[0].toUpperCase(), off: from + t.index });
    }

    // Skip the package header up to its IS/AS.
    let i = 0;
    while (i < tokens.length && tokens[i].up !== "IS" && tokens[i].up !== "AS") i++;
    i++;

    interface Frame {
      kind: "SUB" | "BLOCK" | "CASE";
      rec?: { name: string; startOff: number; params: string[]; returnType?: string };
    }
    const stack: Frame[] = [];
    const out: Array<{ name: string; lineRange: [number, number]; params: string[]; returnType?: string }> = [];

    // Reads a subprogram header at token `i`; returns the token index of its IS/AS, or -1 for `;`.
    const header = (idx: number): { isAt: number; params: string[]; returnType?: string } => {
      let depth = 0;
      let j = idx + 2;
      for (; j < tokens.length; j++) {
        const tk = tokens[j];
        if (tk.t === "(") depth++;
        else if (tk.t === ")") depth--;
        else if (depth <= 0 && (tk.t === ";" || tk.up === "IS" || tk.up === "AS")) break;
      }
      const sig = parseSignature(m, tokens[idx + 1].off + tokens[idx + 1].t.length, j < tokens.length ? tokens[j].off : limit);
      const isAt = j < tokens.length && tokens[j].t !== ";" ? j : -1;
      return { isAt, params: sig.params, returnType: sig.returnType };
    };

    while (i < tokens.length) {
      const tk = tokens[i];
      const nameTok = tokens[i + 1];
      const top = stack[stack.length - 1];
      const isSubKeyword = tk.up === "PROCEDURE" || tk.up === "FUNCTION";

      if (isSubKeyword && nameTok && /^(?:"|`|[A-Za-z_])/.test(nameTok.t) && (stack.length === 0 || top.kind === "SUB")) {
        const h = header(i);
        if (h.isAt === -1) {
          // Forward declaration: the real definition follows, or it is a spec-only signature.
          i = this.nextSemicolon(tokens, i) + 1;
          continue;
        }
        const frame: Frame = { kind: "SUB" };
        if (stack.length === 0) {
          frame.rec = {
            name: stripQuotes(nameTok.t),
            startOff: tk.off,
            params: h.params,
            returnType: h.returnType,
          };
        }
        stack.push(frame);
        i = h.isAt + 1;
        continue;
      }

      if (tk.up === "BEGIN") {
        if (top && top.kind === "SUB") top.kind = "BLOCK";
        else stack.push({ kind: "BLOCK" });
        i++;
      } else if (tk.up === "CASE") {
        stack.push({ kind: "CASE" });
        i++;
      } else if (tk.up === "END") {
        const nx = tokens[i + 1]?.up;
        if (nx === "IF" || nx === "LOOP") {
          i += 2;
          continue;
        }
        const popped = stack.pop();
        i += nx === "CASE" ? 2 : 1;
        if (popped?.rec) {
          const semi = this.nextSemicolon(tokens, i - 1);
          const endOff = semi < tokens.length ? tokens[semi].off : limit - 1;
          out.push({
            name: popped.rec.name,
            lineRange: [lineOf(popped.rec.startOff), lineOf(endOff)],
            params: popped.rec.params,
            ...(popped.rec.returnType ? { returnType: popped.rec.returnType } : {}),
          });
        }
      } else {
        i++;
      }
    }

    // A subprogram still open at the end of the statement: close it at the statement end.
    for (const frame of stack) {
      if (frame.rec) {
        out.push({
          name: frame.rec.name,
          lineRange: [lineOf(frame.rec.startOff), lineOf(Math.max(frame.rec.startOff, limit - 1))],
          params: frame.rec.params,
          ...(frame.rec.returnType ? { returnType: frame.rec.returnType } : {}),
        });
      }
    }
    return out;
  }

  private nextSemicolon(tokens: Array<{ t: string }>, from: number): number {
    let j = from;
    while (j < tokens.length && tokens[j].t !== ";") j++;
    return j;
  }
}
