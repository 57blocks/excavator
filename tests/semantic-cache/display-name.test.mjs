// displayName oracles 2-5 (node-display-name): the commit gate, the audit
// field paths, the schema version and the single field list. Written red
// first against the code that had no displayName.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CACHEABLE_FIELDS,
  SEMANTIC_CACHE_VERSION,
  WRITER_FIELDS,
  commitSemanticCacheEntry,
  freshnessOf,
  isCanonicalSemanticCache,
  isCanonicalSemanticCacheEntry,
  readSemanticCache,
} from '../../skills/excavator/semantic-cache.mjs';
import { auditSemanticCacheFields } from '../../skills/excavator/semantic-language-audit.mjs';
import { createProjectService } from '../../skills/excavator/project-service.mjs';
import * as mcpServer from '../../skills/excavator/mcp-server.mjs';
import { PIPELINE_VERSION } from '../../skills/excavator/lazy-analyze.mjs';
import { IDS, makeMcpFixture } from '../mcp/fixture.mjs';

const NODE_ID = 'function:src/orderService.ts:createOrder()';
const OTHER_ID = 'function:src/orderService.ts:cancelOrder()';
const FILE_PATH = 'src/orderService.ts';
const HASH = 'sha256:display-name-aaaa';

// Built from code points so this file carries no non-ASCII text.
const NON_ENGLISH_NAME = [0x521b, 0x5efa, 0x20, 0x8ba2, 0x5355].map((c) => String.fromCodePoint(c)).join('');

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-display-name-'));
  mkdirSync(join(root, '.excavator'), { recursive: true });
  writeFileSync(
    join(root, '.excavator', 'source-manifest.json'),
    JSON.stringify({
      sourceRevision: 'directory:test', selectionDigest: 'sd1', pipelineVersion: PIPELINE_VERSION,
      entries: [{ path: FILE_PATH, contentHash: HASH }],
    }),
  );
  return root;
}

