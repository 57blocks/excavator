/**
 * Masking of manifest text before framework keyword detection.
 *
 * Detection is a substring search, so a keyword inside a comment or an
 * exclusion declaration would count as a "use" of the framework. This module
 * blanks the text that cannot be a dependency declaration, chosen by the
 * manifest's file format. It only blanks: masked characters become spaces,
 * line breaks stay, and the output has the same length as the input, so
 * offsets and line numbers of the unmasked text are unchanged. Masking can
 * remove a hit and can never create one.
 *
 * Gradle, go.mod and `#` files are scanned for their comment markers (and
 * `exclude`) outside single-line strings, so a file glob in quotes does not
 * open a block comment. Known imprecision, accepted because it can only lose a
 * hit: no format is parsed, so a multi-line string that holds a `//` still
 * blanks the rest of that line.
 */

type Range = readonly [start: number, end: number];

const XML_FILE = /\.(?:xml|csproj)$/;
const GRADLE_FILE = /\.gradle(?:\.kts)?$/;
const HASH_COMMENT_FILES = new Set([
  "requirements.txt",
  "pipfile",
  "pyproject.toml",
  "setup.cfg",
  "setup.py",
  "gemfile",
]);

/**
 * Mask the text of a manifest that cannot declare a dependency.
 *
 * @param path - Path or bare name of the manifest; its base name selects the format.
 * @param text - Manifest content.
 * @returns The text with comments and exclusion declarations blanked; the input
 *   unchanged for formats without masking rules (e.g. `package.json`).
 */
export function maskManifestText(path: string, text: string): string {
  const name = (path.split(/[\\/]/).pop() ?? path).toLowerCase();
  if (XML_FILE.test(name)) return blank(text, xmlRanges(text));
  if (GRADLE_FILE.test(name)) return blank(text, cStyleRanges(text, false));
  if (name === "go.mod") return blank(text, cStyleRanges(text, true));
  if (HASH_COMMENT_FILES.has(name)) return blank(text, hashRanges(text));
  return text;
}

/** Replace every masked character except line breaks with a space. */
function blank(text: string, ranges: Range[]): string {
  if (ranges.length === 0) return text;
  let out = "";
  let last = 0;
  for (const [start, end] of ranges) {
    out += text.slice(last, start) + text.slice(start, end).replace(/[^\r\n]/g, " ");
    last = end;
  }
  return out + text.slice(last);
}

// ---------------------------------------------------------------------------
// XML: comments and exclusion elements
// ---------------------------------------------------------------------------

/** Element names (lower case) whose whole content is an exclusion, not a use. */
const EXCLUSION_CLOSERS = new Map<string, RegExp>([
  ["exclusions", /<\/exclusions\s*>/gi],
  ["exclude", /<\/exclude\s*>/gi],
  ["excludes", /<\/excludes\s*>/gi],
]);
const TAG_NAME = /<([^\s/>!?]+)/y;

function xmlRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let cursor = 0;
  for (;;) {
    const lt = text.indexOf("<", cursor);
    if (lt < 0) break;
    if (text.startsWith("<![CDATA[", lt)) {
      // Character data: a comment or element opener inside it is just text.
      const close = text.indexOf("]]>", lt + 9);
      cursor = close < 0 ? text.length : close + 3;
      continue;
    }
    if (text.startsWith("<!--", lt)) {
      const close = text.indexOf("-->", lt + 4);
      const end = close < 0 ? text.length : close + 3;
      ranges.push([lt, end]);
      cursor = end;
      continue;
    }
    const end = exclusionElementEnd(text, lt);
    if (end < 0) {
      cursor = lt + 1;
      continue;
    }
    ranges.push([lt, end]);
    cursor = end;
  }
  return ranges;
}

/**
 * End offset (exclusive) of the exclusion element opened at `lt`, or -1 when
 * the tag is not one. A self-closing element ends with its tag; a paired one
 * ends at the nearest end tag of the same name, and without one is not masked.
 */
