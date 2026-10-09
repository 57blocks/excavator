#!/usr/bin/env node
/**
 * read-coverage.mjs
 *
 * Estimates how much of a repository a Claude Code session actually read,
 * from the session's `stream-json` events (`run.jsonl`, subagents included).
 * Deterministic and offline: it never calls a model or the network.
 *
 * Two bounds, both as unique (file, line) pairs over tracked files:
 *   lower — lines certainly shown to the model: Read tool output lines,
 *           `read_evidence` ranges, `sed -n A,Bp FILE` and `cat FILE` without
 *           a pipe, and `path:line:` hits in command output;
 *   upper — lower, plus ranges read through a pipe (`sed -n A,Bp FILE | ...`,
 *           `cat -n FILE | sed -n A,Bp`), whole files printed by
 *           `awk '...NR...' FILE`, and `read_evidence` calls without an end line
 *           (counted as 200 lines).
 * Reads done any other way (shell loops, scripts) are not counted, so even the
 * upper bound can undercount.
 *
 * Usage:
 *   node read-coverage.mjs --run <run.jsonl> --repo <path>
 *     [--alias <repo path as seen in the run>]... [--scope <path prefix>]...
 * Prints one JSON object. `--alias /work/repo` is always applied.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ALIASES = ['/work/repo'];
const READ_EVIDENCE_DEFAULT_SPAN = 200;

/** Parse newline-delimited JSON, skipping lines that are not JSON objects. */
export function parseRunEvents(rawText) {
  const events = [];
  for (const line of String(rawText ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event && typeof event === 'object') events.push(event);
    } catch {
      // not an event line
    }
  }
  return events;
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('\n');
  }
  return '';
}

function stripQuotes(value) {
  return String(value).trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Compute read coverage.
 * @param {object} args
 * @param {object[]} args.events parsed stream-json events
 * @param {Map<string, number>} args.files tracked repo-relative path -> line count
 * @param {string[]} [args.aliases] absolute repo roots as they appear in the run
 * @param {string[]} [args.scopePrefixes] repo-relative path prefixes; empty = whole repo
 */
export function computeReadCoverage({ events, files, aliases = [], scopePrefixes = [] }) {
  const roots = [...new Set([...DEFAULT_ALIASES, ...aliases])]
    .map((root) => root.replace(/\/+$/, ''))
    .filter(Boolean);
  const byBase = new Map();
  for (const path of files.keys()) {
    const base = basename(path);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(path);
  }

  /** Repo-relative form of a path, '' for the root, or null if outside the repo. */
  function relativeToRepo(raw) {
    const path = stripQuotes(raw);
    for (const root of roots) {
      if (path === root) return '';
      if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
    }
    return path.startsWith('/') ? null : path;
  }

  function resolveFile(raw, cwd = '') {
    const rel = relativeToRepo(raw);
    if (rel === null || rel === '') return null;
    if (cwd === null && !stripQuotes(raw).startsWith('/')) return null;
    const candidates = cwd ? [posix.normalize(posix.join(cwd, rel)), posix.normalize(rel)] : [posix.normalize(rel)];
    for (const candidate of candidates) {
      const clean = candidate.replace(/^\.\//, '');
      if (files.has(clean)) return clean;
    }
    const suffix = posix.normalize(rel).replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
    const matches = (byBase.get(basename(suffix)) ?? []).filter((path) => path === suffix || path.endsWith(`/${suffix}`));
    return matches.length === 1 ? matches[0] : null;
  }

  const lower = new Map();
  const upper = new Map();
  const add = (target, file, from, to) => {
    const total = files.get(file) ?? 0;
    const start = Math.max(1, from);
    const end = Math.min(total, to);
    if (!(start <= end)) return;
    if (!target.has(file)) target.set(file, new Set());
    const set = target.get(file);
    for (let line = start; line <= end; line += 1) set.add(line);
  };
  const addBoth = (file, from, to) => { add(lower, file, from, to); add(upper, file, from, to); };

  const toolUses = new Map();
  for (const event of events) {
    const content = event?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use') {
        toolUses.set(block.id, { name: block.name, input: block.input ?? {} });
        continue;
      }
      if (block?.type !== 'tool_result') continue;
      const use = toolUses.get(block.tool_use_id);
      if (!use) continue;
      const output = toolResultText(block.content);

      if (use.name === 'Read') {
        const file = resolveFile(use.input.file_path ?? '');
        if (!file) continue;
        for (const match of output.matchAll(/^\s*(\d+)[\t→]/gm)) {
          const line = Number(match[1]);
          addBoth(file, line, line);
        }
      } else if (typeof use.name === 'string' && use.name.endsWith('read_evidence')) {
        const file = resolveFile(use.input.path ?? '');
        const start = Number(use.input.startLine);
        if (!file || !Number.isInteger(start)) continue;
        const end = Number(use.input.endLine);
        if (Number.isInteger(end)) {
          addBoth(file, start, end);
        } else {
          add(lower, file, start, start);
          add(upper, file, start, start + READ_EVIDENCE_DEFAULT_SPAN);
        }
      } else if (use.name === 'Bash') {
        let cwd = '';
        for (const segment of String(use.input.command ?? '').split(/&&|\|\||;|\n/)) {
          const cd = /^\s*cd\s+(\S+)\s*$/.exec(segment);
          if (cd) {
            const target = stripQuotes(cd[1]);
            const rel = relativeToRepo(target);
            if (rel === null) {
              cwd = null; // left the repository: relative paths no longer name repo files
            } else if (target.startsWith('/')) {
              cwd = posix.normalize(rel || '.').replace(/^\.$/, '');
            } else if (cwd !== null) {
              cwd = posix.normalize(posix.join(cwd, rel) || '.').replace(/^\.$/, '');
            }
            continue;
          }
          const piped = segment.includes('|');
          for (const match of segment.matchAll(/sed\s+-n\s+['"]?(\d+),(\d+)p['"]?\s+([^\s|;'"]+)/g)) {
            const file = resolveFile(match[3], cwd);
            if (!file) continue;
            add(upper, file, Number(match[1]), Number(match[2]));
            if (!piped) add(lower, file, Number(match[1]), Number(match[2]));
          }
          const catSed = /cat\s+-n\s+([^\s|;]+)\s*\|\s*sed\s+-n\s+['"]?(\d+),(\d+)p/.exec(segment);
          if (catSed) {
            const file = resolveFile(catSed[1], cwd);
            if (file) add(upper, file, Number(catSed[2]), Number(catSed[3]));
          }
          const whole = /^\s*(?:cat|nl)\s+(?:-n\s+)?([^\s|;<>]+)\s*$/.exec(segment);
          if (whole) {
            const file = resolveFile(whole[1], cwd);
            if (file) addBoth(file, 1, files.get(file));
          }
          const awk = /^\s*awk\s+'[^']*NR[^']*'\s+([^\s|;]+)/.exec(segment);
          if (awk) {
            const file = resolveFile(awk[1], cwd);
            if (file) add(upper, file, 1, files.get(file));
          }
        }
        for (const match of output.matchAll(/^([\w./-]+\.\w+):(\d+)[:-]/gm)) {
          const file = resolveFile(match[1], cwd);
          if (file) addBoth(file, Number(match[2]), Number(match[2]));
        }
      }
    }
  }

  const inScope = (path) => scopePrefixes.length === 0 || scopePrefixes.some((prefix) => path.startsWith(prefix));
  let scopeFiles = 0;
  let scopeLines = 0;
  for (const [path, count] of files) {
    if (inScope(path)) { scopeFiles += 1; scopeLines += count; }
  }
  const tally = (target) => {
    const result = { inScope: { files: 0, lines: 0 }, outsideScope: { files: 0, lines: 0 } };
    for (const [path, lines] of target) {
      const bucket = inScope(path) ? result.inScope : result.outsideScope;
      bucket.files += 1;
      bucket.lines += lines.size;
    }
    return result;
  };
  const lo = tally(lower);
  const hi = tally(upper);
  const pct = (lines) => (scopeLines > 0 ? Math.round((1000 * lines) / scopeLines) / 10 : null);
  return {
    scope: { prefixes: [...scopePrefixes], files: scopeFiles, lines: scopeLines },
    lower: { ...lo.inScope, percentOfScope: pct(lo.inScope.lines), outsideScope: lo.outsideScope },
    upper: { ...hi.inScope, percentOfScope: pct(hi.inScope.lines), outsideScope: hi.outsideScope },
  };
}

