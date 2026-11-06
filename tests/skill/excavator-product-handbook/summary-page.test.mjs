// Oracle O1 (page data half) of openspec change handbook-summary-tables: the
// page data carries the same two tables as handbook.md, in format 2, with no
// citation path, and is the same bytes on a second run. The browser half is in
// page-browser.test.mjs. These tests use a stub template with the two markers.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runHandbook } from './helpers.mjs';
import { FORM, JOB_FILE, verifiedRun as makeVerifiedRun } from './summary-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const page = (run) => runHandbook(['page', run.out, '--project', run.root], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const dataOf = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(readFileSync(join(run.out, 'handbook.html'), 'utf-8'))[1]);

describe('page data: the summary', () => {
  it('has the format 6 and the same rows the markdown has, without a citation path', () => {
    const run = makeVerifiedRun(cleanups);
    const made = page(run);
    expect(made.status, made.stdout + made.stderr).toBe(0);
    const data = dataOf(run);
    expect(data.format).toBe('excavator-product-handbook-page/8');
    expect(Object.keys(data)).toEqual(['format', 'project', 'language', 'languageTag', 'ui', 'views', 'areas', 'domains', 'domainBasis', 'features', 'coverage', 'summary', 'system', 'entities']);
    expect(data.summary.notifications).toEqual([{ feature: 'F1', trigger: 'An order is sent', recipient: 'The approver', channel: 'Message', content: 'A new order waits for approval.' }]);
    expect(data.summary.jobs).toEqual([{
      kind: 'job',
      candidate: run.idOf(JOB_FILE, 4),
      feature: 'F3',
      reason: null,
      schedule: { bucket: 'literal', literal: '0 9 * * *' },
      automatic: [{ when: 'Every day at nine', effect: 'A reminder goes out.' }],
    }]);
    expect(data.summary.counts).toEqual({
      featureTotal: 5,
      featuresWithEntry: 2,
      notificationRows: 1,
      jobRows: 1,
      schedule: { literal: 1, computed: 0, absent: 0 },
      described: 1,
    });
    const html = readFileSync(join(run.out, 'handbook.html'), 'utf-8');
    for (const file of [FORM, JOB_FILE]) expect(html).not.toContain(file);
  });

  it('gives identical page bytes on two runs', () => {
    const run = makeVerifiedRun(cleanups);
    expect(page(run).status).toBe(0);
    const first = readFileSync(join(run.out, 'handbook.html'));
    expect(page(run).status).toBe(0);
    expect(readFileSync(join(run.out, 'handbook.html')).equals(first)).toBe(true);
  });
});
