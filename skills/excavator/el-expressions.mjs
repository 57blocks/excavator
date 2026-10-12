/**
 * el-expressions.mjs
 *
 * Single-file lexer for the root names of expression-language expressions
 * (openspec: changes/name-binding-references, capability `fact-graph`, design
 * D6). A page that writes `#{orders.save}` names a bean without naming its
 * class; this module reads WHICH names a page writes, and where. What a name is
 * bound to is a later stage (name-reference-resolution.mjs); nothing here
 * looks at another file.
 *
 * Pure and build-free: `(text, { language, expressionLanguage })` in, root
 * names out. The delimiters and the declarations of local names come from the
 * catalog's expression language; the syntax of the expressions themselves
 * (strings, braces, the operator words, `->`) is the language's and lives here.
 *
 * Output: `{ roots, escaped, unterminated, unscanned }`
 *   roots        document order, `{ line, token, chain, local }`
 *     token      the root name
 *     chain      the root and the `.member` accesses that follow it, written
 *                `orders.items` (it stops at `[`, `(` or anything else); recorded,
 *                never resolved
 *     local      the name is declared locally: by a catalog `localDeclarations`
 *                attribute anywhere in this file (in a template-text file, on an
 *                action inside a `<script>` or `<style>` body or a CDATA section
 *                too; an element-limited one only
 *                when the element's prefix is bound, by an `xmlns:` declaration
 *                or a JSP `taglib` directive of this file, to one of the
 *                namespaces the declaration lists; and an `expression-root` one
 *                declares the root names of the expressions in its value), or as
 *                a lambda parameter of the expression it is read in
 *     line       1-based line of the root in the original text
 *   escaped      delimiters written `\#{`, which are text
 *   unterminated expressions with no closing brace in their run of text; each
 *                unterminated delimiter counts once, and the scan goes on after it
 *   unscanned    delimiters an XML-form file writes outside every run (inside a
 *                tag's own syntax), which yield no root and are counted, so that
 *                no delimiter disappears without a trace
 *
 * What is not an expression, and so yields no root:
 *   - a markup comment, a JSP scripting segment (`<% %>`, but not a `<%@`
 *     directive) and the body of `jsp:scriptlet`, `jsp:expression` and
 *     `jsp:declaration`. CDATA and `<script>` are template text, not masked.
 *   - an escaped or unterminated one (counted).
 * What is not a root inside an expression: an identifier after a `.`, an
 * operator word, a function prefix or name (`fn:length(`), a lambda parameter
 * at its declaration, and any letter of a string or a number.
 *
 * An XML-form file (Facelets, a JSP document, a descriptor) is read in runs: an
 * attribute value, or the text between two tags, the way an XML parser hands
 * them to the expression evaluator. An expression is closed within its run; one
 * that is not is `unterminated`. A template-text file (`template: true`, the
 * catalog's `templateExtensions`: a classic JSP page) is one run: its compiler
 * treats HTML tags as text and finds expressions anywhere in it, so an action
 * nested in an HTML attribute value, or a `\"` inside an action's attribute,
 * still holds expressions.
 * References like `&amp;` are read as the character they stand for, so
 * `&amp;&amp;` is `&&`, not the name `amp`.
 */

import { lineAt, lineStarts, markupSegments, maskMarkupComments } from './text-mentions.mjs';
import { ENTITY_REFERENCE, decodeEntity, decodeXmlText } from './xml-entities.mjs';

const OPERATOR_WORDS = new Set([
  'and', 'or', 'not', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'div', 'mod', 'empty', 'true', 'false', 'null', 'instanceof',
]);

/** Elements whose body is Java, not template text. */
const SCRIPTING_ELEMENTS = new Set(['jsp:scriptlet', 'jsp:expression', 'jsp:declaration']);

const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
const IDENTIFIER_START = /[\p{L}_$]/u;
const IDENTIFIER_PART = /[\p{L}\p{N}_$]/u;
const NUMBER = /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const WHITESPACE = /\s/;

