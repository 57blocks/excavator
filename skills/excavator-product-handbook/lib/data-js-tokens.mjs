/**
 * A light reader of JavaScript and TypeScript text (openspec change
 * handbook-data-tables, design D2 and D3): it finds the string literals and the
 * comments, so a call or a name inside either is not taken for code. It is not
 * a parser: a regular expression literal that holds a quote can confuse it,
 * and the result is only as good as that. Nothing is run or imported.
 */

const blank = (text) => text.replace(/[^\n]/g, ' ');

/** The index of the `}` that closes a `${` whose body starts at `from`, braces counted; the text length when there is none. */
function endOfInterpolation(text, from) {
  let depth = 1;
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return text.length;
}

/**
 * `{ code, strings }`. `code` is the text with every comment and every string
 * body replaced by spaces (newlines kept, quotes kept), so it has the same
 * length and the same line starts as `text`. `strings` maps the index of an
 * opening quote to `{ end, raw, interpolated }`: `end` is the index of the
 * closing quote, `raw` the text between the quotes as written, and
 * `interpolated` is true for a template literal that holds `${`.
 */
export function tokenizeJs(text) {
  const strings = new Map();
  const parts = [];
  const n = text.length;
  let last = 0;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      let end = text.indexOf('\n', i);
      if (end < 0) end = n;
      parts.push(text.slice(last, i), blank(text.slice(i, end)));
      last = end;
      i = end;
    } else if (ch === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close < 0 ? n : close + 2;
      parts.push(text.slice(last, i), blank(text.slice(i, end)));
      last = end;
      i = end;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let k = i + 1;
      let interpolated = false;
      while (k < n) {
        const c = text[k];
        if (c === '\\') {
          k += 2;
          continue;
        }
        if (c === ch) break;
        if (ch !== '`' && c === '\n') break;
        if (ch === '`' && c === '$' && text[k + 1] === '{') {
          interpolated = true;
          k = endOfInterpolation(text, k + 2) + 1;
          continue;
        }
        k += 1;
      }
      const end = Math.min(k, n);
      const raw = text.slice(i + 1, end);
      strings.set(i, { end, raw, interpolated });
      parts.push(text.slice(last, i + 1), blank(raw));
      last = end;
      i = end + 1;
    } else {
      i += 1;
    }
  }
  parts.push(text.slice(last));
  return { code: parts.join(''), strings };
}

/** The line (1-based) of each index: `lineAt(index)`, by binary search over the line starts. */
export function lineIndex(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}
