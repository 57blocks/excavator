/**
 * The readers of the files that write a system's name (openspec change
 * handbook-system-name): each takes the text of one file and returns the
 * values it holds with the 1-based line each value starts on. Nothing here
 * touches the file system; name-candidates.mjs decides which files to read.
 * A value is as the file writes it, with runs of white space made one space
 * and the ends trimmed. An empty value is returned as an empty string and
 * left to the caller, which lists no empty value.
 */

const tidy = (text) => text.replace(/\s+/g, ' ').trim();

/** The 1-based line of UTF-16 offset `offset` in `text`. */
function lineAt(text, offset) {
  let line = 1;
  for (let k = text.indexOf('\n'); k !== -1 && k < offset; k = text.indexOf('\n', k + 1)) line += 1;
  return line;
}

/** `text` with every match of `pattern` replaced by white space of the same length, line breaks kept, so offsets and lines do not move. */
const blank = (text, pattern) => text.replace(pattern, (match) => match.replace(/[^\n]/g, ' '));

/** The text of a JSON file as an object, or null when it is not one JSON object. */
export function parseJsonObject(text) {
  try {
    const value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The string values of the top-level keys `wanted` of a JSON text, as
 * `{ key, value, line }` in file order. A key nested in an object or an array
 * does not count. The text must have been accepted by `parseJsonObject`.
 */
export function jsonTopLevelStrings(text, wanted) {
  const found = [];
  let depth = 0;
  let line = 1;
  let lastKey = null;
  let previous = '';
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '\n') {
      line += 1;
      i += 1;
    } else if (char === ' ' || char === '\t' || char === '\r') {
      i += 1;
    } else if (char === '"') {
      const startLine = line;
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') j += 1;
        j += 1;
      }
      const raw = text.slice(i + 1, j);
      let next = j + 1;
      while (next < text.length && /\s/.test(text[next])) next += 1;
      if (depth === 1) {
        let decoded = raw;
        try {
          decoded = JSON.parse(`"${raw}"`);
        } catch {
          // Keep the raw text; parseJsonObject accepted the file, so this does not happen.
        }
        if (text[next] === ':') lastKey = decoded;
        else if (previous === ':' && wanted.includes(lastKey)) found.push({ key: lastKey, value: tidy(decoded), line: startLine });
      }
      previous = '"';
      i = j + 1;
    } else {
      if (char === '{' || char === '[') depth += 1;
      else if (char === '}' || char === ']') depth -= 1;
      previous = char;
      i += 1;
    }
  }
  return found;
}

/** The first `<title>` of an HTML text, outside comments: `{ value, line }` (the line the text starts on), or null when there is none. */
export function htmlTitle(text) {
  const visible = blank(text, /<!--[\s\S]*?-->/g);
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(visible);
  if (match === null) return null;
  const inner = match[1];
  const start = match.index + match[0].indexOf('>') + 1 + (inner.length - inner.trimStart().length);
  return { value: tidy(inner), line: lineAt(text, start) };
}

const REFERENCES = [/%([A-Za-z_][A-Za-z0-9_]*)%/g, /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g];

/** The distinct variable names a text refers to as `%NAME%`, `${NAME}` or `import.meta.env.NAME`, in order of appearance. */
export function variableReferences(value) {
  const found = [];
  for (const pattern of REFERENCES) {
    for (const match of value.matchAll(pattern)) found.push({ name: match[1], at: match.index });
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((item) => item.name))];
}

/** Whether a value still refers to a variable or a property (`%X%`, `${X}`, `import.meta.env.X`, `${a.b}`): it is not a name yet. */
export const hasReference = (value) => variableReferences(value).length > 0 || /\$\{[^}]*\}/.test(value);

/** The value of the last `NAME=value` line for `name` in the text of a `.env` file, as `{ value, line }`, or null. A quoted value ends at its quote; an unquoted one at a space and `#`. */
export function envValue(text, name) {
  let found = null;
  text.split('\n').forEach((raw, index) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(raw.replace(/\r$/, ''));
    if (match === null || match[1] !== name) return;
    const rest = match[2];
    const quoted = /^(["'])(.*?)\1/.exec(rest);
    const value = quoted !== null ? quoted[2] : rest.replace(/\s+#.*$/, '');
    found = { value: tidy(value), line: index + 1 };
  });
  return found;
}

/** The module directive of a go.mod text: `{ value, line }` with the last segment of the module path, or null. */
export function goModule(text) {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*module\s+"?([^\s"]+)"?\s*(?:\/\/.*)?$/.exec(lines[index].replace(/\r$/, ''));
    if (match === null) continue;
    const segments = match[1].split('/').filter((segment) => segment !== '');
    return segments.length === 0 ? null : { value: segments.at(-1), line: index + 1 };
  }
  return null;
}

/** The `rootProject.name` assignments of a Gradle settings text: `{ value, line }` in file order, comment lines skipped. */
export function gradleRootNames(text) {
  const found = [];
  text.split('\n').forEach((raw, index) => {
    const match = /^\s*rootProject\.name\s*=\s*(["'])(.*?)\1/.exec(raw);
    if (match !== null) found.push({ value: tidy(match[2]), line: index + 1 });
  });
  return found;
}

const XML_TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)(?:\s[^<>]*?)?(\/?)>/g;

/** The `<name>` and `<artifactId>` that are direct children of the root `<project>` of a pom.xml text: `{ tag, value, line }` in file order. */
export function mavenNames(text) {
  const found = [];
  const stack = [];
  let capture = null;
  for (const token of text.matchAll(XML_TOKEN)) {
    const [whole, closing, opening, selfClosing] = token;
    if (closing !== undefined) {
      if (capture !== null && stack.length === 2 && stack[1] === closing) {
        const inner = text.slice(capture.from, token.index);
        const lead = inner.length - inner.trimStart().length;
        found.push({ tag: capture.tag, value: tidy(inner), line: lineAt(text, capture.from + lead) });
        capture = null;
      }
      stack.pop();
    } else if (opening !== undefined && selfClosing === '') {
      if (stack.length === 1 && stack[0] === 'project' && (opening === 'name' || opening === 'artifactId')) capture = { tag: opening, from: token.index + whole.length };
      stack.push(opening);
    }
  }
  return found;
}
