// Shared parsing for the Skopo tools: statements as the Skopo Specification 0.1.0 defines them (§5).
//
// A statement is one Markdown element that ends with an anchor `^K-xxxxxx`:
//   a paragraph, a list item, a block quote, or a table row whose first cell is its ID.
// A paragraph that holds only an anchor, right after a list or table, makes the whole element one
// statement. Parentheses after an anchor hold links: the IDs an example checks, the IDs a form or
// design decision serves, or "refines …" for a rule. Elements without an anchor are connective text.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

export const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lowercase
export const KINDS = 'TAWREFD'; // F: form decision, in product bindings; D: design decision, in tech bindings
const ID_BODY = '[0-9a-hjkmnp-tv-z]{6}';
const ID_RE = `[${KINDS}]-${ID_BODY}(?![0-9a-z])`;
export const REF = new RegExp(`(?<![\\w^])([${KINDS}])-(${ID_BODY})(?![0-9a-z])`, 'g');
export const LOOSE_ANCHOR = /\^[A-Za-z]-[\w-]+/g;
const TRAILING = new RegExp(`^([\\s\\S]*?)((?:\\s*\\^${ID_RE})+)\\s*(?:\\(([^)]*)\\))?\\s*$`);

// The skopository a command acts on: always given, never guessed, so no command writes where it was
// not asked to.
export const rootOf = (args, usage) => {
  const root = args.find((a) => !a.startsWith('-'));
  if (!root || args.includes('--help') || args.includes('-h')) {
    console.error(`usage: ${usage}`);
    process.exit(root ? 0 : 2);
  }
  return root;
};
export const rel = (root, f) => relative(root, f);
export const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
export const normalize = (s) => s.replace(/\s+/g, ' ').trim();
export const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
export const refsIn = (s) => [...s.matchAll(REF)].map((m) => ({ kind: m[1], key: m[2], id: `${m[1]}-${m[2]}` }));
// Text inside a code span is quoted, not used (§5.6): it carries no force and cites nothing.
export const prose = (s) => s.replace(/`[^`\n]*`/g, ' ');

export function mdFiles(root, dir) {
  const base = join(root, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base).sort().flatMap((f) => {
    const p = join(base, f);
    if (statSync(p).isDirectory()) return mdFiles(root, join(dir, f));
    return f.endsWith('.md') ? [p] : [];
  });
}

// The languages are the skopo's own (§6.1): a language its keywords.json lacks has no entry, even if
// these tools ship one. Within an entry, a member the skopo lacks comes from the shipped dictionary,
// so a skopo written before a member existed still gets the newer checks.
export function loadKeywords(root) {
  const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
  const shipped = read(join(import.meta.dirname, 'keywords.json'));
  const own = existsSync(join(root, 'keywords.json')) ? read(join(root, 'keywords.json')) : read(join(root, 'tools', 'keywords.json'));
  const all = Object.fromEntries(Object.keys(own)
    .filter((lang) => !lang.startsWith('_'))
    .map((lang) => [lang, { ...shipped[lang], ...own[lang] }]));
  return (lang) => {
    const k = all[lang];
    if (!k) throw new Error(`no keywords for language "${lang}"`);
    const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const words = [...k.prohibition, ...k.requirement, ...k.permission].sort((a, b) => b.length - a.length);
    const alt = words.map(esc).join('|');
    return {
      lang,
      classOf: Object.fromEntries(['prohibition', 'requirement', 'permission'].flatMap((c) => k[c].map((w) => [w, c]))),
      // The keywords in the order a hint names them: requirement, prohibition, permission.
      keywords: [...k.requirement, ...k.prohibition, ...k.permission],
      formConditions: k.formCondition ?? [],
      bold: new RegExp(`\\*\\*(${alt})\\*\\*`, 'g'),
      plain: k.warnUnbolded ? new RegExp(`(?<!\\*\\*)\\b(${alt})\\b(?!\\*\\*)`, 'g') : null,
      // A form condition is bold too (**Where** …), so an ordinary "Where" is never mistaken for one.
      where: k.formCondition?.length ? new RegExp(`^\\*\\*(${k.formCondition.map(esc).join('|')})\\*\\*`) : null,
      // Words that carry force without a keyword. Where words have word boundaries, match whole words.
      hidden: k.hiddenForce?.length
        ? new RegExp(k.warnUnbolded ? `\\b(${[...k.hiddenForce].sort((a, b) => b.length - a.length).map(esc).join('|')})\\b` : `(${k.hiddenForce.map(esc).join('|')})`, 'i')
        : null,
    };
  };
}

function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  const lang = m?.[1].match(/^language:\s*(\S+)/m)?.[1] ?? 'en';
  return { lang, body: m ? text.slice(m[0].length) : text, offset: m ? m[0].split('\n').length - 1 : 0 };
}

// Markdown elements: heading, table, quote, list (with items), paragraph.
function elements(body, offset) {
  const lines = body.split('\n').map((text, i) => ({ text, lineNo: i + 1 + offset }));
  const out = [];
  const isItem = (t) => /^\s*([-*]|\d+\.)\s+/.test(t);
  const typeOf = (t) => (t.startsWith('#') ? 'heading' : /^\s*\|/.test(t) ? 'table' : /^\s*>/.test(t) ? 'quote' : isItem(t) ? 'list' : 'paragraph');
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].text;
    if (!t.trim()) { i += 1; continue; }
    const type = typeOf(t);
    const el = { type, lines: [lines[i]] };
    i += 1;
    if (type !== 'heading') {
      while (i < lines.length && lines[i].text.trim()) {
        const nt = typeOf(lines[i].text);
        const continues = type === 'paragraph' ? nt === 'paragraph'
          : type === 'list' ? (nt === 'list' || nt === 'paragraph')
          : nt === type;
        if (!continues) break;
        el.lines.push(lines[i]);
        i += 1;
      }
    }
    if (type === 'list') {
      el.items = [];
      for (const l of el.lines) {
        if (isItem(l.text)) el.items.push({ lines: [l] });
        else el.items.at(-1).lines.push(l);
      }
    }
    out.push(el);
  }
  return out;
}

const textOf = (ls) => normalize(ls.map((l) => l.text.replace(/^\s*(>|[-*](?=\s)|\d+\.(?=\s))\s*/, '')).join(' '));

export function parseFile(root, file, compileKw) {
  const raw = readFileSync(file, 'utf8');
  const { lang, body, offset } = frontMatter(raw);
  const kw = compileKw(lang);
  const els = elements(body, offset);
  const statements = [];
  const connective = [];
  const problems = [];
  const where = (l) => `${rel(root, file)}:${l.lineNo}`;

  const anchored = (text) => {
    const m = text.match(TRAILING);
    if (!m) return null;
    const ids = [...m[2].matchAll(new RegExp(`\\^([${KINDS}])-(${ID_BODY})`, 'g'))].map((x) => ({ kind: x[1], key: x[2], id: `${x[1]}-${x[2]}` }));
    const links = m[3] ?? '';
    return { text: normalize(m[1]), ids, links };
  };
  const push = (ids, t, links, l, extra = {}) => {
    if (ids.length > 1) problems.push({ where: where(l), msg: `an element ends with ${ids.length} anchors; one statement, one anchor` });
    for (const ref of ids) {
      const isE = ref.kind === 'E';
      const isDecision = ref.kind === 'D' || ref.kind === 'F';
      const refines = !isE && !isDecision && /^\s*refines\b/.test(links) ? refsIn(links) : [];
      statements.push({ file, where: where(l), kind: ref.kind, key: ref.key, id: ref.id, text: t, lang, links: links.trim(), checks: isE ? refsIn(links) : null, serves: isDecision ? refsIn(links) : null, refines, ...extra });
    }
  };
  const strayAnchor = (t, l) => { if (new RegExp(`\\^${ID_RE}`).test(prose(t))) problems.push({ where: where(l), msg: 'an anchor must end its element' }); };

  // Constructs a statement file may not hold (§5.1): their content would be misread as statements.
  const EXCLUDED = [
    [/^\s*(```|~~~)/, 'a fenced code block'],
    [/^\s{0,3}<(?:[A-Za-z][\w-]*|!--|\/)/, 'an HTML block'],
    [/^\s{0,3}\[\^[^\]]+\]:/, 'a footnote definition'],
    [/^\s{0,3}\[[^\]^][^\]]*\]:\s*\S/, 'a link reference definition'],
  ];
  body.split('\n').forEach((line, i) => {
    const hit = EXCLUDED.find(([re]) => re.test(line));
    if (hit) problems.push({ where: `${rel(root, file)}:${i + 1 + offset}`, msg: `${hit[1]} cannot appear in a statement file` });
  });

  // A paragraph that holds only an anchor makes the element before it one statement.
  const wrapsPrevious = (el) => el?.type === 'paragraph' && anchored(textOf(el.lines))?.text === '';
  els.forEach((el, k) => {
    // A heading is connective text (§5.7): it holds no force.
    if (el.type === 'heading') { connective.push({ file, lineNo: el.lines[0].lineNo, text: el.lines[0].text.replace(/^#+\s*/, ''), lang }); return; }
    if (el.type === 'table') {
      const prev = els[k - 1];
      const stem = prev?.type === 'paragraph' && !anchored(textOf(prev.lines)) ? textOf(prev.lines) : '';
      let rows = 0;
      for (const l of el.lines) {
        const head = refsIn(cells(l.text)[0]);
        // A row's text is its stem and the cells after the ID (§5.6), so re-aligning columns changes
        // nothing; `stem` lets checks read the stem once per table.
        const rowText = cells(l.text).slice(1).map(normalize).join(' | ');
        if (head.length === 1) { push(head, normalize(`${stem} ${rowText}`), '', l, { stem }); rows += 1; }
      }
      if (rows && !/[:：]\s*$/.test(stem)) problems.push({ where: where(el.lines[0]), msg: 'a table of statements needs a stem ending with ":" (or "：") right above it' });
      if (!rows && !wrapsPrevious(els[k + 1])) connective.push({ file, lineNo: el.lines[0].lineNo, text: textOf(el.lines), lang });
      return;
    }
    // A paragraph holding only anchors makes the element before it one statement.
    const own = anchored(textOf(el.lines));
    if (el.type === 'paragraph' && own && !own.text) {
      const prev = els[k - 1];
      if (!prev || prev.type === 'heading' || prev.type === 'paragraph') { problems.push({ where: where(el.lines[0]), msg: 'a lone anchor must follow a list, table or quote' }); return; }
      const inner = (prev.items ?? [prev]).some((it) => anchored(textOf(it.lines)));
      if (inner) problems.push({ where: where(el.lines[0]), msg: 'a whole-element anchor cannot wrap items that have their own anchors' });
      push(own.ids, textOf(prev.lines), own.links, el.lines[0]);
      return;
    }
    const next = els[k + 1];
    const wrapped = wrapsPrevious(next);
    const units = el.type === 'list' ? el.items : [el];
    for (const u of units) {
      const t = textOf(u.lines);
      const a = anchored(t);
      if (a && a.text) { push(a.ids, a.text, a.links, u.lines.at(-1)); continue; }
      strayAnchor(t, u.lines[0]);
      if (!wrapped) {
        // A table stem is part of every row's statement (§5.3), not connective text.
        const isStem = el.type === 'paragraph' && /[:：]\s*$/.test(t) && next?.type === 'table';
        if (!isStem) connective.push({ file, lineNo: u.lines[0].lineNo, text: t, lang });
      }
    }
  });
  return { lang, kw, statements, connective, problems, raw };
}

export function loadDir(root, dir) {
  const compileKw = loadKeywords(root);
  const files = mdFiles(root, dir).map((f) => ({ file: f, ...parseFile(root, f, compileKw) }));
  return {
    files,
    statements: files.flatMap((f) => f.statements),
    connective: files.flatMap((f) => f.connective),
    problems: files.flatMap((f) => f.problems),
  };
}
// The locked surface: the spec, form decisions in product bindings, design decisions in tech bindings.
export const loadSpec = (root) => loadDir(root, 'spec');
export const loadProduct = (root) => loadDir(root, join('bindings', 'product'));
export const loadTech = (root) => loadDir(root, join('bindings', 'tech'));
export const lockedStatements = (root) => [...loadSpec(root).statements, ...loadProduct(root).statements, ...loadTech(root).statements];

export function loadRecords(root) {
  return mdFiles(root, 'rationale').map((f) => {
    const text = readFileSync(f, 'utf8');
    const field = (k) => text.match(new RegExp(`^\\|\\s*${k}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, 'm'))?.[1] ?? '';
    const ids = (k) => refsIn(field(k));
    return {
      file: f,
      name: f.split('/').at(-1),
      title: text.match(/^#\s+(.+)$/m)?.[1] ?? f,
      grade: field('Grade'),
      origin: field('Origin'),
      touches: ids('Touches'),
      rewords: ids('Rewords'),
      retires: ids('Retires'),
      text,
    };
  });
}

export const LOCK = 'spec.lock.json';
export function loadLock(root) {
  const p = join(root, LOCK);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
// Translated views: views/<lang>/**.md
export function translationDirs(root) {
  const v = join(root, 'views');
  return existsSync(v) ? readdirSync(v, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join('views', d.name)) : [];
}
