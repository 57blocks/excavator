/**
 * The YAML front-matter of a feature chapter, read with a deliberately small
 * subset of YAML: `key: scalar`, `key: [a, b]` and a `key:` followed by
 * `  - item` lines. Scalars may be quoted; a whole-number scalar is a number.
 * Anything else is reported, never guessed at.
 */

const KEY_LINE = /^([A-Za-z][\w-]*):(?:\s+(.*?))?\s*$/;
const ITEM_LINE = /^\s+-\s+(.*?)\s*$/;

function scalar(raw) {
  const text = raw.trim();
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1);
  }
  if (/^-?\d+$/.test(text)) return Number(text);
  return text;
}

/** Split a flow list `[a, "b, c", d]` on the commas outside quotes. */
function flowList(raw) {
  const inner = raw.trim().slice(1, -1);
  if (inner.trim() === '') return [];
  const items = [];
  let current = '';
  let quote = null;
  for (const char of inner) {
    if (quote !== null) {
      if (char === quote) quote = null;
      current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ',') {
      items.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  items.push(current);
  return items.map((item) => scalar(item)).map((item) => (typeof item === 'number' ? String(item) : item));
}

/**
 * Split `text` into its front-matter and body.
 * @returns {{ ok: true, data: object, body: string } | { ok: false, reason: string }}
 */
export function parseFrontMatter(rawText) {
  const text = rawText.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { ok: false, reason: 'has no front-matter (it must open with a --- line)' };
  const end = text.indexOf('\n---\n', 3);
  const endAtEof = text.endsWith('\n---') ? text.length - 4 : -1;
  const close = end !== -1 ? end : endAtEof;
  if (close === -1) return { ok: false, reason: 'has no closing --- line after its front-matter' };
  const lines = text.slice(4, close + 1).split('\n').filter((line, index, all) => !(index === all.length - 1 && line === ''));
  const data = {};
  let listKey = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const item = ITEM_LINE.exec(line);
    if (item && listKey !== null) {
      data[listKey].push(String(scalar(item[1])));
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (!match) return { ok: false, reason: `front-matter line ${i + 2} is not "key: value" or a "- item" of a list` };
    const [, key, value = ''] = match;
    if (Object.hasOwn(data, key)) return { ok: false, reason: `front-matter key ${key} repeats` };
    if (value === '') {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith('[')) {
      if (!value.endsWith(']')) return { ok: false, reason: `front-matter key ${key} opens a [ list it does not close` };
      data[key] = flowList(value);
      listKey = null;
    } else {
      data[key] = scalar(value);
      listKey = null;
    }
  }
  return { ok: true, data, body: text.slice(close + 5) };
}