const blank = (text) => text.replace(/[^\r\n]/g, ' ');

/**
 * Replace `<% ... %>` scripting with spaces, keeping every newline and offset.
 * A directive `<%@` is left alone (its attributes can hold expressions), and so
 * is a `<%--` comment, which the comment mask owns.
 */
function maskScripting(text) {
  let out = '';
  let last = 0;
  let cursor = 0;
  for (;;) {
    const open = text.indexOf('<%', cursor);
    if (open < 0) break;
    if (text[open + 2] === '@' || text.startsWith('<%--', open)) {
      cursor = open + 2;
      continue;
    }
    const close = text.indexOf('%>', open + 2);
    const end = close < 0 ? text.length : close + 2;
    out += text.slice(last, open) + blank(text.slice(open, end));
    last = cursor = end;
  }
  return out + text.slice(last);
}

/** A run of text with its references decoded; `rawIndex[i]` is the offset in the run of decoded character `i`. */
function decodeRun(raw) {
  if (!raw.includes('&')) return { text: raw, rawIndex: null };
  let text = '';
  const rawIndex = [];
  let last = 0;
  for (const match of raw.matchAll(ENTITY_REFERENCE)) {
    text += raw.slice(last, match.index);
    for (let i = last; i < match.index; i++) rawIndex.push(i);
    const decoded = decodeEntity(match);
    text += decoded;
    for (let i = 0; i < decoded.length; i++) rawIndex.push(match.index);
    last = match.index + match[0].length;
  }
  text += raw.slice(last);
  for (let i = last; i < raw.length; i++) rawIndex.push(i);
  return { text, rawIndex };
}

const localNameOf = (name) => name.slice(name.lastIndexOf(':') + 1);

/**
 * The prefixes and default namespaces the file binds: `xmlns:p="uri"` and
 * `xmlns="uri"` on any element, and the `prefix` / `uri` of a JSP `taglib`
 * directive. Not scoped: a prefix bound to several namespaces is any of them,
 * which can only make more names local, never fewer, and so never an edge.
 */
function namespaceTable(masked, segments) {
  const prefixes = new Map();
  const defaults = new Set();
  const bind = (prefix, uri) => {
    if (!prefixes.has(prefix)) prefixes.set(prefix, new Set());
    prefixes.get(prefix).add(uri);
  };
  let taglib = {};
  for (const { start, end, context } of segments) {
    if (!context?.attribute) continue;
    const value = () => decodeXmlText(masked.slice(start, end)).trim();
    if (context.attribute === 'xmlns') {
      defaults.add(value());
    } else if (context.attribute.startsWith('xmlns:')) {
      bind(context.attribute.slice('xmlns:'.length), value());
    } else if (context.element === '%@taglib' && (context.attribute === 'prefix' || context.attribute === 'uri')) {
      if (taglib[context.attribute] !== undefined) taglib = {};
      taglib[context.attribute] = value();
      if (taglib.prefix !== undefined && taglib.uri !== undefined) {
        bind(taglib.prefix, taglib.uri);
        taglib = {};
      }
    }
  }
  return { prefixes, defaults };
}

/** Is `element` (as written, prefix included) the element a declaration names, in a namespace it lists? */
function declaredElement(declaration, element, table) {
  if (declaration.element === undefined) return true;
  if (localNameOf(element) !== declaration.element) return false;
  if (declaration.elementNamespaces === undefined) return true;
  const colon = element.lastIndexOf(':');
  const bound = colon < 0 ? table.defaults : table.prefixes.get(element.slice(0, colon));
  return bound !== undefined && declaration.elementNamespaces.some((uri) => bound.has(uri));
}

