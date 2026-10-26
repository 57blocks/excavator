// @ts-check
/**
 * single-file.mjs
 *
 * Turns the vite build into one HTML template (openspec: changes/viewer-app,
 * design D2; changes/retire-view-html, design D5). The vite plugin below runs
 * in `generateBundle`: it writes the one JavaScript chunk into a `<script type="module">` and each stylesheet into a
 * `<style>`, then removes every other output, so the build writes exactly
 * `explorer.html`. Anything it cannot inline fails the build rather than being left
 * next to the template.
 *
 * `checkTemplate` is the check the build runs on its output (and the plugin on
 * its result): one file, one CSP marker, one data marker, no `<link>`, no
 * `<script src>`, no inline script that could end its element early, no
 * external font or stylesheet import. It reads the markup the way a browser
 * splits it: a script or style body ends at the first `</script` or `</style`.
 */

export const TEMPLATE_FILE = 'explorer.html';
export const CSP_MARKER = '<!-- xv:csp -->';
export const DATA_MARKER = '<!-- xv:data -->';

const BACKSLASH = String.fromCharCode(92);

/** A `<` that would start `</script` or `<!--` inside an inline script. */
const UNSAFE_IN_SCRIPT = /<(?=\/script|!--)/gi;
const SCRIPT_WITH_SRC = /<script\b([^>]*?)\bsrc="([^"]*)"([^>]*)>\s*<\/script\s*>/gi;
const LINK_TAG = /<link\b[^>]*>/gi;
const RAW_TEXT_OPEN = /<(script|style)\b[^>]*>/gi;

/**
 * Write `<` as `\x3c` wherever it would start `</script` or `<!--`, so the code
 * cannot close its element early or put the parser in an escaped state. In
 * string, template and regular expression literals `\x3c` is the same `<`.
 * @param {string} code
 * @returns {string}
 */
export function escapeInlineScript(code) {
  return code.replace(UNSAFE_IN_SCRIPT, () => `${BACKSLASH}x3c`);
}

/**
 * Why `code` cannot sit inside an inline `<script>`, or null.
 * @param {string} code
 * @returns {string | null}
 */
export function inlineScriptProblem(code) {
  if (/<\/script/i.test(code)) return 'the inline script contains </script';
  if (code.includes('<!--')) return 'the inline script contains <!--';
  return null;
}

/** @param {string} text @param {string} part */
function countOf(text, part) {
  return text.split(part).length - 1;
}

/**
 * Split the HTML the way a browser does for raw-text elements: the markup
 * outside script and style bodies, and each body with its opening tag.
 * @param {string} html
 */
function splitRawText(html) {
  /** @type {string[]} */
  const markup = [];
  /** @type {{ tag: string, start: number, open: string, body: string, closed: boolean }[]} */
  const bodies = [];
  let at = 0;
  RAW_TEXT_OPEN.lastIndex = 0;
  for (let match = RAW_TEXT_OPEN.exec(html); match; match = RAW_TEXT_OPEN.exec(html)) {
    const tag = match[1].toLowerCase();
    const bodyStart = match.index + match[0].length;
    markup.push(html.slice(at, bodyStart));
    // A regex, not toLowerCase + indexOf: lowercasing can change the length of the text before the match.
    const closer = new RegExp(`</${tag}`, 'gi');
    closer.lastIndex = bodyStart;
    const found = closer.exec(html);
    const close = found ? found.index : -1;
    const closed = close !== -1;
    bodies.push({ tag, start: match.index, open: match[0], body: html.slice(bodyStart, closed ? close : html.length), closed });
    at = closed ? close + `</${tag}`.length : html.length;
    RAW_TEXT_OPEN.lastIndex = at;
  }
  markup.push(html.slice(at));
  return { markup: markup.join(''), bodies };
}

/**
 * Every way the build output breaks the template contract; an empty list means it holds.
 * @param {string[]} fileNames every entry of the output directory, relative to it
 * @param {string | null} html the text of explorer.html, or null when it is missing
 * @returns {string[]}
 */
