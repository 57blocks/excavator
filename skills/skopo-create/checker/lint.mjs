#!/usr/bin/env node
// Mechanical checker for a skopository: the L checks of the Skopo Specification 0.1.0, §12.1. Semantic
// findings (S1, S2) are added when a model's findings file is given.
// Usage: node lint.mjs <skopository> [--semantic <findings.json>]
// Each finding is one line: its severity, its check, the file and line, and what to do.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  rootOf, mdFiles, rel, sha, refsIn, loadSpec, loadProduct, loadTech, loadDir, loadRecords, loadLock,
  translationDirs, LOOSE_ANCHOR, KINDS, normalize, loadKeywords, prose,
} from './spec.mjs';

const ARGS = process.argv.slice(2);
const SEMANTIC = ARGS.includes('--semantic') ? ARGS[ARGS.indexOf('--semantic') + 1] : null;
const ROOT = rootOf(ARGS.filter((a) => a !== SEMANTIC), 'lint.mjs <skopository> [--semantic <findings.json>]');
const MAX_FORCES = 3; // keywords in one statement before we suggest splitting it into items
const FORM_WORDS = [
  'screen', 'page', 'button', 'click', 'checkbox', 'dropdown', 'popup', 'tooltip', 'form field',
  'endpoint', 'api', 'database', 'cron', 'server', 'url', 'json', 'login',
  'email', 'e-mail', 'slack', 'sms', 'push notification', 'app', 'mobile', 'web', 'ui', 'dashboard',
  'phone', 'message',
];
const FORM_WORD_RE = new RegExp(`\\b(${FORM_WORDS.map((w) => w.replace('-', '\\-')).join('|')})\\b`, 'i');
// A file name, a colon and a line number: the citation goes stale with the first edit above it.
const LINE_CITATION = /\b[\w./-]+\.[a-z][a-z0-9]{0,5}:\d+\b/;
// Code a layer must not name: a path to a source or infrastructure file, or a file:symbol citation.
// A bare file name ("build.rs", "Node.js") is a word of the world, not a location in this code.
const CODE_EXT = 'ts|tsx|js|mjs|cjs|go|rs|py|java|kt|rb|swift|tf|hcl|prisma|sql|sh';
const CODE_LOCATION = new RegExp(`[\\w.<>-]+(/[\\w.<>-]+)+\\.(${CODE_EXT})\\b|\\b[\\w.-]+\\.(${CODE_EXT}):[A-Za-z_]\\w*`);
const STATUS_FIELD = /^\s*\**status\**\s*:/im;

const errors = [];
const warnings = [];
const err = (code, where, msg) => errors.push(`error ${code} ${where}  ${msg}`);
const warn = (code, where, msg) => warnings.push(`warning ${code} ${where}  ${msg}`);
// A checker may stop after errors that would make every later finding noise (§1.3), and says so.
const stop = (why) => {
  errors.slice(0, 20).forEach((l) => console.log(l));
  if (errors.length > 20) console.log(`… and ${errors.length - 20} more`);
  console.log(`${why}; nothing else was checked.`);
  console.log(`${errors.length} errors · 0 warnings`);
  process.exit(1);
};

// Placeholders (R-@label) mean assign-ids has not run since the last edit.
const PLACEHOLDER = new RegExp(`[${KINDS}]-@[a-z0-9][a-z0-9-]*`, 'g');
for (const f of ['spec', 'bindings', 'rationale', 'views'].flatMap((d) => mdFiles(ROOT, d))) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    for (const m of prose(line).matchAll(PLACEHOLDER)) err('L1', `${rel(ROOT, f)}:${i + 1}`, `placeholder ${m[0]} has no ID yet`);
  });
}
if (errors.length) stop('Placeholders remain: run assign-ids first');