function countLines(text) {
  if (text.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) count += 1;
  return text.endsWith('\n') ? count : count + 1;
}

/**
 * Line counts for every tracked text file of a Git repository
 * (files with a NUL byte in their first 8 KB are treated as binary and skipped).
 */
export function trackedLineCounts(repoRoot, { spawnSyncFn = spawnSync, readFileSyncFn = readFileSync } = {}) {
  const listed = spawnSyncFn('git', ['-C', repoRoot, 'ls-files', '-z'], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });
  if (listed.status !== 0) throw new Error(`git ls-files failed in ${repoRoot}: ${listed.stderr ?? ''}`.trim());
  const files = new Map();
  for (const path of String(listed.stdout).split('\0')) {
    if (!path) continue;
    let text;
    try { text = readFileSyncFn(join(repoRoot, path), 'utf-8'); } catch { continue; }
    if (text.slice(0, 8192).includes('\0')) continue;
    files.set(path, countLines(text));
  }
  return files;
}

/** Read coverage of a run against a Git repository (impure: reads the repository). */
export function measureReadCoverage({ rawEvents, repoRoot, aliases = [], scopePrefixes = [] }) {
  const files = trackedLineCounts(repoRoot);
  const absoluteRoot = resolve(repoRoot);
  let realRoot = absoluteRoot;
  try { realRoot = realpathSync(absoluteRoot); } catch { /* keep the resolved path */ }
  return computeReadCoverage({
    events: parseRunEvents(rawEvents),
    files,
    aliases: [...aliases, absoluteRoot, realRoot],
    scopePrefixes,
  });
}

function parseArgs(argv) {
  const options = { run: null, repo: null, aliases: [], scopes: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--run') { options.run = value; i += 1; }
    else if (flag === '--repo') { options.repo = value; i += 1; }
    else if (flag === '--alias') { options.aliases.push(value); i += 1; }
    else if (flag === '--scope') { options.scopes.push(value); i += 1; }
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!options.run || !options.repo) {
    throw new Error('Usage: node read-coverage.mjs --run <run.jsonl> --repo <path> [--alias <path>]... [--scope <prefix>]...');
  }
  return options;
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const coverage = measureReadCoverage({
      rawEvents: readFileSync(options.run, 'utf-8'),
      repoRoot: options.repo,
      aliases: options.aliases,
      scopePrefixes: options.scopes,
    });
    process.stdout.write(`${JSON.stringify(coverage, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`read-coverage.mjs failed: ${err.message}\n`);
    process.exitCode = 1;
  }
}
