/**
 * text-mentions.mjs
 *
 * Single-file lexer for "name mentions" in non-code files (openspec:
 * changes/name-mention-facts, capability `fact-graph`, design D2-D3).
 *
 * A mention is a plain textual fact: this file, on this line, writes a token
 * that LOOKS like a class's fully-qualified name or a file path. The lexer
 * never decides whether the token is real - there is no cross-file lookup
 * here. Resolution against the repository's types and files is a later stage;
 * every candidate this module emits must get a visible fate there.
 *
 * Pure and build-free: `(path, language, text, { extensions })` in, candidate
 * lists out. No disk, no model, no other file. The only module-level read is
 * the language registry, used to derive which languages are code (see
 * `isCodeLanguage`).
 *
 * Output (document order, line numbers 1-based over the original text):
 *   fqn:  [{ token, line, context }]
 *   path: [{ token, line, context, path, prefix, pattern }]
 *     token    the string exactly as written between delimiters
 *     path     token without its `classpath:`/`classpath*:`/`file:` prefix and
 *              without `?query` / `#fragment`
 *     prefix   'classpath' | 'classpath*' | 'file' | null
 *     pattern  true for `classpath*:` or a `*` wildcard path
 *   context: `{ element, attribute }` in a markup file, else null
 *     - inside a start-tag attribute value: that element and attribute
 *     - inside element text: nearest unclosed element, attribute null
 *     - JSP directive `<%@ page import="..." %>`: element "%@page" (likewise
 *       "%@include", "%@taglib"), whatever element encloses it - even a
 *       `<script>` body
 *     - outside every element, or a non-markup file: null
 *
 * What is a comment (and therefore never a candidate):
 *   - markup: `<!-- -->` and `<%-- --%>` (an unterminated one runs to EOF)
 *   - properties: whole lines whose first non-blank character is `#` or `!`
 *     (a line that continues a value with a trailing backslash is not one)
 * Every other format is NOT masked: a `#` comment in YAML or shell still
 * yields candidates. The coverage description says so; masking per format is a
 * later, separate decision.
 *
 * The comment mask, the markup scanner and the line helpers are exported for
 * the sibling lexers that read the same markup (name-binding-references: the EL
 * lexer and the XML binding reader); their behavior is unchanged.
 *
 * "Markup" is decided by language: the xml family, html, jsp, xhtml (and their
 * template siblings), plus any language the registry does not declare
 * whose first non-blank character is `<` (.ftl, .vm, .wsdl, ...). Everything
 * else is plain text with null context.
 */

