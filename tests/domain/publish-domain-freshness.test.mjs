// Group 3 (openspec: changes/full-semantic-isolation, capability
// `domain-freshness`) — publish-annotations.mjs carries sourceRevision +
// factDigest from the annotated domain-analysis.json into the published
// domain-graph.json, the same way it already does for `gaps` (both are
// written into intermediate/ and would otherwise be lost when the pipeline's
// SAVE phase moves intermediate/ into .trash-*).
import { describe, expect, it, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeAnnotations, ROOT_FIELDS, DOMAIN_ROOT_FIELDS } from '../../skills/excavator/publish-annotations.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const PUBLISH = resolve(repoRoot, 'skills/excavator/publish-annotations.mjs');

const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'excavator-publish-domain-freshness-'));
  roots.push(dir);
  return dir;
}

describe('DOMAIN_ROOT_FIELDS is additional to, not a replacement of, ROOT_FIELDS', () => {
  it('does not overlap with the fields already shared by both graphs', () => {
    for (const field of DOMAIN_ROOT_FIELDS) {
      expect(ROOT_FIELDS).not.toContain(field);
    }
  });
});

describe('mergeAnnotations — domain freshness keys propagate when rootFields includes them', () => {
  it('carries sourceRevision/factDigest from annotated into published only when requested', () => {
    const published = { nodes: [], edges: [] };
    const annotated = { nodes: [], edges: [], sourceRevision: 'git:' + 'a'.repeat(40), factDigest: 'b'.repeat(64) };

    const withoutDomainFields = mergeAnnotations({ published, annotated });
    expect(withoutDomainFields.merged.sourceRevision).toBeUndefined();

    const withDomainFields = mergeAnnotations({
      published, annotated, rootFields: [...ROOT_FIELDS, ...DOMAIN_ROOT_FIELDS],
    });
    expect(withDomainFields.merged.sourceRevision).toBe('git:' + 'a'.repeat(40));
    expect(withDomainFields.merged.factDigest).toBe('b'.repeat(64));
    expect(withDomainFields.counts.rootFieldsWritten).toBe(2);
  });
});

describe('publish-annotations CLI — domain-graph.json gains freshness keys it did not have on disk', () => {
  it('the published domain-graph.json ends up with the annotated sourceRevision/factDigest', () => {
    const root = tempRoot();
    const dataDir = join(root, '.excavator');
    const intermediate = join(dataDir, 'intermediate');
    mkdirSync(intermediate, { recursive: true });

    writeFileSync(join(dataDir, 'knowledge-graph.json'), JSON.stringify({
      version: '1.0.0', project: { name: 'x' }, nodes: [], edges: [], layers: [], tour: [],
    }), 'utf-8');
    // The "published" domain-graph.json, exactly as a naive "Save" step would
    // have written it BEFORE this capability existed — no freshness keys.
    writeFileSync(join(dataDir, 'domain-graph.json'), JSON.stringify({
      version: '1.0.0', project: { name: 'x' },
      nodes: [{ id: 'step:s1', type: 'step', name: 's1', summary: '', tags: [], complexity: 'simple' }],
      edges: [], layers: [], tour: [],
    }), 'utf-8');
    // The annotated copy, already stamped by annotate-domain.mjs.
    writeFileSync(join(intermediate, 'domain-analysis.json'), JSON.stringify({
      version: '1.0.0', project: { name: 'x' },
      nodes: [{ id: 'step:s1', type: 'step', name: 's1', summary: '', tags: [], complexity: 'simple' }],
      edges: [], layers: [], tour: [],
      sourceRevision: 'directory:' + 'c'.repeat(64),
      factDigest: 'd'.repeat(64),
    }), 'utf-8');

    const result = spawnSync(process.execPath, [PUBLISH, root, '--no-reports'], { encoding: 'utf-8', cwd: repoRoot });
    expect(result.status, result.stderr).toBe(0);

    const published = JSON.parse(readFileSync(join(dataDir, 'domain-graph.json'), 'utf-8'));
    expect(published.sourceRevision).toBe('directory:' + 'c'.repeat(64));
    expect(published.factDigest).toBe('d'.repeat(64));
  });
});