export function checkTemplate(fileNames, html) {
  const problems = [];
  const others = fileNames.filter((name) => name !== TEMPLATE_FILE).sort();
  if (others.length > 0) problems.push(`the output holds more than ${TEMPLATE_FILE}: ${others.join(', ')}`);
  if (html === null) {
    problems.push(`the output has no ${TEMPLATE_FILE}`);
    return problems;
  }
  for (const marker of [CSP_MARKER, DATA_MARKER]) {
    const count = countOf(html, marker);
    if (count !== 1) problems.push(`${TEMPLATE_FILE} has ${count} ${marker}; it needs exactly one`);
  }

  const { markup, bodies } = splitRawText(html);
  const firstRawText = bodies.length > 0 ? bodies[0].start : -1;
  const cspAt = html.indexOf(CSP_MARKER);
  if (cspAt !== -1 && firstRawText !== -1 && cspAt > firstRawText) {
    problems.push(`${CSP_MARKER} comes after the first script or style, so the policy would not cover it`);
  }
  if (/<link\b/i.test(markup)) problems.push(`${TEMPLATE_FILE} has a <link> tag`);
  if (/<\/script/i.test(markup)) problems.push(`${TEMPLATE_FILE} has a </script that closes no script: an inline script ends its element early`);
  if (/<\/style/i.test(markup)) problems.push(`${TEMPLATE_FILE} has a </style that closes no style: an inline style ends its element early`);
  for (const { tag, open, body, closed } of bodies) {
    if (!closed) problems.push(`${TEMPLATE_FILE} has a <${tag}> that is never closed`);
    if (tag === 'script' && /\bsrc\s*=/i.test(open)) problems.push(`${TEMPLATE_FILE} has a <script> with src=`);
    if (tag === 'script' && body.includes('<!--')) problems.push(`${TEMPLATE_FILE} has an inline script that contains <!--`);
  }
  if (html.includes('//fonts.')) problems.push(`${TEMPLATE_FILE} refers to //fonts.`);
  if (/@import\s+url\(/i.test(html)) problems.push(`${TEMPLATE_FILE} has @import url(`);
  return problems;
}

/** @param {string} ref */
function bundleName(ref) {
  return ref.replace(/^\.?\//, '');
}

/** @param {string} tag @param {string} name */
function attribute(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag);
  return match ? match[1] : null;
}

/**
 * @typedef {{ type: 'chunk', fileName: string, code: string }} ChunkOutput
 * @typedef {{ type: 'asset', fileName: string, source: string | Uint8Array }} AssetOutput
 * @typedef {Record<string, ChunkOutput | AssetOutput | { type: string, fileName: string }>} OutputBundle
 */

/** @param {AssetOutput} asset */
function assetText(asset) {
  return typeof asset.source === 'string' ? asset.source : new TextDecoder().decode(asset.source);
}

/**
 * Inline the bundle into explorer.html and remove every other output; throws, naming the
 * outputs, when the bundle is not one HTML file, one JavaScript chunk and stylesheets.
 * `notice`, a comment, is put at the very start of the file. Mutates `bundle`.
 * @param {OutputBundle} bundle
 * @param {string} [notice]
 */
export function collapseBundle(bundle, notice = '') {
  const names = Object.keys(bundle).sort();
  const htmlNames = names.filter((name) => name.endsWith('.html'));
  if (htmlNames.length !== 1 || htmlNames[0] !== TEMPLATE_FILE) {
    throw new Error(`the build must produce exactly one HTML file, ${TEMPLATE_FILE}; it produced ${htmlNames.join(', ') || 'none'}`);
  }
  const chunks = names.filter((name) => bundle[name].type === 'chunk');
  if (chunks.length !== 1) {
    throw new Error(`the build must produce exactly one JavaScript chunk; it produced ${chunks.length} (${chunks.join(', ')})`);
  }
  const htmlAsset = /** @type {AssetOutput} */ (bundle[TEMPLATE_FILE]);
  const inlined = new Set([TEMPLATE_FILE]);

  let html = assetText(htmlAsset).replace(SCRIPT_WITH_SRC, (tag, _before, src) => {
    const output = bundle[bundleName(src)];
    if (!output || output.type !== 'chunk' || !/\btype="module"/i.test(tag)) {
      throw new Error(`cannot inline ${tag}: it is not the module chunk of this build`);
    }
    const code = escapeInlineScript(/** @type {ChunkOutput} */ (output).code);
    const problem = inlineScriptProblem(code);
    if (problem) throw new Error(`cannot inline ${output.fileName}: ${problem} after escaping`);
    inlined.add(output.fileName);
    return `<script type="module">${code}</script>`;
  });
  html = html.replace(LINK_TAG, (tag) => {
    const href = attribute(tag, 'href');
    const output = href === null ? undefined : bundle[bundleName(href)];
    if (attribute(tag, 'rel') !== 'stylesheet' || !output || output.type !== 'asset' || !output.fileName.endsWith('.css')) {
      throw new Error(`cannot inline ${tag}: it is not a stylesheet of this build`);
    }
    const css = assetText(/** @type {AssetOutput} */ (output));
    if (/<\/style/i.test(css)) throw new Error(`cannot inline ${output.fileName}: it contains </style`);
    inlined.add(output.fileName);
    return `<style>${css}</style>`;
  });

  const leftover = names.filter((name) => !inlined.has(name));
  if (leftover.length > 0) {
    throw new Error(`the build produced output(s) the template does not inline: ${leftover.join(', ')}`);
  }
  const problems = checkTemplate([TEMPLATE_FILE], html);
  if (problems.length > 0) throw new Error(problems.join('; '));

  for (const name of names) if (name !== TEMPLATE_FILE) delete bundle[name];
  htmlAsset.source = notice + html;
}

/**
 * The vite plugin: collapse the bundle after vite has written its HTML.
 * `notice` gives the comment to put at the start of the file, read when the bundle is written.
 * @param {() => string} [notice]
 * @returns {import('vite').Plugin}
 */
export function singleFile(notice = () => '') {
  return {
    name: 'excavator-single-file',
    enforce: 'post',
    generateBundle(_options, bundle) {
      try {
        collapseBundle(/** @type {OutputBundle} */ (/** @type {unknown} */ (bundle)), notice());
      } catch (error) {
        this.error(/** @type {Error} */ (error).message);
      }
    },
  };
}