/** The names the file declares locally, by the catalog's declarations. */
function declaredLocals(masked, segments, declarations, delimiters, mutations) {
  const names = new Set();
  const table = namespaceTable(masked, segments);
  for (const { start, end, context } of segments) {
    if (!context?.attribute) continue;
    for (const declaration of declarations) {
      if (declaration.attribute !== context.attribute || !declaredElement(declaration, context.element, table)) continue;
      if (declaration.declares === 'expression-root') {
        // Tripwire seam: the expression roots of such an attribute are not made local.
        if (mutations.noExpressionLocals) continue;
        const { text } = decodeRun(masked.slice(start, end));
        for (const root of lexRun(text, delimiters, new Set(), { escaped: 0, unterminated: 0 })) names.add(root.token);
      } else {
        const value = decodeXmlText(masked.slice(start, end)).trim();
        if (IDENTIFIER.test(value)) names.add(value);
      }
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// One expression: tokens, then roots
// ---------------------------------------------------------------------------

/** True when a `.` here is a decimal point of a number rather than member access. */
function followsOperand(tokens) {
  const last = tokens[tokens.length - 1];
  if (!last) return false;
  if (last.type === 'ident') return !OPERATOR_WORDS.has(last.text);
  return last.type === 'number' || last.type === 'string' || last.text === ')' || last.text === ']';
}

/**
 * Tokens of the expression whose body starts at `from`, and where it ends: the
 * index of the closing brace. Null when the run ends first, or inside a string.
 */
function tokenize(text, from) {
  const tokens = [];
  let depth = 1;
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    if (WHITESPACE.test(ch)) {
      i++;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) return null;
      tokens.push({ type: 'string', text: text.slice(i, j + 1), at: i });
      i = j + 1;
    } else if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[i + 1] ?? '') && !followsOperand(tokens))) {
      NUMBER.lastIndex = i;
      const number = NUMBER.exec(text)[0];
      tokens.push({ type: 'number', text: number, at: i });
      i += number.length;
    } else if (IDENTIFIER_START.test(ch)) {
      let j = i + 1;
      while (j < text.length && IDENTIFIER_PART.test(text[j])) j++;
      tokens.push({ type: 'ident', text: text.slice(i, j), at: i });
      i = j;
    } else if (ch === '-' && text[i + 1] === '>') {
      tokens.push({ type: 'punct', text: '->', at: i });
      i += 2;
    } else {
      if (ch === '{') depth++;
      if (ch === '}' && --depth === 0) return { tokens, end: i };
      tokens.push({ type: 'punct', text: ch, at: i });
      i++;
    }
  }
  return null;
}

/** For each `(` token, the index of the `)` that closes it (unmatched ones are absent). One pass. */
function parenPairs(tokens) {
  const pairs = new Map();
  const open = [];
  tokens.forEach((token, k) => {
    if (token.type !== 'punct') return;
    if (token.text === '(') open.push(k);
    else if (token.text === ')' && open.length > 0) pairs.set(open.pop(), k);
  });
  return pairs;
}

/**
 * Lambda parameters: the declaration sites (identifiers that are not roots) and,
 * per `->` token, the names it brings into scope.
 */
function lambdaParameters(tokens) {
  const declarations = new Set();
  const byArrow = new Map();
  const closers = parenPairs(tokens);
  tokens.forEach((token, k) => {
    if (token.type === 'ident' && tokens[k + 1]?.text === '->' && tokens[k + 1].type === 'punct') {
      declarations.add(k);
      byArrow.set(k + 1, [token.text]);
    } else if (token.type === 'punct' && token.text === '(') {
      const close = closers.get(k) ?? -1;
      if (close < 0 || tokens[close + 1]?.text !== '->' || tokens[close + 1].type !== 'punct') return;
      const names = [];
      for (let m = k + 1; m < close; m++) {
        if (tokens[m].type !== 'ident') continue;
        declarations.add(m);
        names.push(tokens[m].text);
      }
      byArrow.set(close + 1, names);
    }
  });
  return { declarations, byArrow };
}

/**
 * The roots of one expression's tokens, as `{ at, token, chain, local }` with
 * `at` the offset of the root in the run's decoded text.
 */