function fieldsWith(overrides = {}) {
  return {
    summary: 'Creates a new order for the given user from validated cart items.',
    displayName: 'Create order',
    tags: ['order', 'creation'],
    semanticSourceHash: HASH,
    model: 'test-model-1',
    generatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const cachePath = (root) => join(root, '.excavator', 'semantic-cache.json');

describe('displayName commit gate (oracle 2)', () => {
  let root;
  beforeEach(() => { root = makeProject(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const rejected = [
    ['missing', undefined, 'display-name-missing'],
    ['empty', '', 'display-name-shape'],
    ['whitespace only', '   \t ', 'display-name-shape'],
    ['61 characters', `${'a'.repeat(30)} ${'b'.repeat(30)}`, 'display-name-shape'],
    ['9 words', 'one two three four five six seven eight nine', 'display-name-shape'],
    ['a single word', 'Create', 'display-name-shape'],
    ['containing a newline', 'Create\norder', 'display-name-shape'],
    ['not a string', ['Create order'], 'display-name-shape'],
    ['non-English', NON_ENGLISH_NAME, 'noncanonical-language'],
  ];

  for (const [label, value, status] of rejected) {
    it(`rejects a displayName that is ${label} with ${status} and writes nothing`, async () => {
      const fields = fieldsWith();
      if (value === undefined) delete fields.displayName;
      else fields.displayName = value;
      const result = await commitSemanticCacheEntry({ projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(status);
      expect(existsSync(cachePath(root))).toBe(false);
    });
  }

  it('accepts a displayName of 8 words and exactly 60 characters', async () => {
    const eight = 'one two three four five six seven eight';
    const sixty = `${'a'.repeat(29)} ${'b'.repeat(30)}`;
    for (const [id, name] of [[NODE_ID, eight], [OTHER_ID, sixty]]) {
      const result = await commitSemanticCacheEntry({
        projectRoot: root, nodeId: id, filePath: FILE_PATH, fields: fieldsWith({ displayName: name }),
      });
      expect(result).toMatchObject({ ok: true, status: 'committed' });
    }
  });

  it('treats a stored entry without a valid displayName as non-canonical', async () => {
    const fields = fieldsWith();
    expect(isCanonicalSemanticCacheEntry({ ...fields, languageAudit: auditSemanticCacheFields({ fields }) })).toBe(true);
    const { displayName, ...bare } = fields;
    expect(isCanonicalSemanticCacheEntry({ ...bare, languageAudit: auditSemanticCacheFields({ fields: bare }) })).toBe(false);
  });
});

describe('displayName language audit paths (oracle 3)', () => {
  it('audits summary, displayName, then each tag', () => {
    const audit = auditSemanticCacheFields({
      fields: { summary: 'Creates an order.', displayName: 'Create order', tags: ['a', 'b'] },
    });
    expect(audit.accepted.map((entry) => entry.fieldPath)).toEqual(['summary', 'displayName', 'tags[0]', 'tags[1]']);
  });
});

describe('cache schema version 3.0.0 (oracle 4)', () => {
  let root;
  beforeEach(() => { root = makeProject(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('does not reuse a 2.0.0 cache whose entries still match the source hash, and the first write starts clean', async () => {
    const oldFields = fieldsWith({ displayName: undefined });
    delete oldFields.displayName;
    const oldCache = {
      version: '2.0.0',
      contentLanguage: 'en',
      entries: { [OTHER_ID]: { ...oldFields, languageAudit: auditSemanticCacheFields({ fields: oldFields }) } },
    };
    writeFileSync(cachePath(root), JSON.stringify(oldCache));

    const loaded = await readSemanticCache(root);
    expect(isCanonicalSemanticCache(loaded)).toBe(false);
    expect(freshnessOf(loaded.entries[OTHER_ID], HASH, loaded)).not.toBe('fresh');

    expect(SEMANTIC_CACHE_VERSION).toBe('3.0.0');
    const result = await commitSemanticCacheEntry({ projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields: fieldsWith() });
    expect(result).toMatchObject({ ok: true, status: 'committed' });
    const written = JSON.parse(readFileSync(cachePath(root), 'utf-8'));
    expect(written.version).toBe('3.0.0');
    expect(Object.keys(written.entries)).toEqual([NODE_ID]);
    expect(written.entries[NODE_ID].displayName).toBe('Create order');
  });
});

describe('one field list (oracle 5)', () => {
  it('CACHEABLE_FIELDS includes displayName', () => {
    expect(CACHEABLE_FIELDS).toContain('displayName');
  });

  it('WRITER_FIELDS is CACHEABLE_FIELDS without the verifier-owned verification', () => {
    expect([...WRITER_FIELDS].sort()).toEqual(CACHEABLE_FIELDS.filter((key) => key !== 'verification').sort());
  });

  it('semantic_plan constraints.cacheable is the same set as WRITER_FIELDS', async () => {
    const fixture = makeMcpFixture();
    try {
      const plan = await createProjectService(fixture.root).semanticPlan({ nodeIds: [IDS.missing] });
      expect(plan.data.constraints.cacheable).toContain('displayName');
      expect([...plan.data.constraints.cacheable].sort()).toEqual([...WRITER_FIELDS].sort());
    } finally {
      fixture.cleanup();
    }
  });

  it('the semantic_commit fields schema has the same keys as WRITER_FIELDS', () => {
    expect(Object.keys(mcpServer.semanticCommitFields.shape).sort()).toEqual([...WRITER_FIELDS].sort());
  });
});

describe('reuse carries the name (node-display-name)', () => {
  it('a fresh entry reused by semantic_plan comes with its displayName', async () => {
    const fixture = makeMcpFixture();
    try {
      const plan = await createProjectService(fixture.root).semanticPlan({ nodeIds: [IDS.a] });
      expect(plan.data.reuse).toHaveLength(1);
      expect(plan.data.reuse[0].displayName).toBe('Return local value');
    } finally {
      fixture.cleanup();
    }
  });
});
