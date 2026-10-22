#!/usr/bin/env node
/**
 * privacy-scan.mjs — checks the text a pull request brings into the
 * repository against two name lists kept outside it (openspec change
 * ci-merge-gate, design D2-D5).
 *
 * Usage:
 *   node scripts/ci/privacy-scan.mjs <base> <head> <names-file> <corpus-file> [text-file...]
 *
 *   names-file   one name per line, matched as a fixed string ignoring case;
 *                forbidden everywhere except pnpm-lock.yaml
 *   corpus-file  one regular expression per line, ignoring case; forbidden
 *                outside openspec/, docs/ and the Markdown files at the root
 *   text-file    more text to check against both lists (the pull request's
 *                title and body)
 *
 * What it reads, for the commits in base..head:
 *   added lines      of every non-merge commit (history is public even when a
 *                    later commit removes the line), and of the whole range
 *                    from the merge base (what a merge commit adds when it
 *                    resolves a conflict)
 *   commit messages  of every commit, merges included
 *   paths            every commit changes
 *
 * Blank lines in a list are dropped: a blank pattern matches every line.
 * Prints how many lines match per list and source, never the text.
 * Exit code: 0 if nothing matches; 1 if something does; 2 if a list is
 * missing, empty or invalid, or git fails.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const NAMES_PATHS = ['.', ':(exclude)pnpm-lock.yaml'];
const CORPUS_PATHS = [...NAMES_PATHS, ':(exclude)openspec', ':(exclude)docs', ':(exclude,glob)*.md'];
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv'];

function fail(message) {
  process.stderr.write(`privacy-scan: ${message}\n`);
  process.exit(2);
}

function readLines(file, what) {
  let text;
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    fail(`${what} is unavailable: cannot read ${file}`);
  }
  return text.split(/\r?\n/);
}

function readList(file, what) {
  const lines = readLines(file, what).map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length === 0) fail(`${what} is unavailable: ${file} has no entries`);
  return lines;
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    fail(`git ${args[0]} failed: ${String(error.stderr ?? error.message).trim()}`);
  }
}

// The lines a patch adds. A file's header lines run from `diff --git` to its
// first hunk, so an added line whose own text starts with "++" still counts.
function added(patch) {
  const lines = [];
  let inHeader = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) inHeader = true;
    else if (line.startsWith('@@')) inHeader = false;
    else if (!inHeader && line.startsWith('+')) lines.push(line.slice(1));
  }
  return lines;
}

function addedLines(base, head, paths) {
  const perCommit = git(['log', '-p', '--no-merges', '--format=', ...DIFF_FLAGS, `${base}..${head}`, '--', ...paths]);
  const whole = git(['diff', ...DIFF_FLAGS, `${base}...${head}`, '--', ...paths]);
  return [...added(perCommit), ...added(whole)];
}

function changedPaths(base, head, paths) {
  const perCommit = git(['-c', 'core.quotePath=false', 'log', '--no-merges', '--name-only', '--format=', `${base}..${head}`, '--', ...paths]);
  const whole = git(['-c', 'core.quotePath=false', 'diff', '--name-only', `${base}...${head}`, '--', ...paths]);
  return `${perCommit}\n${whole}`.split('\n').filter((line) => line !== '');
}

const [base, head, namesFile, corpusFile, ...textFiles] = process.argv.slice(2);
if (!base || !head || !namesFile || !corpusFile) {
  fail('usage: privacy-scan.mjs <base> <head> <names-file> <corpus-file> [text-file...]');
}

const names = readList(namesFile, 'the names list').map((name) => name.toLowerCase());
const patterns = readList(corpusFile, 'the corpus list').map((pattern, index) => {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return fail(`the corpus list is invalid: entry ${index + 1} is not a regular expression`);
  }
});
const lists = {
  names: (line) => {
    const lowered = line.toLowerCase();
    return names.some((name) => lowered.includes(name));
  },
  corpus: (line) => patterns.some((pattern) => pattern.test(line)),
};

for (const ref of [base, head]) git(['rev-parse', '--verify', `${ref}^{commit}`]);
const commits = git(['rev-list', '--count', `${base}..${head}`]).trim();
const messages = git(['log', '--format=%B', `${base}..${head}`]).split('\n');
const texts = textFiles.flatMap((file) => readLines(file, `text file ${file}`));

const sources = [
  ['added lines', { names: addedLines(base, head, NAMES_PATHS), corpus: addedLines(base, head, CORPUS_PATHS) }],
  ['commit messages', { names: messages, corpus: messages }],
  ['paths', { names: changedPaths(base, head, NAMES_PATHS), corpus: changedPaths(base, head, CORPUS_PATHS) }],
  ['pull request text', { names: texts, corpus: texts }],
];

process.stdout.write(`privacy-scan: ${commits} commits in ${base.slice(0, 12)}..${head.slice(0, 12)}\n`);
let total = 0;
for (const [list, matches] of Object.entries(lists)) {
  for (const [source, lines] of sources) {
    const count = lines[list].filter(matches).length;
    total += count;
    process.stdout.write(`${list.padEnd(7)} ${source.padEnd(18)} ${count}\n`);
  }
}
process.stdout.write(`privacy-scan: ${total} matching lines${total ? '; the text is not printed' : ''}\n`);
process.exit(total ? 1 : 0);