import { createRequire } from 'node:module';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/excavator/ -> plugin root is two dirs up
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// Same two-step @excavator/core resolution every sibling script uses.
let core;
try {
  core = await import(pathToFileURL(require.resolve('@excavator/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const { builtinLanguageConfigs } = core;

// ---------------------------------------------------------------------------
// Code languages
// ---------------------------------------------------------------------------

/**
 * Predicate over language ids: true when the config list declares that id with
 * a tree-sitter grammar. The list is the language registry's; no language is
 * named here, so adding a grammar to the registry changes the answer with no
 * edit to this file.
 */
export function codeLanguagePredicate(languageConfigs) {
  const code = new Set(languageConfigs.filter((config) => config.treeSitter).map((config) => config.id));
  return (language) => code.has(language);
}

/** True for a language with a tree-sitter grammar in the default registry. */
export const isCodeLanguage = codeLanguagePredicate(builtinLanguageConfigs);

const declaredLanguages = new Set(builtinLanguageConfigs.map((config) => config.id));

// ---------------------------------------------------------------------------
// Which text is markup
// ---------------------------------------------------------------------------

/** Languages whose text is always markup, whatever its first character. */
const MARKUP_LANGUAGES = new Set(['xml', 'xaml', 'html', 'xhtml', 'jsp', 'jspx', 'jspf', 'tag', 'tagx', 'tld']);
/** HTML-like markup: void elements need no end tag, script/style hold raw text. */
const HTML_LIKE_LANGUAGES = new Set(['html', 'jsp', 'jspf', 'tag']);
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

function isMarkup(language, text) {
  if (MARKUP_LANGUAGES.has(language)) return true;
  // An undeclared extension (.ftl, .vm, .wsdl, ...) is markup only if it
  // looks like it; a declared non-markup language (yaml, shell, ...) never is.
  if (language === 'properties' || declaredLanguages.has(language)) return false;
  return /^\s*</.test(text);
}

// ---------------------------------------------------------------------------
// Comment masking - replaces comment text with spaces, keeping every newline
// and offset, so line numbers computed on the masked text are the original's.
// ---------------------------------------------------------------------------

const blank = (text) => text.replace(/[^\r\n]/g, ' ');

export function maskMarkupComments(text) {
  let out = '';
  let last = 0;
  let cursor = 0;
  for (;;) {
    const lt = text.indexOf('<', cursor);
    if (lt < 0) break;
    if (text.startsWith('<![CDATA[', lt)) {
      // CDATA is character data: a comment opener inside it is just text.
      const close = text.indexOf(']]>', lt + 9);
      cursor = close < 0 ? text.length : close + 3;
      continue;
    }
    const closer = text.startsWith('<!--', lt) ? '-->' : text.startsWith('<%--', lt) ? '--%>' : null;
    if (!closer) {
      cursor = lt + 1;
      continue;
    }
    const close = text.indexOf(closer, lt + 4);
    const end = close < 0 ? text.length : close + closer.length;
    out += text.slice(last, lt) + blank(text.slice(lt, end));
    last = cursor = end;
  }
  return out + text.slice(last);
}

function maskPropertiesComments(text) {
  const lines = text.split('\n');
  let continued = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!continued && /^[ \t\f]*[#!]/.test(line)) {
      lines[i] = blank(line);
      continue;
    }
    // A value continues onto the next line after an odd run of backslashes.
    const run = /\\*$/.exec(line.replace(/\r$/, ''))[0].length;
    continued = run % 2 === 1;
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Markup scanning - splits masked text into segments that each have one
// context: an attribute value, element text, a directive attribute.
// ---------------------------------------------------------------------------

const NAME_RE = /[A-Za-z_][\w.:-]*/y;
const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';

/**
 * End of a tag or directive: the first `closer` outside a quoted value, or -1.
 * An unquoted `<` ends the search too - a tag has none, so the opener was text
 * (or a malformed tag) and each failed search stays short.
 */
export function findClose(text, from, closer) {
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '<') {
      return -1;
    } else if (text.startsWith(closer, i)) {
      return i;
    }
  }
  return -1;
}

/** Attribute values in `text[from, end)`; a valueless attribute has none. */
export function parseAttributes(text, from, end) {
  const attributes = [];
  let i = from;
  while (i < end) {
    if (isSpace(text[i])) {
      i++;
      continue;
    }
    const nameStart = i;
    while (i < end && !isSpace(text[i]) && !'="\'/'.includes(text[i])) i++;
    if (i === nameStart) {
      i++; // a stray quote or slash
      continue;
    }
    const name = text.slice(nameStart, i);
    let j = i;
    while (j < end && isSpace(text[j])) j++;
    if (text[j] !== '=') {
      i = j;
      continue;
    }
    j++;
    while (j < end && isSpace(text[j])) j++;
    const quote = text[j];
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, j + 1);
      const valueEnd = close < 0 || close >= end ? end : close;
      attributes.push({ name, start: j + 1, end: valueEnd });
      i = valueEnd + 1;
    } else {
      const valueStart = j;
      while (j < end && !isSpace(text[j])) j++;
      attributes.push({ name, start: valueStart, end: j });
      i = j;
    }
  }
  return attributes;
}

export function markupSegments(text, language) {
  const htmlLike = HTML_LIKE_LANGUAGES.has(language);
  const norm = (name) => (htmlLike ? name.toLowerCase() : name);
  const segments = [];
  const stack = [];
  let textStart = 0;
  let cursor = 0;

  const context = () => (stack.length ? { element: stack[stack.length - 1], attribute: null } : null);
  const addText = (start, end) => {
    if (end > start) segments.push({ start, end, context: context() });
  };
  const flush = (lt) => addText(textStart, lt);
  const consume = (end) => {
    textStart = cursor = end;
  };
  const addAttributes = (element, from, end) => {
    for (const attribute of parseAttributes(text, from, end)) {
      if (attribute.end > attribute.start) {
        segments.push({ start: attribute.start, end: attribute.end, context: { element, attribute: attribute.name } });
      }
    }
  };

  /**
   * A JSP directive `<%@ name attr="..." %>` at `lt` whose `%>` is at
   * `closeAt`: its attributes are segments whose context is the directive
   * itself (`%@include`), whatever element encloses it.
   */
  function addDirective(lt, closeAt) {
    NAME_RE.lastIndex = lt + 3;
    while (isSpace(text[NAME_RE.lastIndex])) NAME_RE.lastIndex++;
    const directive = NAME_RE.exec(text);
    if (directive && directive.index < closeAt) {
      addAttributes(`%@${directive[0]}`, directive.index + directive[0].length, closeAt);
    } else {
      addText(lt + 3, closeAt);
    }
  }

  while (cursor < text.length) {
    const lt = text.indexOf('<', cursor);
    if (lt < 0) break;

    if (text.startsWith('<![CDATA[', lt)) {
      flush(lt);
      const close = text.indexOf(']]>', lt + 9);
      addText(lt + 9, close < 0 ? text.length : close);
      consume(close < 0 ? text.length : close + 3);
      continue;
    }
    if (text.startsWith('<?', lt)) {
      flush(lt);
      const close = text.indexOf('?>', lt + 2);
      addText(lt + 2, close < 0 ? text.length : close);
      consume(close < 0 ? text.length : close + 2);
      continue;
    }
    if (text.startsWith('<!', lt)) {
      const end = findClose(text, lt + 2, '>');
      if (end < 0) {
        cursor = lt + 1;
        continue;
      }
      flush(lt);
      addText(lt + 2, end);
      consume(end + 1);
      continue;
    }
    if (text.startsWith('<%', lt)) {
      if (text[lt + 2] === '@') {
        const closeAt = findClose(text, lt + 3, '%>');
        if (closeAt < 0) {
          cursor = lt + 1;
          continue;
        }
        flush(lt);
        addDirective(lt, closeAt);
        consume(closeAt + 2);
      } else {
        // Scriptlet, expression or declaration: its text is scanned like any
        // element text; Java string literals get no special handling here.
        flush(lt);
        const end = text.indexOf('%>', lt + 2);
        addText(lt + 2, end < 0 ? text.length : end);
        consume(end < 0 ? text.length : end + 2);
      }
      continue;
    }
    if (text[lt + 1] === '/') {
      NAME_RE.lastIndex = lt + 2;
      const named = NAME_RE.exec(text);
      let end = named ? lt + 2 + named[0].length : -1;
      while (end >= 0 && isSpace(text[end])) end++;
      if (end < 0 || text[end] !== '>') {
        cursor = lt + 1;
        continue;
      }
      flush(lt);
      const open = stack.findLastIndex((name) => norm(name) === norm(named[0]));
      if (open >= 0) stack.length = open; // an end tag also closes anything left open inside it
      consume(end + 1);
      continue;
    }

    NAME_RE.lastIndex = lt + 1;
    const named = NAME_RE.exec(text);
    if (!named) {
      cursor = lt + 1; // a bare `<` in text
      continue;
    }
    const name = named[0];
    const nameEnd = lt + 1 + name.length;
    const end = findClose(text, nameEnd, '>');
    if (end < 0) {
      cursor = lt + 1;
      continue;
    }
    flush(lt);
    addAttributes(name, nameEnd, end);
    const selfClosing = text.slice(nameEnd, end).trimEnd().endsWith('/');
    consume(end + 1);
    if (selfClosing || (htmlLike && VOID_ELEMENTS.has(norm(name)))) continue;
    stack.push(name);
    if (htmlLike && RAW_TEXT_ELEMENTS.has(norm(name))) {
      // The body of <script>/<style> is not markup: a `<` in it is not a tag.
      const rawEnd = new RegExp(`</${name}\\b`, 'gi');
      rawEnd.lastIndex = end + 1;
      const found = rawEnd.exec(text);
      const closeAt = found ? found.index : text.length;
      // A JSP directive inside the body is still a directive, not script text.
      let at = end + 1;
      for (let d = text.indexOf('<%@', at); d >= 0 && d < closeAt; d = text.indexOf('<%@', at)) {
        const directiveEnd = findClose(text, d + 3, '%>');
        if (directiveEnd < 0 || directiveEnd + 2 > closeAt) break;
        addText(at, d);
        addDirective(d, directiveEnd);
        at = directiveEnd + 2;
      }
      addText(at, closeAt);
      consume(closeAt);
    }
  }
  flush(text.length);
  return segments;
}

// ---------------------------------------------------------------------------
// Candidate extraction
// ---------------------------------------------------------------------------

/** Dotted identifiers; neither neighbour may continue the name (letter, digit, `_`, `$`, `.`). A trailing
 *  `.` that ends a sentence (not followed by another identifier) is allowed. */
const FQN_RE = /(?<![\w$.])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?![\w$])(?!\.[\w$])/g;
const PATH_TOKEN_RE = /[^\s"'<>,;()=]+/g;
const NOT_A_PATH = ['://', '#{', '${'];
const PATH_PREFIXES = [['classpath*:', 'classpath*'], ['classpath:', 'classpath'], ['file:', 'file']];

const normalizedExtensions = new WeakMap();

/** Extensions as lowercase names without a dot, whatever form the caller used. */
function extensionSet(extensions) {
  if (extensions && typeof extensions === 'object' && normalizedExtensions.has(extensions)) {
    return normalizedExtensions.get(extensions);
  }
  const normalized = new Set([...(extensions ?? [])].map((ext) => String(ext).replace(/^\./, '').toLowerCase()));
  if (extensions && typeof extensions === 'object') normalizedExtensions.set(extensions, normalized);
  return normalized;
}

function pathCandidate(token, extensions) {
  if (NOT_A_PATH.some((marker) => token.includes(marker))) return null;
  let rest = token;
  let prefix = null;
  for (const [marker, name] of PATH_PREFIXES) {
    if (rest.startsWith(marker)) {
      prefix = name;
      rest = rest.slice(marker.length);
      break;
    }
  }
  const cut = rest.search(/[?#]/);
  if (cut >= 0) rest = rest.slice(0, cut);
  if (!rest || rest.endsWith('/')) return null;

  const segments = rest.split('/');
  const extension = posix.extname(segments[segments.length - 1]).slice(1).toLowerCase();
  if (!extension || !extensions.has(extension)) return null;

  // A wildcard with no literal directory segment (`*.xhtml`, `**/*.xml`,
  // `./*.ts`: `.` and `..` name no directory) is a URL mapping or a global
  // glob; it points at no particular file.
  const wildcard = rest.includes('*');
  const literalDirectory = (segment) => segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('*');
  if (wildcard && !segments.slice(0, -1).some(literalDirectory)) return null;
  return { token, path: rest, prefix, pattern: wildcard || prefix === 'classpath*' };
}

export function lineStarts(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

export function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] <= offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Candidates in one file.
 *
 * @param {string} _path   file path; the candidates carry none (the caller
 *                         owns the file identity), kept for a stable signature
 * @param {string} language manifest language of the file
 * @param {string} text    file content
 * @param {{ extensions: Iterable<string>, maskComments?: boolean }} options
 *   `extensions`: the extensions present in the manifest (a path token whose
 *   extension is not among them cannot name a manifest file).
 *   `maskComments` is a test seam for the mutation tripwire; production
 *   callers leave it at its default (true).
 * @returns {{ fqn: object[], path: object[] }}
 */
export function lexMentions(_path, language, text, { extensions, maskComments = true } = {}) {
  const result = { fqn: [], path: [] };
  // Code languages are outside this scan (a string literal in a .java file
  // is a later step), so the lexer refuses them rather than trusting callers.
  if (isCodeLanguage(language) || !text) return result;

  const markup = isMarkup(language, text);
  let masked = text;
  if (maskComments) {
    if (markup) masked = maskMarkupComments(text);
    else if (language === 'properties') masked = maskPropertiesComments(text);
  }
  const segments = markup ? markupSegments(masked, language) : [{ start: 0, end: masked.length, context: null }];
  const starts = lineStarts(text);
  const known = extensionSet(extensions);

  for (const { start, end, context } of segments) {
    const body = masked.slice(start, end);
    const here = () => (context ? { element: context.element, attribute: context.attribute } : null);

    FQN_RE.lastIndex = 0;
    for (let m = FQN_RE.exec(body); m; m = FQN_RE.exec(body)) {
      result.fqn.push({ token: m[0], line: lineAt(starts, start + m.index), context: here() });
    }
    PATH_TOKEN_RE.lastIndex = 0;
    for (let m = PATH_TOKEN_RE.exec(body); m; m = PATH_TOKEN_RE.exec(body)) {
      const candidate = pathCandidate(m[0], known);
      if (candidate) {
        const { token, path, prefix, pattern } = candidate;
        result.path.push({ token, line: lineAt(starts, start + m.index), context: here(), path, prefix, pattern });
      }
    }
  }
  return result;
}
