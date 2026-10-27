/**
 * The skopo-report files (openspec change skopo-extension, design D7). The model writes
 * report/summary.md; this module checks it, assembles report/report.md from it and from the run's
 * own files, and renders report/report.html. Zero model calls.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cells, refsIn } from '../checker/spec.mjs';
import { citationProblems, statementKinds } from './citations.mjs';
import { outPaths, readRun } from './run-state.mjs';
import { renderPage } from './page.mjs';

/** Question categories in order of consequence: what could hurt someone or lose money first. */
export const CATEGORIES = Object.freeze(['security', 'money', 'regulation', 'promise', 'behaviour', 'documentation']);

/** The sections the script writes; the summary must not hold them. */
export const OWNED_HEADINGS = Object.freeze(['Status', 'Questions', 'Decisions without a recorded reason', 'Scope and coverage']);

const DECISIONS_HEADING = /^##\s+Decisions without a recorded reason\s*$/i;

export function reportPaths(out) {
  const dir = outPaths(out).report;
  return { dir, summary: join(dir, 'summary.md'), markdown: join(dir, 'report.md'), page: join(dir, 'report.html') };
}

/**
 * The summary's blocks that must cite: each paragraph, list item and table data row, outside code
 * fences, with the line it starts on. Headings, table header and separator rows and blank lines
 * cite nothing.
 */
export function citingBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let fenced = false;
  let paragraph = null;
  const close = () => {
    if (paragraph) blocks.push(paragraph);
    paragraph = null;
  };
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/^\s*```/.test(line)) {
      close();
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    if (/^\s*$/.test(line) || /^\s*#{1,6}\s/.test(line)) {
      close();
      return;
    }
    if (/^\s*\|/.test(line)) {
      close();
      const next = lines[i + 1] ?? '';
      const isHeader = /^\s*\|[\s:|-]+\|\s*$/.test(next);
      const isSeparator = /^\s*\|[\s:|-]+\|\s*$/.test(line);
      if (!isHeader && !isSeparator) blocks.push({ line: n, text: line });
      return;
    }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      close();
      paragraph = { line: n, text: line };
      return;
    }
    if (paragraph) paragraph.text += `\n${line}`;
    else paragraph = { line: n, text: line };
  });
  close();
  return blocks;
}

/** Every problem with report/summary.md, one line each; empty when it passes. */
export function checkSummary(out) {
  const { summary } = reportPaths(out);
  const { skopo } = outPaths(out);
  if (!existsSync(summary)) return [`${summary} is missing`];
  if (!existsSync(join(skopo, 'skopo.json'))) return [`${skopo} holds no skopository`];
  const text = readFileSync(summary, 'utf8');
  const problems = [];
  if (!/^# \S/.test(text)) problems.push('summary.md:1  the first line must be the title, one # heading');
  text.split('\n').forEach((line, i) => {
    const heading = line.match(/^#{1,6}\s+(.*?)\s*$/);
    if (heading && OWNED_HEADINGS.some((h) => h.toLowerCase() === heading[1].toLowerCase())) {
      problems.push(`summary.md:${i + 1}  "${heading[1]}" is a section the script writes; leave it out`);
    }
  });
  let kinds;
  try {
    kinds = statementKinds(skopo);
  } catch (error) {
    return [...problems, `the skopository cannot be read: ${error.message}`];
  }
  problems.push(...citationProblems(text, kinds, 'summary.md'));
  for (const block of citingBlocks(text)) {
    if (!refsIn(block.text).some((ref) => kinds.get(ref.key) === ref.kind)) problems.push(`summary.md:${block.line}  cites no statement: ${block.text.split('\n')[0].slice(0, 80)}`);
  }
  return problems;
}

/** The question rows of the run's questions.md and its section of decisions without a recorded reason. */
export function readQuestions(text) {
  const lines = text.split('\n');
  const rows = lines.filter((line) => /^\|\s*\d+\s*\|/.test(line)).map((line) => {
    const [number, category, question, sources, statements] = cells(line);
    return { number: Number(number), category: (category ?? '').toLowerCase(), question, sources, statements, line };
  });
  const start = lines.findIndex((line) => DECISIONS_HEADING.test(line));
  let decisions = '';
  if (start >= 0) {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
    decisions = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  }
  return { rows, decisions };
}

/** The questions ordered by consequence, each category keeping its own numbering order. Throws on an unknown category. */
export function orderQuestions(rows) {
  const unknown = rows.filter((row) => !CATEGORIES.includes(row.category));
  if (unknown.length > 0) {
    throw new Error(unknown.map((row) => `questions.md: question ${row.number} has category "${row.category}", not one of ${CATEGORIES.join(', ')}`).join('\n'));
  }
  return [...rows].sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.number - b.number);
}

/** The body of the README's "What is not here" section, or null. */
export function whatIsNotHere(readme) {
  const lines = readme.split('\n');
  const start = lines.findIndex((line) => /^#{2,3}\s+What is not here\s*$/i.test(line));
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => new RegExp(`^#{1,${level}}\\s`).test(line));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  return body === '' ? null : body;
}

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

