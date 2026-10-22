import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { findProduct, parseManifest, readManifest, type ElementSource } from '../src/data/manifest';
import { PayloadReader, decodeBase64, gunzipText } from '../src/data/payload';

/** A document with the given elements' text by id. */
const fakeDocument = (elements: Record<string, string>): ElementSource => ({
  getElementById: (id) => (Object.hasOwn(elements, id) ? { textContent: elements[id] } : null),
});

const packed = (text: string) => gzipSync(Buffer.from(text, 'utf-8')).toString('base64');

const manifest = {
  viewer: 1,
  project: { name: 'fixture' },
  snapshot: { revision: 'git:abc', kind: 'git' },
  products: [
    { name: 'knowledge-graph', label: 'Knowledge graph', status: 'included', reason: null, revision: 'git:abc', revisionNote: null, command: '/excavator', file: 'knowledge-graph.jsonl', payloads: ['knowledge-graph'] },
    { name: 'hotspots', label: 'Hotspots', status: 'not-run', reason: null, revision: null, revisionNote: null, command: '/excavator-hotspots', file: 'hotspots.json', payloads: [] },
  ],
  source: { embedded: false, requested: true, limitBytes: 1048576, counts: { embedded: 0, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 0 }, files: {} },
};

describe('manifest', () => {
  it('reads the manifest element and keeps product statuses as written', () => {
    const read = readManifest(fakeDocument({ 'xv-manifest': JSON.stringify(manifest) }));
    expect(read.project.name).toBe('fixture');
    expect(findProduct(read, 'hotspots')?.status).toBe('not-run');
    expect(findProduct(read, 'doc-map')).toBeUndefined();
  });

  it('names what is wrong instead of returning an empty manifest', () => {
    expect(() => readManifest(fakeDocument({}))).toThrow('the page has no manifest (#xv-manifest)');
    expect(() => parseManifest('{')).toThrow(/^the manifest is not valid JSON/);
    expect(() => parseManifest('[]')).toThrow('the manifest is not a JSON object');
    expect(() => parseManifest('{"project":{"name":"x"},"snapshot":{"revision":"r"}}')).toThrow('the manifest has no products list');
  });
});

describe('payloads', () => {
  it('decodes base64(gzip(text)) back to the text, ignoring whitespace in the base64', async () => {
    const text = 'line one\nline two é\n';
    const base64 = packed(text);
    expect(await gunzipText(decodeBase64(`${base64.slice(0, 10)}\n  ${base64.slice(10)}`))).toBe(text);
  });

  it('decodes each payload once and parses JSON payloads', async () => {
    let lookups = 0;
    const doc: ElementSource = {
      getElementById: (id) => {
        lookups += 1;
        return id === 'xv-hotspots' ? { textContent: packed('{"files":[1,2]}') } : null;
      },
    };
    const reader = new PayloadReader(doc);
    expect(await reader.parsed('hotspots')).toEqual({ files: [1, 2] });
    expect(await reader.text('hotspots')).toBe('{"files":[1,2]}');
    expect(lookups).toBe(1);
  });

  it('names the payload that is missing, not gzip, or not JSON', async () => {
    const reader = new PayloadReader(fakeDocument({
      'xv-plain': Buffer.from('not gzip').toString('base64'),
      'xv-text': packed('not json'),
    }));
    await expect(reader.text('absent')).rejects.toThrow('the page has no data payload "absent"');
    await expect(reader.text('plain')).rejects.toThrow('data payload "plain" could not be unpacked: it is not valid gzip data');
    await expect(reader.parsed('text')).rejects.toThrow(/^data payload "text" is not valid JSON/);
  });
});