// --- L0: the manifest, the dictionary and the README (§4, §14.3) ---------------------------
export const SPEC_VERSION = '0.1.0';
const accepts = (declared) => {
  const [ma, mi] = SPEC_VERSION.split('.').map(Number);
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(declared ?? '');
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return ma === 0 ? x === 0 && y === mi : x === ma && y <= mi;
};
let manifest = null;
try { manifest = JSON.parse(readFileSync(join(ROOT, 'skopo.json'), 'utf8')); } catch { manifest = null; }
if (!manifest) err('L0', 'skopo.json', `missing or not JSON; it declares the specification version, e.g. {"specVersion": "${SPEC_VERSION}"}`);
else if (!accepts(manifest.specVersion)) err('L0', 'skopo.json', `specVersion "${manifest.specVersion}" is not one this checker accepts (it implements ${SPEC_VERSION})`);
for (const f of ['keywords.json', 'README.md']) if (!existsSync(join(ROOT, f))) err('L0', f, 'missing');
const languages = new Set(['spec', 'bindings', 'views'].flatMap((d) => mdFiles(ROOT, d))
  .map((f) => readFileSync(f, 'utf8').match(/^---\n([\s\S]*?)\n---\n/)?.[1].match(/^language:\s*(\S+)/m)?.[1] ?? 'en'));
const dictionary = loadKeywords(ROOT);
const unknown = [...languages].filter((lang) => { try { dictionary(lang); return false; } catch { return true; } });
for (const lang of unknown) err('L0', 'keywords.json', `no entry for language "${lang}"`);
// Without a dictionary entry the files cannot be read at all.
if (unknown.length) stop('A language has no dictionary entry');

const spec = loadSpec(ROOT);
const product = loadProduct(ROOT);
const tech = loadTech(ROOT);
const records = loadRecords(ROOT);
const retired = new Map(records.flatMap((r) => r.retires.map((x) => [x.key, r.name])));
const surfaces = [spec, product, tech];

// --- L1: anchors well formed, at the end of their element, unique, never reused ------
const anchorShape = new RegExp(`^\\^[${KINDS}]-[0-9a-hjkmnp-tv-z]{6}$`);
for (const f of surfaces.flatMap((s) => s.files)) {
  for (const m of prose(f.raw).matchAll(LOOSE_ANCHOR)) if (!anchorShape.test(m[0])) err('L1', rel(ROOT, f.file), `malformed anchor "${m[0]}"`);
}
for (const p of surfaces.flatMap((s) => s.problems)) err('L1', p.where, p.msg);
const defs = new Map();
// Each binding holds one kind of decision, and nothing else.
const HOMES = [['F', '/bindings/product/', 'form decisions (F)'], ['D', '/bindings/tech/', 'design decisions (D)']];
for (const s of surfaces.flatMap((x) => x.statements)) {
  if (defs.has(s.key)) err('L1', s.where, `${s.id} is defined twice (also ${defs.get(s.key).where})`);
  if (retired.has(s.key)) err('L1', s.where, `${s.id} reuses a retired ID (retired in ${retired.get(s.key)})`);
  for (const [kind, home, name] of HOMES) {
    if (s.kind === kind && !s.file.includes(home)) err('L1', s.where, `${s.id}: ${name} live in ${home.slice(1)}`);
    if (s.kind !== kind && s.file.includes(home)) err('L1', s.where, `${s.id}: only ${name} live in ${home.slice(1)}`);
  }
  defs.set(s.key, s);
}
const ofKind = (k) => [...defs.values()].filter((s) => s.kind === k);

// --- L2: every reference resolves, with the kind it has now ---------------------------
const citing = ['spec', 'bindings', 'rationale', 'views'].flatMap((d) => mdFiles(ROOT, d));
for (const file of citing) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const retiresRow = /^\|\s*Retires\s*\|/.test(line);
    for (const r of refsIn(prose(line))) {
      const d = defs.get(r.key);
      if (!d && !(retiresRow || (retired.has(r.key) && file.includes('/rationale/')))) err('L2', `${rel(ROOT, file)}:${i + 1}`, `${r.id} is cited but not defined`);
      else if (d && d.kind !== r.kind) err('L2', `${rel(ROOT, file)}:${i + 1}`, `${r.id} is now ${d.id}: its kind changed; update the reference`);
    }
  });
}
// Links (§5.5): none on terms, acts and assumptions; a rule's links are a refinement.
for (const s of defs.values()) {
  if ('TAW'.includes(s.kind) && s.links) err('L2', s.where, `${s.id} carries links "(${s.links})"; terms, acts and assumptions link to nothing`);
  if (s.kind === 'R' && s.links && !/^refines\b/.test(s.links)) err('L2', s.where, `${s.id}: a rule's links begin with "refines"`);
}
// Refinement: a rule refines rules only.
const refinedBy = new Map();
for (const s of defs.values()) {
  for (const r of s.refines ?? []) {
    if (s.kind !== 'R' || r.kind !== 'R') err('L2', s.where, `${s.id} refines ${r.id}: only rules refine rules`);
    refinedBy.set(r.key, [...(refinedBy.get(r.key) ?? []), s.id]);
  }
}

