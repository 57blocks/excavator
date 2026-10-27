/**
 * skopo-report (openspec change skopo-extension, design D7, oracle O4): the summary is checked
 * against the skopository, the questions are carried over whole and in order of consequence, and
 * the page shows model-written text as text.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assembleReport, checkSummary, citingBlocks, orderQuestions, readQuestions, writeReportPage } from '../../../skills/skopo-create/lib/report.mjs';
import { renderMarkdown } from '../../../skills/skopo-create/lib/page.mjs';
import { cleanup, makeOut, QUESTIONS, SUMMARY } from './helpers.mjs';

const outs = [];
const reported = (summary = SUMMARY) => {
  const out = makeOut('reported');
  outs.push(out);
  writeFileSync(join(out, 'report', 'summary.md'), summary);
  return out;
};
afterEach(() => {
  for (const out of outs.splice(0)) cleanup(out);
});

describe('checkSummary', () => {
  it('passes the fixture summary', () => {
    expect(checkSummary(reported())).toEqual([]);
  });

  it.each([
    ['a paragraph without a citation', `${SUMMARY}\nThe portal is fast.\n`, /cites no statement: The portal is fast/],
    ['an ID the skopository does not define', `${SUMMARY}\n- Fees exist (R-zzzzzz).\n`, /R-zzzzzz is cited but not defined/],
    ['an ID of the wrong kind', `${SUMMARY}\n- A resident (R-0b7199).\n`, /R-0b7199 is T-0b7199/],
    ['a placeholder', `${SUMMARY}\n- Limits (R-@limit, R-cxsjfa).\n`, /R-@limit is still a placeholder/],
    ['a heading the script writes', `${SUMMARY}\n## Questions\n`, /"Questions" is a section the script writes/],
    ['a first line that is not the title', `Intro (T-0b7199).\n\n${SUMMARY}`, /first line must be the title/],
  ])('refuses %s', (_name, summary, expected) => {
    const problems = checkSummary(reported(summary));
    expect(problems.some((p) => expected.test(p)), problems.join('\n')).toBe(true);
  });

  it('asks a citation of every table data row, not of its header', () => {
    const blocks = citingBlocks('| Area | Rule |\n|---|---|\n| Limits | R-cxsjfa |\n| Fees | none |\n');
    expect(blocks.map((b) => b.text)).toEqual(['| Limits | R-cxsjfa |', '| Fees | none |']);
  });

  it('ignores code blocks', () => {
    expect(citingBlocks('# T\n\n```\nno id here\n```\n')).toEqual([]);
  });
});

describe('questions', () => {
  it('orders by consequence and keeps every row', () => {
    const { rows, decisions } = readQuestions(QUESTIONS);
    expect(orderQuestions(rows).map((r) => r.number)).toEqual([2, 3, 1]);
    expect(decisions).toMatch(/Permits last one year/);
  });

  it('refuses a category outside the six', () => {
    const { rows, problems } = readQuestions(QUESTIONS.replace('| money |', '| finance |'));
    expect(problems).toEqual([expect.stringMatching(/^questions\.md:7 {2}question 3 has category "finance"/)]);
    expect(() => orderQuestions(rows)).toThrow(/question 3 has category "finance"/);
  });

  it('names every table row that is not a question instead of dropping it', () => {
    const text = QUESTIONS.replace('| 2 | security |', '| 2. | security |').replace('| 3 | money |', '| Q3 | money |');
    const { rows, problems } = readQuestions(text);
    expect(rows.map((r) => r.number)).toEqual([1]);
    expect(problems).toEqual([
      expect.stringMatching(/^questions\.md:6 {2}not a question row/),
      expect.stringMatching(/^questions\.md:7 {2}not a question row/),
    ]);
  });

  it('splits a row on unescaped pipes only and keeps every cell as written', () => {
    const { rows, problems } = readQuestions(QUESTIONS.replace('Who may revoke a permit?', 'Is `a \\| b` revoked?'));
    expect(problems).toEqual([]);
    expect(rows.find((r) => r.number === 2)).toMatchObject({ question: 'Is `a \\| b` revoked?', sources: 'code · runbook', statements: 'R-5tps87' });
  });
});

describe('assembleReport', () => {
  it('carries every question over once, says the skopository is not locked, and copies what is not here', () => {
    const out = reported();
    const text = readFileSync(assembleReport(out), 'utf8');
    const questionRows = text.split('\n').filter((line) => /^\|\s*\d+\s*\|/.test(line));
    expect(questionRows).toHaveLength(readQuestions(QUESTIONS).rows.length);
    expect(questionRows[0]).toMatch(/\| security \|/);
    expect(text).toMatch(/Not locked: this skopository is a proposal/);
    expect(text).toMatch(/Payments and enforcement: the city handles them\./);
    expect(text.indexOf('## Status')).toBeLessThan(text.indexOf('## Questions'));
  });

  it('carries a question with an escaped pipe over with its sources and statements', () => {
    const out = reported();
    const path = join(out, 'run', 'questions.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace('Who may revoke a permit?', 'Is `a \\| b` revoked?'));
    expect(readFileSync(assembleReport(out), 'utf8')).toContain('| 2 | security | Is `a \\| b` revoked? | code · runbook | R-5tps87 |');
  });

  it('refuses to assemble when a question row cannot be read', () => {
    const out = reported();
    const path = join(out, 'run', 'questions.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace('| 3 | money |', '| Q3 | money |'));
    expect(() => assembleReport(out)).toThrow(/not a question row/);
  });

  it('says the source size is the scope\'s in a scoped run', () => {
    const out = reported();
    const path = join(out, 'run', 'run.json');
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), scope: 'services/billing' }));
    const text = readFileSync(assembleReport(out), 'utf8');
    expect(text).toContain('- Scope: `services/billing`');
    expect(text).toContain('- Sources surveyed in the scope: 1200 code lines');
  });

  it('refuses to assemble from a summary that fails its check', () => {
    expect(() => assembleReport(reported(`${SUMMARY}\nUncited claim.\n`))).toThrow(/cites no statement/);
  });
});

describe('report page', () => {
  it('shows script, image and link markup as text', () => {
    const html = renderMarkdown('# T\n\n<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1))\n\n| a | b |\n|---|---|\n| <b>c</b> | `<i>` |\n');
    expect(html).not.toMatch(/<script|<img|<a\b|<b>|<i>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('[x](javascript:alert(1))');
  });

  it('ends on every line terminator, a lone carriage return and a line separator included', () => {
    const html = renderMarkdown('## Domain\r notes\n\nx\u2028## y\u2029z');
    expect(html).toBe('<h2>Domain</h2>\n<p>notes</p>\n<p>x</p>\n<h2>y</h2>\n<p>z</p>');
  });

  it('writes one page with no external resource and no script', () => {
    const out = reported();
    assembleReport(out);
    const html = readFileSync(writeReportPage(out), 'utf8');
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/<script|<link|src=|href=/);
    expect(html).toContain('<title>Permits</title>');
    expect(html).toMatch(/<td>security<\/td>/);
  });
});
