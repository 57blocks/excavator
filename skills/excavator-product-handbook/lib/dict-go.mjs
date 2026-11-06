/**
 * Go value sets (openspec change handbook-status-dictionary, design D2 and
 * D4), read per package directory. A value set is a named type (`type T string`
 * or the alias form `type T = string`) whose underlying type is a string or an
 * integer type, with the constants of the
 * same directory that are declared with that type. A constant group's
 * implicit repetition (a name written alone repeats the previous type and
 * expression) and `iota` (the item's position in its group, from 0) follow
 * Go's rules. Every named type and every constant item lands in one bucket;
 * nothing is run.
 */

import { commentFinder } from './dict-comments.mjs';
import { matchingBracket, splitTopLevel } from './dict-text.mjs';
import { evalGoExpression } from './dict-values.mjs';

/** The underlying types a Go named type may have to be a value set. */
export const GO_BASIC_TYPES = Object.freeze(['string', 'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32', 'uint64']);

const collapse = (text) => text.replace(/\s+/g, ' ').trim();
const CONTINUES = /[,+\-*/%&|^<>=!]$/;

/** The `type` and `const` declarations at the top level of a file: `{ keyword, start, end, grouped }` over `code`. */
function topLevelDeclarations(code) {
  const found = [];
  const n = code.length;
  let brace = 0;
  let paren = 0;
  let i = 0;
  while (i < n) {
    if ((i === 0 || code[i - 1] === '\n') && brace === 0 && paren === 0) {
      const keyword = /^(type|const)\b/.exec(code.slice(i, i + 6));
      if (keyword !== null) {
        let j = i + keyword[1].length;
        while (code[j] === ' ' || code[j] === '\t') j += 1;
        if (code[j] === '(') {
          const close = matchingBracket(code, j);
          const end = close < 0 ? n : close;
          found.push({ keyword: keyword[1], start: j + 1, end, grouped: true });
          i = end + 1;
          continue;
        }
        const lineEnd = code.indexOf('\n', j);
        found.push({ keyword: keyword[1], start: j, end: lineEnd < 0 ? n : lineEnd, grouped: false });
      }
    }
    const ch = code[i];
    if (ch === '{') brace += 1;
    else if (ch === '}') brace -= 1;
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    i += 1;
  }
  return found;
}

/** The specs of a group body: ranges split at a newline or `;` outside brackets, unless the line ends in an operator or a comma. */
function splitSpecs(code, from, to) {
  const specs = [];
  let depth = 0;
  let start = from;
  const push = (end) => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(code[s])) s += 1;
    while (e > s && /\s/.test(code[e - 1])) e -= 1;
    if (e > s) specs.push({ start: s, end: e });
  };
  for (let i = from; i < to; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (depth === 0 && (ch === ';' || ch === '\n')) {
      if (ch === '\n' && CONTINUES.test(code.slice(start, i).trimEnd())) continue;
      push(i);
      start = i + 1;
    }
  }
  push(to);
  return specs;
}

/** `{ name, base }` for a `Name basicType` or an alias `Name = basicType` spec, or null. */
function parseTypeSpec(specCode) {
  const m = new RegExp(`^([A-Za-z_]\\w*)(?:\\s+|\\s*=\\s*)(${GO_BASIC_TYPES.join('|')})$`).exec(specCode);
  return m === null ? null : { name: m[1], base: m[2] };
}

/**
 * The items of one const spec `A, B T = e1, e2`: `{ names: [{ name, start }], typeText, expressions }`;
 * `typeText` and `expressions` are null for what the spec leaves out. `exprStart` is where the expression list starts.
 */
function parseConstSpec(code, range) {
  const specCode = code.slice(range.start, range.end);
  const m = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*([\s\S]*)$/.exec(specCode);
  if (m === null) return null;
  const names = [...m[1].matchAll(/[A-Za-z_]\w*/g)].map((hit) => ({ name: hit[0], start: range.start + hit.index }));
  const rest = m[2];
  const restStart = range.end - rest.length;
  const eq = rest.indexOf('=');
  const typeText = eq === 0 || rest === '' ? null : collapse(eq < 0 ? rest : rest.slice(0, eq));
  const exprStart = eq < 0 ? null : restStart + eq + 1;
  return { names, typeText, exprStart };
}

/**
 * The reading of one Go file: `{ package, types, items }`. `types` are
 * `{ name, base, line }` for each named type with a basic underlying type;
 * `items` are one per constant name, in source order, with `typeText` (what
 * the item is declared with, repeated from the previous item when the spec
 * leaves it out), `usesIota`, the value (`computed`, `value`, `reason`) and
 * the comments next to the spec.
 */
export function readGoFile(source) {
  const { text, code, lineAt } = source;
  const commentsFor = commentFinder(source);
  const pkg = /^[ \t]*package[ \t]+([A-Za-z_]\w*)/m.exec(code)?.[1] ?? null;
  const types = [];
  const items = [];
  for (const declaration of topLevelDeclarations(code)) {
    const specs = declaration.grouped ? splitSpecs(code, declaration.start, declaration.end) : splitSpecs(code, declaration.start, declaration.end).slice(0, 1);
    if (declaration.keyword === 'type') {
      for (const range of specs) {
        const parsed = parseTypeSpec(code.slice(range.start, range.end));
        if (parsed !== null) types.push({ ...parsed, line: lineAt(range.start) });
      }
      continue;
    }
    let previous = null;
    specs.forEach((range, iota) => {
      const spec = parseConstSpec(code, range);
      if (spec === null) return;
      let expressions = null;
      if (spec.exprStart !== null) {
        const ranges = splitTopLevel(code, spec.exprStart, range.end);
        expressions = ranges.map((part) => ({ raw: text.slice(part.start, part.end), code: code.slice(part.start, part.end) }));
        if (expressions.length !== spec.names.length) expressions = spec.names.map(() => ({ raw: text.slice(spec.exprStart, range.end), code: code.slice(spec.exprStart, range.end) }));
      }
      const typeText = spec.typeText ?? (expressions === null ? previous?.typeText ?? null : null);
      if (expressions !== null) previous = { typeText: spec.typeText, expressions };
      const used = expressions ?? previous?.expressions ?? [];
      const comments = commentsFor(range.start, range.end);
      spec.names.forEach((name, k) => {
        const expression = used[k] ?? used[0] ?? { raw: '', code: '' };
        const evaluated = expression.raw === '' ? { computed: false } : evalGoExpression(expression.raw, iota);
        items.push({
          name: name.name,
          line: lineAt(name.start),
          typeText,
          usesIota: /\biota\b/.test(expression.code),
          ...(evaluated.computed ? { computed: true, value: evaluated.value } : { computed: false, value: expression.raw === '' ? null : collapse(expression.raw), reason: 'expression' }),
          comments,
        });
      });
    });
  }
  return { package: pkg, types, items };
}