// --- L3: leaks of form into the spec are declared and counted ---------------------------
// Names the bold form condition of the statement's own language: "**Where** …".
const whereHint = (kw) => (kw.formConditions.length ? `**${kw.formConditions[0]}** …` : 'a form condition');
const leakStats = [];
const kwOf = new Map(surfaces.flatMap((s) => s.files).map((f) => [f.lang, f.kw]));
const formConditional = new Set(spec.statements.filter((s) => kwOf.get(s.lang).where?.test(prose(s.text))).map((s) => s.key));
for (const f of spec.files) {
  let declared = 0;
  let undeclared = 0;
  for (const s of f.statements) {
    // An example that checks only form-conditional rules may name the form it is about.
    const isWhere = formConditional.has(s.key) || (s.kind === 'E' && s.checks?.length && s.checks.every((c) => formConditional.has(c.key)));
    if (isWhere) { declared += 1; continue; }
    const m = prose(s.text).match(FORM_WORD_RE);
    if (m) { undeclared += 1; warn('L3', s.where, `${s.id} may leak form ("${m[1]}"); if it holds only for some forms, open it with ${whereHint(kwOf.get(s.lang))}, or move it to a binding`); }
  }
  if (declared || undeclared) leakStats.push(`${rel(ROOT, f.file)} (${declared} declared, ${undeclared} undeclared)`);
}

// --- L4: examples are counted, not required: write one where a rule could be misread --------
const checked = new Set(ofKind('E').flatMap((e) => (e.checks ?? []).map((c) => c.key)));
const unexampled = ofKind('R').filter((r) => !checked.has(r.key) && !refinedBy.has(r.key)).length;

// --- L5: references point up, never down, and no layer names code --------------------------
// spec ← product binding ← tech binding ← code. A layer cites only its own layer and the ones above
// it; code may cite the skopo, never the reverse, so a refactor never touches a skopo file. Which
// code realizes a statement is a view, built when someone asks.
// A translation mirrors the files it translates, so it is held to the direction of its source's layer.
const LAYERS = [['spec', 'TAWRE'], [join('bindings', 'product'), 'TAWREF'], [join('bindings', 'tech'), 'TAWREFD']];
const layerOf = (file) => LAYERS.find(([dir]) => rel(ROOT, file).replace(/^views\/[^/]+\//, '').startsWith(`${dir}/`));
for (const file of ['spec', 'bindings', 'views'].flatMap((d) => mdFiles(ROOT, d))) {
  const [dir, allowed] = layerOf(file) ?? [];
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const at = `${rel(ROOT, file)}:${i + 1}`;
    for (const r of allowed ? refsIn(prose(line)) : []) if (!allowed.includes(r.kind)) err('L5', at, `${r.id} is in a lower layer; ${dir} cannot cite it`);
    // Quoting a path is still naming it: code spans are not exempt here.
    const code = line.match(CODE_LOCATION);
    if (code) err('L5', at, `names code ("${code[0]}"); state the decision, and let the code cite the skopo`);
  });
}
for (const dir of [join('bindings', 'product'), join('bindings', 'tech')]) {
  const base = join(ROOT, dir);
  if (!existsSync(base)) continue;
  for (const d of readdirSync(base, { withFileTypes: true })) if (d.isDirectory()) err('L5', `${dir}/${d.name}`, 'binding directories hold files only, one per product');
}
const bindingStats = [];
for (const file of mdFiles(ROOT, join('bindings', 'tech'))) {
  const name = basename(file, '.md');
  if (!mdFiles(ROOT, join('bindings', 'product')).some((p) => basename(p, '.md') === name)) err('L5', rel(ROOT, file), `no product binding bindings/product/${name}.md`);
  const ds = tech.statements.filter((s) => s.file === file);
  const served = new Set(ds.flatMap((d) => (d.serves ?? []).map((r) => r.key)));
  bindingStats.push(`${rel(ROOT, file)}: ${ds.length} design decisions · serving ${served.size} statements`);
}

// L6 is unused: earlier drafts required a change record for every rule; provenance is optional.

