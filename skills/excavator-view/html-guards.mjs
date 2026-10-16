/**
 * html-guards.mjs
 *
 * Static checks a view page must pass before it is written (openspec change
 * `artifact-view`, requirement "single self-contained file with zero
 * dependencies"): no external resource reference and a content security
 * policy that allows no network source. Used by the bake's pre-write
 * self-check and by the template build test, so both apply the same rules.
 *
 * Markup is scanned for src=/href=/url()/import() targets with inline script
 * bodies removed first: minified JavaScript is full of `x.src=` assignments
 * and `href==` comparisons that are not references. Script bodies are
 * scanned separately for dynamic `import()` of a literal target, which is the
 * only way bundled code could load another file. The view's CSP blocks any
 * load at runtime regardless; these checks catch a broken build before it is
 * shipped.
 */

/** The template's data placeholder, which must occur exactly once. */
export const DATA_PLACEHOLDER = '<script type="text/plain" id="excavator-view-data"></script>';

/** Directives the view's CSP must carry with exactly these values. */
export const REQUIRED_CSP = Object.freeze({
  'default-src': ["'none'"],
  'script-src': ["'unsafe-inline'"],
  'style-src': ["'unsafe-inline'"],
  'img-src': ['data:'],
  'worker-src': ['blob:'],
  'connect-src': ["'none'"],
});

/**
 * Literal `import('...')` texts that bundled libraries carry inside error
 * message strings (React's lazy() guidance). They are prose, not loads.
 */
const DOCUMENTATION_IMPORT_TEXTS = new Set(["import('./MyComponent')"]);

/** @param {string} target */
function isInlineTarget(target) {
  const value = target.trim();
  return value === '' || value.startsWith('#') || /^(data|blob|about):/i.test(value);
}

/**
 * Split `html` into markup (script bodies blanked) and the script bodies.
 * @param {string} html
 */
function splitScripts(html) {
  const scripts = [];
  const markup = html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (_m, open, body, close) => {
    scripts.push(body);
    return `${open}${close}`;
  });
  return { markup, scripts };
}

/**
 * Every external reference in `html`: src=/href=/url()/import() targets in
 * markup that are not data:/blob:/fragment, and literal dynamic imports in
 * script bodies.
 * @param {string} html
 * @returns {string[]}
 */
export function externalReferences(html) {
  const { markup, scripts } = splitScripts(html);
  const found = [];
  const markupPatterns = [
    /\b(?:src|href)\s*=\s*"([^"]*)"/gi,
    /\b(?:src|href)\s*=\s*'([^']*)'/gi,
    /\b(?:src|href)\s*=\s*([^\s"'>]+)/gi,
    /url\(\s*["']?([^"')]*)["']?\s*\)/gi,
    /@import\s+["']([^"']*)["']/gi,
  ];
  for (const pattern of markupPatterns) {
    for (const match of markup.matchAll(pattern)) {
      if (!isInlineTarget(match[1])) found.push(match[0]);
    }
  }
  for (const body of scripts) {
    for (const match of body.matchAll(/\bimport\s*\(\s*(["'`])([^"'`]*)\1\s*\)/g)) {
      if (DOCUMENTATION_IMPORT_TEXTS.has(match[0]) || isInlineTarget(match[2])) continue;
      found.push(match[0]);
    }
    for (const match of body.matchAll(/\bimportScripts\s*\(/g)) found.push(match[0]);
  }
  return found;
}

/**
 * Parse the CSP meta tag, or `null` when there is none.
 * @param {string} html
 * @returns {Map<string, string[]> | null}
 */
export function contentSecurityPolicy(html) {
  const { markup } = splitScripts(html);
  const match = markup.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
  if (!match) return null;
  return new Map(
    match[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...values] = d.split(/\s+/);
      return [name.toLowerCase(), values];
    }),
  );
}

/**
 * Problems with the page's CSP: missing, a required directive with other
 * values, or any directive allowing a network source.
 * @param {string} html
 * @returns {string[]}
 */
export function cspProblems(html) {
  const csp = contentSecurityPolicy(html);
  if (!csp) return ['no Content-Security-Policy meta tag'];
  const problems = [];
  for (const [name, expected] of Object.entries(REQUIRED_CSP)) {
    const actual = csp.get(name);
    if (!actual || actual.join(' ') !== expected.join(' ')) {
      problems.push(`CSP ${name} is ${actual ? actual.join(' ') : 'missing'}, expected ${expected.join(' ')}`);
    }
  }
  for (const [name, values] of csp) {
    for (const value of values) {
      if (/^(https?:|wss?:|\*|'self'|\/\/)/i.test(value) || /^[a-z0-9.-]+\.[a-z]{2,}/i.test(value)) {
        problems.push(`CSP ${name} allows a network source: ${value}`);
      }
    }
  }
  return problems;
}

/** @param {string} html */
export function countPlaceholders(html) {
  return html.split(DATA_PLACEHOLDER).length - 1;
}
