/**
 * The schedule of a job candidate, read only from the string literals of its
 * registration line (design D2 of handbook-summary-tables). One of three
 * buckets: `literal` (a cron-shaped literal or an `@` descriptor, written
 * out), `computed` (a template literal of cron shape with interpolations) and
 * `absent` (anything else: configuration, a variable, a line cut by the length
 * cap). Nothing is read from configuration and no variable is followed.
 */

const DESCRIPTOR = /^@(?:yearly|annually|monthly|weekly|daily|midnight|hourly)$/;
const EVERY = /^@every\s+(?:\d+(?:\.\d+)?(?:ns|us|\u00b5s|\u03bcs|ms|s|m|h))+$/;
const NAME = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|sun|mon|tue|wed|thu|fri|sat)/gi;
const SEGMENT = /^[0-9*/,\-?LW#]+$/;

/** True for five or six white-space separated segments of cron characters or month and weekday names. */
function cronShaped(text) {
  const segments = text.trim().split(/\s+/);
  return (segments.length === 5 || segments.length === 6) && segments.every((segment) => SEGMENT.test(segment.replace(NAME, '0')));
}

const isSchedule = (text) => cronShaped(text) || DESCRIPTOR.test(text.trim()) || EVERY.test(text.trim());

/** The index after the `}` that closes the interpolation whose `{` is at `start`, or -1. */
function interpolationEnd(line, start) {
  let depth = 0;
  for (let i = start; i < line.length; i += 1) {
    const c = line[i];
    if (c === "'" || c === '"' || c === '`') {
      const nested = readLiteral(line, i);
      if (nested === null) return -1;
      i = nested.end - 1;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The literal that opens at `line[start]`: `{ text, interpolated, end }` (each
 * interpolation of a template becomes `0` in `text`), or null when it has no
 * closing quote.
 */
function readLiteral(line, start) {
  const quote = line[start];
  let text = '';
  let interpolated = false;
  for (let i = start + 1; i < line.length; i += 1) {
    const c = line[i];
    if (c === quote) return { text, interpolated, end: i + 1 };
    if (c === '\\') {
      text += line.slice(i, i + 2);
      i += 1;
    } else if (quote === '`' && c === '$' && line[i + 1] === '{') {
      const end = interpolationEnd(line, i + 1);
      if (end === -1) return null;
      text += '0';
      interpolated = true;
      i = end - 1;
    } else {
      text += c;
    }
  }
  return null;
}

/** The string literals of a line in order; reading stops at a literal that never closes. */
function literalsOf(line) {
  const out = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "'" && line[i] !== '"' && line[i] !== '`') continue;
    const read = readLiteral(line, i);
    if (read === null) break;
    out.push(read);
    i = read.end - 1;
  }
  return out;
}

/** `{ bucket, literal }` of a registration line's text; `literal` is the schedule as written for the `literal` bucket and null otherwise. */
export function scheduleBucket(text) {
  const found = literalsOf(text);
  const plain = found.find((item) => !item.interpolated && isSchedule(item.text));
  if (plain !== undefined) return { bucket: 'literal', literal: plain.text.trim() };
  if (found.some((item) => item.interpolated && cronShaped(item.text))) return { bucket: 'computed', literal: null };
  return { bucket: 'absent', literal: null };
}
