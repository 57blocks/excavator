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
 *                forbidden everywhere except the root pnpm-lock.yaml
 *   corpus-file  one regular expression per line, ignoring case; forbidden
 *                outside openspec/, docs/, the Markdown files at the root and
 *                the root pnpm-lock.yaml
 *   text-file    more text to check against both lists (the pull request's
 *                title, branch name and body)
 *
 * Neither list reads the root pnpm-lock.yaml. Its integrity hashes are random
 * text that a short name or a loose pattern matches by chance, and a match
 * there can be neither located nor fixed: the scan prints no text, and nobody
 * writes the hashes. What an author does choose in it, the dependency
 * specifiers and workspace directories, also stands in package.json,
 * pnpm-workspace.yaml and the workspace's own paths, which both lists read.
 *
 * What it reads, for every commit in base..head (history is public even when
 * a later commit undoes a change):
 *   added lines      each non-merge commit's patch, and each merge commit's
 *                    remerge diff, which holds exactly the lines the merge
 *                    itself wrote (a conflict resolution or any other edit)
 *   commit messages  of every commit
 *   authors          author and committer, name and email
 *   paths            every commit adds or changes
 * History is read in full (a path filter would otherwise drop the commits of
 * a merged side branch), and every file as text, whatever git or a `-diff`
 * attribute would call binary, with NUL bytes removed so UTF-16 text
 * matches. A merge with more than two parents has no remerge diff; it fails
 * the scan.
 *
 * Blank lines in a list are dropped: a blank pattern matches every line.
 * Prints how many lines match per list and source, never the text.
 * Exit code: 0 if nothing matches; 1 if something does; 2 if a list is
 * missing, empty or invalid, the range holds a merge it cannot read, or git
 * fails.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The corpus list reads what the names list reads, less the places where an
// acceptance record may name a corpus; so both skip the lockfile.
const NAMES_PATHS = ['.', ':(exclude)pnpm-lock.yaml'];
const CORPUS_PATHS = [...NAMES_PATHS, ':(exclude)openspec', ':(exclude)docs', ':(exclude,glob)*.md'];
const LOG = [
  '-c', 'core.quotePath=false', 'log', '--full-history', '--diff-merges=remerge',
  '--text', '--no-color', '--no-ext-diff', '--no-textconv', '--format=',
];

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
    fail(`git failed: ${String(error.stderr ?? error.message).trim()}`);
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
    else if (!inHeader && line.startsWith('+')) lines.push(line.slice(1).replaceAll('\0', ''));
  }
  return lines;
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

const range = `${base}..${head}`;
for (const ref of [base, head]) git(['rev-parse', '--verify', `${ref}^{commit}`]);
const octopus = git(['rev-list', '--count', '--min-parents=3', range]).trim();
if (octopus !== '0') fail(`${octopus} merges in ${range} have more than two parents and cannot be read; merge one branch at a time`);
const commits = git(['rev-list', '--count', range]).trim();

const addedLines = (paths) => added(git([...LOG, '-p', range, '--', ...paths]));
const changedPaths = (paths) => git([...LOG, '--name-only', range, '--', ...paths]).split('\n').filter((line) => line !== '');
const messages = git(['log', '--format=%B', range]).split('\n');
const authors = git(['log', '--format=%an <%ae>%n%cn <%ce>', range]).split('\n');
const texts = textFiles.flatMap((file) => readLines(file, `text file ${file}`));

const sources = [
  ['added lines', { names: addedLines(NAMES_PATHS), corpus: addedLines(CORPUS_PATHS) }],
  ['commit messages', { names: messages, corpus: messages }],
  ['authors', { names: authors, corpus: authors }],
  ['paths', { names: changedPaths(NAMES_PATHS), corpus: changedPaths(CORPUS_PATHS) }],
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