function statusSection(out, run) {
  const { skopo } = outPaths(out);
  const locked = existsSync(join(skopo, 'spec.lock.json'));
  return [
    '## Status',
    '',
    locked
      ? '- Locked: `spec.lock.json` records the text people accepted.'
      : '- Not locked: this skopository is a proposal recovered from the sources. Nobody has confirmed it yet.',
    `- Source revision: \`${run.sourceRevision}\``,
    `- Scope: ${run.scope ? `\`${run.scope}\`` : 'the whole project'}`,
  ].join('\n');
}

function questionsSection(rows) {
  const counts = CATEGORIES.map((c) => [c, rows.filter((r) => r.category === c).length]).filter(([, n]) => n > 0);
  const tally = rows.length === 0 ? 'No questions were raised.' : `${rows.length} questions: ${counts.map(([c, n]) => `${n} ${c}`).join(' · ')}.`;
  const table = rows.length === 0 ? [] : [
    '',
    '| # | Category | Question | Sources that disagree | Statements it bears on |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.number} | ${r.category} | ${r.question} | ${r.sources} | ${r.statements} |`),
  ];
  return ['## Questions', '', tally, ...table].join('\n');
}

function coverageSection(out) {
  const { metrics, skopo } = outPaths(out);
  const m = readJson(metrics);
  const readmePath = join(skopo, 'README.md');
  const notHere = existsSync(readmePath) ? whatIsNotHere(readFileSync(readmePath, 'utf8')) : null;
  const lines = ['## Scope and coverage', ''];
  if (m?.statements) {
    const k = m.statements.byKind ?? {};
    lines.push(`- Statements: ${m.statements.total} (${['T', 'A', 'R', 'W', 'E', 'F', 'D'].map((x) => `${k[x] ?? 0} ${x}`).join(' · ')})`);
  }
  if (m?.source) lines.push(`- Sources read: ${m.source.codeLines} code lines and ${m.source.docWords} document words in ${m.source.repos} repositories`);
  if (m?.lint?.last) lines.push(`- Last lint pass: ${m.lint.last.errors} errors, ${m.lint.last.warnings} warnings, after ${m.lint.passes} passes`);
  if (!m) lines.push('- No metrics were recorded for this run.');
  lines.push('', '### What is not here', '', notHere ?? 'The skopository does not say.');
  return lines.join('\n');
}

/** Writes report/report.md from the summary and the run's files and returns its path. Throws when a file it needs is missing or wrong. */
export function assembleReport(out) {
  const run = readRun(out);
  if (!run) throw new Error(`${out} holds no skopo run`);
  const problems = checkSummary(out);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  const { questions } = outPaths(out);
  if (!existsSync(questions)) throw new Error(`${questions} is missing`);
  const { rows, decisions } = readQuestions(readFileSync(questions, 'utf8'));
  const ordered = orderQuestions(rows);
  const paths = reportPaths(out);
  const text = [
    readFileSync(paths.summary, 'utf8').trim(),
    statusSection(out, run),
    questionsSection(ordered),
    ['## Decisions without a recorded reason', '', decisions || 'None recorded.'].join('\n'),
    coverageSection(out),
  ].join('\n\n');
  writeFileSync(paths.markdown, `${text}\n`);
  return paths.markdown;
}

/** Writes report/report.html from report/report.md and returns its path. */
export function writeReportPage(out) {
  const paths = reportPaths(out);
  if (!existsSync(paths.markdown)) throw new Error(`${paths.markdown} is missing; run report-assemble first`);
  const markdown = readFileSync(paths.markdown, 'utf8');
  const title = (markdown.match(/^# (.+)$/m) ?? [])[1] ?? 'Skopo report';
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.page, renderPage(markdown, title));
  return paths.page;
}
