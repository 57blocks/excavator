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
    const { rows } = readQuestions(QUESTIONS.replace('| money |', '| finance |'));
    expect(() => orderQuestions(rows)).toThrow(/question 3 has category "finance"/);
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