function exclusionElementEnd(text: string, lt: number): number {
  TAG_NAME.lastIndex = lt;
  const named = TAG_NAME.exec(text);
  if (!named) return -1;
  const closer = EXCLUSION_CLOSERS.get(named[1].toLowerCase());
  if (!closer) return -1;

  // The first `>` outside a quoted attribute value ends the opening tag.
  let quote = "";
  let gt = lt + named[0].length;
  for (; gt < text.length; gt++) {
    const char = text[gt];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      break;
    }
  }
  if (gt >= text.length) return -1;
  if (text[gt - 1] === "/") return gt + 1;

  closer.lastIndex = gt + 1;
  const end = closer.exec(text);
  return end ? end.index + end[0].length : -1;
}

// ---------------------------------------------------------------------------
// Single-line strings (Gradle, go.mod and `#` formats)
// ---------------------------------------------------------------------------

function isQuote(char: string): boolean {
  return char === '"' || char === "'";
}

/**
 * Move a token scan past the string opened by the quote at `open`. A string
 * ends at the next same quote on its line, and `\` escapes the next character.
 * A quote with no closing quote on its line is an ordinary character: the scan
 * simply continues after it.
 */
function skipString(tokens: RegExp, text: string, open: number): void {
  const quote = text[open];
  for (let at = open + 1; at < text.length; at++) {
    const char = text[at];
    if (char === "\n") return;
    if (char === quote) {
      tokens.lastIndex = at + 1;
      return;
    }
    if (char === "\\") {
      if (text[at + 1] === "\n") return;
      at++;
    }
  }
}

// ---------------------------------------------------------------------------
// Gradle and go.mod: comments and exclude statements
// ---------------------------------------------------------------------------

const C_STYLE_TOKEN = /\/\/|\/\*|\bexclude\b|["']/g;
const GO_MOD_BLOCK_OPEN = /[ \t]*\(/y;
const GO_MOD_BLOCK_TOKEN = /\)|\/\/[^\n]*/g;

function cStyleRanges(text: string, goMod: boolean): Range[] {
  const ranges: Range[] = [];
  C_STYLE_TOKEN.lastIndex = 0;
  for (;;) {
    const token = C_STYLE_TOKEN.exec(text);
    if (!token) break;
    const start = token.index;
    if (isQuote(token[0])) {
      skipString(C_STYLE_TOKEN, text, start);
      continue;
    }
    let end: number;
    if (token[0] === "/*") {
      const close = text.indexOf("*/", start + 2);
      end = close < 0 ? text.length : close + 2;
    } else {
      // `//` comment or exclude statement: to the end of the line, unless a
      // go.mod `exclude (` opens a block.
      const block = goMod && token[0] === "exclude" ? goModBlockEnd(text, start + token[0].length) : -1;
      const newline = text.indexOf("\n", start);
      end = block >= 0 ? block : newline < 0 ? text.length : newline;
    }
    ranges.push([start, end]);
    C_STYLE_TOKEN.lastIndex = end;
  }
  return ranges;
}

/**
 * End offset (exclusive) of a go.mod `exclude ( ... )` block whose keyword ends
 * at `afterKeyword`, or -1 when no block opens there or it never closes. A
 * `)` inside a `//` comment does not close the block.
 */
function goModBlockEnd(text: string, afterKeyword: number): number {
  GO_MOD_BLOCK_OPEN.lastIndex = afterKeyword;
  const open = GO_MOD_BLOCK_OPEN.exec(text);
  if (!open) return -1;
  GO_MOD_BLOCK_TOKEN.lastIndex = afterKeyword + open[0].length;
  for (;;) {
    const token = GO_MOD_BLOCK_TOKEN.exec(text);
    if (!token) return -1;
    if (token[0] === ")") return token.index + 1;
  }
}

// ---------------------------------------------------------------------------
// `#` comments
// ---------------------------------------------------------------------------

const HASH_TOKEN = /#|["']/g;

function hashRanges(text: string): Range[] {
  const ranges: Range[] = [];
  HASH_TOKEN.lastIndex = 0;
  for (;;) {
    const token = HASH_TOKEN.exec(text);
    if (!token) break;
    if (isQuote(token[0])) {
      skipString(HASH_TOKEN, text, token.index);
      continue;
    }
    const newline = text.indexOf("\n", token.index);
    const end = newline < 0 ? text.length : newline;
    ranges.push([token.index, end]);
    HASH_TOKEN.lastIndex = end;
  }
  return ranges;
}
