#!/usr/bin/env node
// Replaces placeholder IDs with new random ones. While writing, give each statement a readable
// placeholder such as `^R-@fresh-wasm` and cite it the same way, `(R-@fresh-wasm)`; this script
// gives each placeholder one new ID and rewrites every skopo file that uses it. A placeholder is its
// kind and its label together, so `T-@loan-limit` and `R-@loan-limit` are two statements.
//
// With --map, placeholders keep the IDs they got in earlier passes, so a later file may cite a
// statement by its placeholder after that statement already has an ID. With --also, files outside
// the skopo (the run's questions and notes) have their known placeholders rewritten too; there an
// unknown placeholder is left alone, since only the skopo defines statements. A placeholder inside a
// code span is quoted, not used (§5.1), and is left as it is.
// Usage: node assign-ids.mjs <skopository> [--map <file>] [--also <file>]…
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALPHABET, KINDS, mdFiles, loadLock, loadRecords, rootOf } from './spec.mjs';

const args = process.argv.slice(2);
const take = (flag) => {
  const found = [];
  for (let at = args.indexOf(flag); at >= 0; at = args.indexOf(flag)) found.push(args.splice(at, 2)[1]);
  return found;
};
const mapFile = take('--map')[0] ?? null;
const also = take('--also').filter((f) => existsSync(f));
const ROOT = resolve(rootOf(args, 'assign-ids.mjs <skopository> [--map <file>] [--also <file>]…'));

const PLACEHOLDER = new RegExp(`([${KINDS}])-@([a-z0-9][a-z0-9-]*)`, 'g');
const REAL = new RegExp(`[${KINDS}]-([0-9a-hjkmnp-tv-z]{6})(?![0-9a-z])`, 'g');
const files = ['spec', 'bindings', 'rationale', 'views'].flatMap((d) => mdFiles(ROOT, d));
// Placeholders and IDs in use, outside code spans.
const CODE_SPAN = /(`[^`\n]*`)/;
const outsideCode = (text) => text.split(CODE_SPAN).filter((_, i) => i % 2 === 0).join(' ');
const texts = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

const earlier = mapFile && existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, 'utf8')) : {};
const taken = new Set([
  ...[...texts.values()].flatMap((t) => [...t.matchAll(REAL)].map((m) => m[1])),
  ...Object.values(earlier).map((id) => id.slice(2)),
  ...Object.keys(loadLock(ROOT)?.statements ?? {}),
  ...loadRecords(ROOT).flatMap((r) => r.retires.map((x) => x.key)),
]);
const mint = () => {
  let key;
  do key = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  while (taken.has(key));
  taken.add(key);
  return key;
};

// Every placeholder in the skopo gets an ID: the one it had in an earlier pass, or a new one.
const idOf = new Map(Object.entries(earlier));
const used = new Set([...texts.values()].flatMap((t) => [...outsideCode(t).matchAll(PLACEHOLDER)].map((m) => m[0])));
let fresh = 0;
for (const placeholder of used) {
  if (idOf.has(placeholder)) continue;
  idOf.set(placeholder, `${placeholder[0]}-${mint()}`);
  fresh += 1;
}

const rewrite = (text) => text.split(CODE_SPAN).map((part, i) => (i % 2 ? part : part.replace(PLACEHOLDER, (p) => idOf.get(p) ?? p))).join('');
let rewritten = 0;
for (const [file, text] of [...texts, ...also.map((f) => [f, readFileSync(f, 'utf8')])]) {
  const next = rewrite(text);
  if (next !== text) { writeFileSync(file, next); rewritten += 1; }
}
if (mapFile) writeFileSync(mapFile, `${JSON.stringify(Object.fromEntries(idOf), null, 1)}\n`);
console.log(`${used.size} placeholders: ${fresh} new IDs, ${used.size - fresh} already assigned in earlier passes; ${rewritten} files rewritten${mapFile ? `; map in ${mapFile}` : ''}`);
