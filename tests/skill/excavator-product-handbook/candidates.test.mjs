// The candidates command prints the lister's output stamped with the
// handbook's own format string first, and writes nothing.
import { describe, expect, it } from 'vitest';

import { FIXTURE_PROJECT, runHandbook } from './helpers.mjs';

describe('handbook.mjs candidates', () => {
  it('prints JSON whose first key is the format and whose ids are c1..cN in file order', () => {
    const result = runHandbook(['candidates', FIXTURE_PROJECT]);
    expect(result.status, result.stderr).toBe(0);
    const listing = JSON.parse(result.stdout);
    expect(Object.keys(listing)[0]).toBe('format');
    expect(listing.format).toBe('excavator-product-handbook-candidates/1');
    expect(listing.items.map((item) => item.id)).toEqual(listing.items.map((_, index) => `c${index + 1}`));
    expect(listing.items.map((item) => `${item.file}:${item.line}`)).toEqual([
      'bin/admin.js:1', 'src/app.js:8', 'src/jobs/reminders.js:4', 'src/routes/archive.js:5',
      'src/routes/orders.js:5', 'src/routes/orders.js:6', 'src/routes/orders.js:7',
    ]);
  });

  it('narrows to --scope and exits 2 for a scope that does not exist or a missing project', () => {
    const scoped = runHandbook(['candidates', FIXTURE_PROJECT, '--scope', 'src/routes']);
    expect(scoped.status, scoped.stderr).toBe(0);
    expect(JSON.parse(scoped.stdout).items.every((item) => item.file.startsWith('src/routes/'))).toBe(true);
    expect(runHandbook(['candidates', FIXTURE_PROJECT, '--scope', 'nowhere']).status).toBe(2);
    expect(runHandbook(['candidates', `${FIXTURE_PROJECT}-missing`]).status).toBe(2);
  });
});
