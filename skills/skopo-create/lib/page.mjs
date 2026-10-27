/**
 * report.html: one self-contained page that opens from disk. The Markdown it renders is partly
 * model-written, so every character is escaped first and only a small set of structures is laid
 * over the escaped text: headings, paragraphs, lists, tables, bold, inline code and code blocks.
 * No link, no raw HTML and no script is ever produced (openspec change skopo-extension, design D7).
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Inline structure over already-escaped text: code spans first, so nothing inside them is bolded. */
function inline(text) {
  return escapeHtml(text)
    .split(/(`[^`]+`)/)
    .map((part) => (/^`[^`]+`$/.test(part) ? `<code>${part.slice(1, -1)}</code>` : part.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')))
    .join('');
}

const cellsOf = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isSeparatorRow = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line);
const LIST_ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;

/** The body HTML for `markdown`. */
export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      html.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const hasHeader = rows.length > 1 && isSeparatorRow(rows[1]);
      const head = hasHeader ? `<thead><tr>${cellsOf(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : '';
      const bodyRows = (hasHeader ? rows.slice(2) : rows).filter((r) => !isSeparatorRow(r));
      html.push(`<table>${head}<tbody>${bodyRows.map((r) => `<tr>${cellsOf(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (item) {
      const ordered = Boolean(item[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_ITEM);
        if (m && Boolean(m[2]) === ordered) {
          items.push(m[3]);
          i += 1;
        } else if (items.length > 0 && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i += 1;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }
    const paragraph = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) && !/^\s*(\||```)/.test(lines[i]) && !LIST_ITEM.test(lines[i])) {
      paragraph.push(lines[i].replace(/^\s*>\s?/, '').trim());
      i += 1;
    }
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return html.join('\n');
}

const STYLE = `
:root { --bg: #ffffff; --fg: #1d1d1f; --muted: #5f6368; --rule: #d9dce1; --code: #f3f4f6; }
@media (prefers-color-scheme: dark) { :root { --bg: #16181b; --fg: #e8eaed; --muted: #9aa0a6; --rule: #3a3f45; --code: #23272b; } }
body { background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; }
main { max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; }
h1, h2, h3 { line-height: 1.25; } h2 { border-top: 1px solid var(--rule); padding-top: 24px; margin-top: 40px; }
table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; font-size: 14px; }
th, td { border: 1px solid var(--rule); padding: 6px 10px; text-align: left; vertical-align: top; }
code { background: var(--code); padding: 1px 4px; border-radius: 4px; font-size: 0.92em; }
pre { background: var(--code); padding: 12px; overflow-x: auto; } pre code { padding: 0; }
`;

/** The whole page: no external resource, no script. */
export function renderPage(markdown, title) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${renderMarkdown(markdown)}
</main>
</body>
</html>
`;
}