function rootsOf(tokens, fileLocals) {
  const { declarations, byArrow } = lambdaParameters(tokens);
  const roots = [];
  const functionNames = new Set();
  const scopes = []; // lambda bodies in force: { names, nest }
  let nest = 0;

  tokens.forEach((token, k) => {
    if (token.type === 'punct') {
      if ('([{'.includes(token.text)) {
        nest++;
      } else if (')]}'.includes(token.text)) {
        nest--;
        while (scopes.length > 0 && scopes[scopes.length - 1].nest > nest) scopes.pop();
      } else if (token.text === ',') {
        // An argument list ends the body of a lambda written directly in it.
        while (scopes.length > 0 && scopes[scopes.length - 1].nest === nest) scopes.pop();
      } else if (token.text === '->' && byArrow.has(k)) {
        scopes.push({ names: new Set(byArrow.get(k)), nest });
      }
      return;
    }
    if (token.type !== 'ident' || declarations.has(k) || functionNames.has(k)) return;
    if (tokens[k - 1]?.type === 'punct' && tokens[k - 1].text === '.') return;
    if (OPERATOR_WORDS.has(token.text)) return;
    // `prefix:name(`: both are the function's; `a ? b : c` has no call after the `c`.
    if (tokens[k + 1]?.text === ':' && tokens[k + 2]?.type === 'ident' && tokens[k + 3]?.text === '(') {
      functionNames.add(k + 2);
      return;
    }

    let chain = token.text;
    for (let m = k; tokens[m + 1]?.text === '.' && tokens[m + 1].type === 'punct' && tokens[m + 2]?.type === 'ident'; m += 2) {
      chain += `.${tokens[m + 2].text}`;
    }
    const local = scopes.some((scope) => scope.names.has(token.text)) || fileLocals.has(token.text);
    roots.push({ at: token.at, token: token.text, chain, local });
  });
  return roots;
}

/**
 * The roots of every expression in one run of decoded text, in order, as
 * `{ at, token, chain, local }` (`at`: offset in the run). Escaped and
 * unterminated delimiters are added to `counts`. An expression with no closing
 * brace yields no root and is counted; scanning goes on after its delimiter, so
 * one missing brace does not swallow the expressions after it. The worst case
 * (a run of nothing but unterminated delimiters) costs delimiters times the
 * length of the run, which the size of a page keeps small.
 */
function lexRun(run, delimiters, fileLocals, counts) {
  const roots = [];
  let cursor = 0;
  for (;;) {
    let open = -1;
    let delimiter = '';
    for (const candidate of delimiters) {
      const found = run.indexOf(candidate, cursor);
      if (found >= 0 && (open < 0 || found < open || (found === open && candidate.length > delimiter.length))) {
        open = found;
        delimiter = candidate;
      }
    }
    if (open < 0) return roots;
    if (open > 0 && run[open - 1] === '\\') {
      counts.escaped += 1;
      cursor = open + delimiter.length;
      continue;
    }
    const body = tokenize(run, open + delimiter.length);
    if (body === null) {
      counts.unterminated += 1;
      cursor = open + delimiter.length;
      continue;
    }
    roots.push(...rootsOf(body.tokens, fileLocals));
    cursor = body.end + 1;
  }
}

// ---------------------------------------------------------------------------
// A file
// ---------------------------------------------------------------------------

/**
 * @param {string} text the content of a template
 * @param {{
 *   language: string,
 *   expressionLanguage: { delimiters: string[], localDeclarations: Array<{ attribute: string, element?: string, elementNamespaces?: string[], declares?: string }> },
 *   template?: boolean,
 *   mutations?: { noCommentMask?: boolean, noExpressionLocals?: boolean },
 * }} options
 *   `language` is the file's manifest language (it decides how the markup
 *   scanner reads element names). `template` says the file is template text
 *   (one run) rather than an XML form (a run per attribute value or text).
 *   `mutations` is a test seam for the mutation tripwire; production callers
 *   leave it empty.
 * @returns {{ roots: Array<{ line: number, token: string, chain: string, local: boolean }>, escaped: number, unterminated: number, unscanned: number }}
 */
