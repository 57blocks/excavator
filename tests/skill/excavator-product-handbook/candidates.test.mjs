// The candidates command prints the lister's output stamped with the
// handbook's own format string first, and writes nothing.
import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { graphHeaderLine } from '../excavator-prd-report/helpers.mjs';
import { FIXTURE_PROJECT, runHandbook } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

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

describe('handbook.mjs candidates never read the knowledge graph (design D10)', () => {
  /** A copy of the fixture project whose graph header lists a framework the build files do not have. */
  const projectWithGraph = (frameworks) => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'xhb-graph-')));
    cleanups.push(() => rmSync(base, { recursive: true, force: true }));
    const root = join(base, 'project');
    cpSync(FIXTURE_PROJECT, root, { recursive: true });
    mkdirSync(join(root, '.excavator'), { recursive: true });
    writeFileSync(join(root, '.excavator', 'knowledge-graph.jsonl'), graphHeaderLine(frameworks));
    return root;
  };

  it('detects from the build files and says so, whatever the graph header lists', () => {
    const plain = JSON.parse(runHandbook(['candidates', FIXTURE_PROJECT]).stdout);
    expect(plain.frameworks).not.toContain('gin');
    const root = projectWithGraph(['gin', 'react-router']);
    const result = runHandbook(['candidates', root]);
    expect(result.status, result.stderr).toBe(0);
    const listing = JSON.parse(result.stdout);
    expect(listing.detection.source).toBe('build-files');
    expect(listing.frameworks).not.toContain('gin');
    expect(listing.frameworks).not.toContain('react-router');
    expect(listing.frameworks).toEqual(plain.frameworks);
    expect(listing.items.map((item) => [item.file, item.line, item.framework])).toEqual(plain.items.map((item) => [item.file, item.line, item.framework]));
    // The residual assumptions do not claim the graph is absent: it is there and is not read.
    expect(listing.residualAssumptions.join('\n')).not.toMatch(/No knowledge graph/);
    expect(listing.residualAssumptions.join('\n')).toMatch(/knowledge graph is not read/);
  });

  it('does not open the graph file at all: a graph that cannot be read changes nothing', () => {
    const root = projectWithGraph(['gin']);
    writeFileSync(join(root, '.excavator', 'knowledge-graph.jsonl'), 'not a header\n');
    const listing = JSON.parse(runHandbook(['candidates', root]).stdout);
    expect(listing.detection.source).toBe('build-files');
    expect(listing.residualAssumptions.join('\n')).not.toMatch(/header could not be read/);
  });
});