// --- L7: no status fields, no line citations ----------------------------------------------
const statementFiles = ['spec', 'bindings', 'views'].flatMap((d) => mdFiles(ROOT, d));
for (const file of statementFiles) if (STATUS_FIELD.test(readFileSync(file, 'utf8'))) err('L7', rel(ROOT, file), 'status field in a statement file');
for (const file of citing) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const m = line.match(LINE_CITATION);
    if (m) err('L7', `${rel(ROOT, file)}:${i + 1}`, `line citation "${m[0]}"; drop the line number`);
  });
}

// --- L8 and L9: normative keywords -------------------------------------------------------
for (const c of surfaces.flatMap((x) => x.connective)) {
  const m = prose(c.text).match(kwOf.get(c.lang).bold);
  if (m) err('L8', `${rel(ROOT, c.file)}:${c.lineNo}`, `normative ${m[0]} in text with no ID`);
}
// Names the bold keywords of the statement's own language: "**must**, **must not** or **may**".
const keywordHint = (kw) => {
  const words = kw.keywords.map((w) => `**${w}**`);
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words.at(-1)}` : words.join('');
};
let behavioral = 0;
for (const s of defs.values()) {
  const kw = kwOf.get(s.lang);
  const bold = prose(s.text).match(kw.bold) ?? [];
  if ('TAWE'.includes(s.kind)) {
    if (bold.length) err('L9', s.where, `${s.id} is not a rule but carries ${bold.join(', ')}`);
    continue;
  }
  if (s.kind === 'R' && bold.length) behavioral += 1;
  // A table row is its stem plus its cells: the row's own words are checked here, the stem once below.
  const own = prose(s.stem ? s.text.slice(normalize(s.stem).length) : s.text);
  // A rule with no keyword is a definition. One that says "cannot", "is refused" or "never" is an
  // obligation in disguise: it loses its force in translation and in every check that reads keywords.
  const hidden = s.kind === 'R' && !bold.length && kw.hidden ? own.match(kw.hidden) : null;
  if (hidden) warn('L9', s.where, `${s.id} states force with "${hidden[0]}" but carries no keyword; write ${keywordHint(kw)}, or rephrase it as a definition`);
  if (bold.length > MAX_FORCES) warn('L9', s.where, `${s.id} carries ${bold.length} normative keywords; consider a list with one anchor per item`);
  const plain = kw.plain ? own.replace(kw.bold, '').match(kw.plain) : null;
  if (plain) warn('L9', s.where, `${s.id} has plain "${plain[0]}"; bold it if it is normative`);
}

// A table stem is shared by every row: check it once, at the table's first row.
const stemsSeen = new Set();
for (const s of defs.values()) {
  if (!s.stem || stemsSeen.has(`${s.file}\u0000${s.stem}`)) continue;
  stemsSeen.add(`${s.file}\u0000${s.stem}`);
  const kw = kwOf.get(s.lang);
  const plain = kw.plain ? prose(s.stem).replace(kw.bold, '').match(kw.plain) : null;
  if (plain) warn('L9', s.where, `table stem has plain "${plain[0]}"; bold it if it is normative`);
}

// --- L11: translations keep every anchor's kind and every rule's force ----------------------
const forceOf = (s) => {
  const kw = kwOf.get(s.lang);
  return [...prose(s.text).matchAll(kw.bold)].map((m) => kw.classOf[m[1]]).sort().join('+') || 'definitional';
};
const translationStats = [];
for (const dir of translationDirs(ROOT)) {
  const tr = loadDir(ROOT, dir);
  for (const f of tr.files) {
    kwOf.set(f.lang, f.kw);
    if (STATUS_FIELD.test(f.raw)) continue; // reported by L7
    const front = /^---\n([\s\S]*?)\n---\n/.exec(f.raw)?.[1] ?? '';
    if (!/^language:\s*\S+/m.test(front)) err('L11', rel(ROOT, f.file), 'a translation declares its language in front matter');
  }
  for (const p of tr.problems) err('L1', p.where, p.msg);
  for (const t of tr.statements) {
    const s = defs.get(t.key);
    if (!s) { err('L11', t.where, `${t.id} translates nothing: no statement in the spec or the bindings has it`); continue; }
    if (s.kind !== t.kind) err('L11', t.where, `${t.id} is ${s.id} in its source`);
    if ('RFD'.includes(s.kind) && forceOf(s) !== forceOf(t)) err('L11', t.where, `${t.id} is ${forceOf(t)} here but ${forceOf(s)} in its source`);
  }
  for (const c of tr.connective) {
    const m = prose(c.text).match(kwOf.get(c.lang).bold);
    if (m) err('L8', `${rel(ROOT, c.file)}:${c.lineNo}`, `normative ${m[0]} in text with no ID`);
  }
  translationStats.push(`${dir}: ${tr.statements.length} statements translated`);
}

// --- L10: the locked surface matches spec.lock.json, or every difference is declared ----------
const lock = loadLock(ROOT);
const lockStats = [];
if (!lock) {
  lockStats.push('lock: none yet (it is written when people accept the skopository)');
} else {
  const fresh = records.filter((r) => !lock.records.includes(r.name));
  const declared = (k) => new Set(fresh.flatMap((r) => r[k].map((x) => x.key)));
  const [dTouch, dReword, dRetire] = [declared('touches'), declared('rewords'), declared('retires')];
  const via = fresh.map((r) => r.name).join(', ') || 'no new change record';
  const n = { added: 0, changed: 0, reworded: 0, removed: 0 };
  for (const s of defs.values()) {
    const old = lock.statements[s.key];
    if (!old) {
      n.added += 1;
      if (!dTouch.has(s.key)) err('L10', s.where, `${s.id} is new but no new change record touches it`);
      continue;
    }
    if (old.kind !== s.kind && !dTouch.has(s.key)) err('L10', s.where, `${old.kind}-${s.key} became ${s.id}; a kind change must be touched by a change record`);
    if (old.sha === sha(s.text)) continue;
    if (dTouch.has(s.key)) n.changed += 1;
    else if (dReword.has(s.key)) n.reworded += 1;
    else err('L10', s.where, `${s.id} text changed since the lock; declare it in a change record (Touches or Rewords)`);
  }
  for (const [key, old] of Object.entries(lock.statements)) {
    if (defs.has(key)) continue;
    n.removed += 1;
    if (!dRetire.has(key)) err('L10', old.where, `${old.kind}-${key} was removed; declare it under Retires`);
  }
  for (const key of dTouch) {
    const old = lock.statements[key];
    const s = defs.get(key);
    if (!old || !s || old.sha === sha(s.text)) continue;
    const cites = [
      ...ofKind('E').filter((e) => e.checks?.some((c) => c.key === key)).map((e) => e.id),
      ...(refinedBy.get(key) ?? []),
      ...mdFiles(ROOT, 'bindings').filter((b) => readFileSync(b, 'utf8').includes(key) && b !== s.file).map((b) => rel(ROOT, b)),
    ];
    if (cites.length) warn('L10', s.where, `${s.id} changed meaning; re-check ${cites.join(', ')}`);
  }
  lockStats.push(`lock: ${n.added} added · ${n.changed} changed · ${n.reworded} reworded · ${n.removed} removed (via ${via})`);
}

// --- S1, S2: findings of the semantic layer, when a model has run it -------------------------
// The findings file lives outside the skopository: a checker ignores other files at its root (§4.1).
let semanticStats = 'semantic: not run';
if (SEMANTIC) {
  const findings = JSON.parse(readFileSync(SEMANTIC, 'utf8'));
  const whereOf = (id) => [...defs.values()].find((s) => s.id === id)?.where ?? id;
  for (const f of findings.filter((x) => x.verdict !== 'same')) warn(f.check, whereOf(f.id), `${f.id} ${f.verdict}: ${f.reason}`);
  semanticStats = `semantic: ${findings.length} pairs judged · ${findings.filter((x) => x.verdict !== 'same').length} findings`;
}

// --- Report -------------------------------------------------------------------------------
const c = (k) => ofKind(k).length;
console.log(`statements: ${c('T')} terms · ${c('A')} acts · ${c('R')} rules (${behavioral} behavioral · ${c('R') - behavioral} definitional · ${refinedBy.size} refined by others) · ${c('W')} assumptions · ${c('E')} examples · ${c('F')} form decisions · ${c('D')} design decisions`);
[`examples: ${c('E')} checking ${checked.size} rules · ${unexampled} rules without one`, ...bindingStats, ...translationStats, ...lockStats, `leaks: ${leakStats.join(' · ') || 'none'}`, semanticStats].forEach((s) => console.log(s));
[...errors, ...warnings].forEach((l) => console.log(l));
console.log(`${errors.length} errors · ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