export function lexElExpressions(text, { language, expressionLanguage, template = false, mutations = {} }) {
  const result = { roots: [], escaped: 0, unterminated: 0, unscanned: 0 };
  if (!text) return result;

  const { delimiters, localDeclarations } = expressionLanguage;
  // Tripwire seam: markup comments not masked.
  const commentMasked = maskScripting(mutations.noCommentMask ? text : maskMarkupComments(text));
  const segments = markupSegments(commentMasked, language);
  const starts = lineStarts(text);
  const declarationSegments = template ? [...segments, ...actionsInText(commentMasked, segments)] : segments;
  const fileLocals = declaredLocals(commentMasked, declarationSegments, localDeclarations, delimiters, mutations);

  // The bodies of the scripting elements are Java, not template text.
  let masked = commentMasked;
  for (const { start, end, context } of segments) {
    if (context && context.attribute === null && SCRIPTING_ELEMENTS.has(context.element)) {
      masked = masked.slice(0, start) + blank(masked.slice(start, end)) + masked.slice(end);
    }
  }

  const lexAt = (start, raw) => {
    if (!raw.includes('&') && !delimiters.some((d) => raw.includes(d))) return;
    const { text: run, rawIndex } = decodeRun(raw);
    const lineOf = (at) => lineAt(starts, start + (rawIndex ? rawIndex[at] : at));
    for (const root of lexRun(run, delimiters, fileLocals, result)) {
      result.roots.push({ line: lineOf(root.at), token: root.token, chain: root.chain, local: root.local });
    }
  };

  if (template) {
    lexAt(0, masked);
    return result;
  }

  const runs = segments
    .filter(({ context }) => !(context && context.attribute === null && SCRIPTING_ELEMENTS.has(context.element)))
    .map(({ start, end }) => [start, end]);
  for (const [start, end] of runs) lexAt(start, masked.slice(start, end));
  result.unscanned = delimitersOutside(masked, runs, delimiters);
  return result;
}

/**
 * The attribute segments of the prefixed elements (the page's actions, such as
 * `c:forEach`) that a template-text file writes inside what the markup scanner
 * keeps as text: a `<script>` or `<style>` body, which HTML reads as raw text,
 * and a CDATA section. A JSP compiler treats all of that as template text and
 * runs the actions in it, so their `var` declares a name the expressions after
 * it use. Unprefixed tags there are left alone: they are script or character
 * data, and reading them could only declare more local names.
 */
function actionsInText(text, segments) {
  const found = [];
  for (const { start, end, context } of segments) {
    if (context?.attribute || !text.slice(start, end).includes('<')) continue;
    for (const inner of markupSegments(text.slice(start, end), 'jspx')) {
      if (inner.context?.attribute && inner.context.element.includes(':')) {
        found.push({ start: start + inner.start, end: start + inner.end, context: inner.context });
      }
    }
  }
  return found;
}

/** How many delimiters `text` writes outside every one of the `[start, end)` runs. */
function delimitersOutside(text, runs, delimiters) {
  const sorted = runs.slice().sort((a, b) => a[0] - b[0]);
  const inRun = (at, length) => {
    let low = 0;
    let high = sorted.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const [start, end] = sorted[mid];
      if (at < start) high = mid - 1;
      else if (at >= end) low = mid + 1;
      else return at + length <= end;
    }
    return false;
  };
  let outside = 0;
  for (const delimiter of delimiters) {
    for (let at = text.indexOf(delimiter); at >= 0; at = text.indexOf(delimiter, at + delimiter.length)) {
      if (!inRun(at, delimiter.length)) outside += 1;
    }
  }
  return outside;
}
