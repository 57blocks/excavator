// artifact-view task 4A.2: postings are no longer embedded; the page rebuilds
// the term -> chunk index from the chunk tokens (plus the literal text when
// it is embedded). The rebuilt index must equal the source index's own
// posting records for the same synthetic project.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { decodeBundle } from '../../skills/excavator-view/bundle-codec.mjs';
import { buildView } from '../../skills/excavator-view/build-view.mjs';
import { extractBundleText } from '../../skills/excavator-view/bake/html-output.mjs';
import { splitIdentifier as indexSplitIdentifier } from '../../skills/excavator/build-source-index.mjs';
import { lookupTerm, rebuildPostings, splitIdentifier } from '../../packages/view/src/model/postings.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureProject = join(repoRoot, 'tests/view/fixtures/sample-project');
const lazyScript = join(repoRoot, 'skills/excavator/lazy-analyze.mjs');

const TEMPLATE_HTML = [
  '<!doctype html><html><head>',
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; '
    + 'style-src \'unsafe-inline\'; img-src data:; worker-src blob:; connect-src \'none\'">',
  '<title>t</title></head><body><div id="root"></div>',
  '<script type="text/plain" id="excavator-view-data"></script>',
  '</body></html>',
].join('\n');

const scratch = mkdtempSync(join(tmpdir(), 'excavator-view-postings-'));
let project;
let templatePath;
let records;

async function bakeSegments(options) {
  const out = join(mkdtempSync(join(scratch, 'out-')), 'view.html');
  await buildView({ projectRoot: project, templatePath, out, ...options });
  return (await decodeBundle(extractBundleText(readFileSync(out, 'utf-8')))).segments;
}

/** term -> chunk ordinals, as the rebuilt index answers it. */
function asMap(index) {
  return new Map(index.terms.map((term) => [term, Array.from(lookupTerm(index, term))]));
}

beforeAll(() => {
  templatePath = join(scratch, 'template.html');
  writeFileSync(templatePath, TEMPLATE_HTML);
  project = join(scratch, 'project');
  cpSync(fixtureProject, project, { recursive: true });
  execFileSync(process.execPath, [lazyScript, project], { stdio: 'pipe' });
  records = readFileSync(join(project, '.excavator', 'source-index.jsonl'), 'utf-8').trimEnd().split('\n').map((l) => JSON.parse(l));
}, 120_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('rebuilt postings (4A.2)', () => {
  it('equal the source index posting records when literals are embedded', async () => {
    const segments = await bakeSegments({});
    expect(Object.keys(segments).some((name) => name === 'index.terms' || name === 'index.postings')).toBe(false);
    const index = rebuildPostings(segments, segments.strings);
    expect(index.scope).toBe('identifiers+literals');
    const postings = records.filter((r) => r.record === 'posting');
    expect(postings.length).toBeGreaterThan(0);
    expect(index.terms).toEqual(postings.map((r) => r.term));
    expect(asMap(index)).toEqual(new Map(postings.map((r) => [r.term, r.chunks])));
  });

  it('cover the chunk identifiers only when literals are not embedded, and say so', async () => {
    const segments = await bakeSegments({ noSource: true });
    const index = rebuildPostings(segments, segments.strings);
    expect(index.scope).toBe('identifiers');
    const expected = new Map();
    records.filter((r) => r.record === 'chunk').forEach((r, ordinal) => {
      for (const term of r.chunk.identifiers) {
        const list = expected.get(term) ?? [];
        if (list.at(-1) !== ordinal) list.push(ordinal);
        expected.set(term, list);
      }
    });
    expect(asMap(index)).toEqual(expected);
    // A term that only a string literal carries is not searchable here.
    expect(Array.from(lookupTerm(index, 'purpose'))).toEqual([]);
  });

  it('see a changed posting (instrument check)', async () => {
    const segments = await bakeSegments({});
    const index = rebuildPostings(segments, segments.strings);
    const postings = new Map(records.filter((r) => r.record === 'posting').map((r) => [r.term, r.chunks]));
    const [term, chunks] = postings.entries().next().value;
    postings.set(term, [...chunks, 999]);
    expect(asMap(index)).not.toEqual(postings);
  });

  it('is null without a source index', () => {
    expect(rebuildPostings({ strings: [] }, [])).toBeNull();
  });

  it('splits identifiers exactly like the index builder', () => {
    for (const raw of ['HTTPServer', 'parseJSONValue', 'snake_case-kebab', 'x2y', 'ÄpfelBirnen', '${banner}: hello', '', '__proto__', 'URLs2Go']) {
      expect(splitIdentifier(raw), raw).toEqual(indexSplitIdentifier(raw));
    }
  });
});
