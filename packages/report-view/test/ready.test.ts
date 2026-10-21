import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearCount, clearReady, setCount, setReady } from '../src/ready';

/** A document whose root element records attributes, as far as the signals need. */
function stubDocument() {
  const attributes = new Map<string, string>();
  (globalThis as unknown as { document: unknown }).document = {
    documentElement: {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    },
  };
  return attributes;
}

describe('the ready and count conventions', () => {
  let attributes: Map<string, string>;
  beforeEach(() => {
    attributes = stubDocument();
  });
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it('writes data-xv-ready as 1 or error and takes it off again', () => {
    setReady('1');
    expect(attributes.get('data-xv-ready')).toBe('1');
    setReady('error');
    expect(attributes.get('data-xv-ready')).toBe('error');
    clearReady();
    expect(attributes.has('data-xv-ready')).toBe(false);
  });

  it('writes each total as a data-xv-count-<name> attribute with the value as text, 0 included', () => {
    setCount('nodes', 10);
    setCount('groups', 0);
    expect(attributes.get('data-xv-count-nodes')).toBe('10');
    expect(attributes.get('data-xv-count-groups')).toBe('0');
    clearCount('nodes');
    expect(attributes.has('data-xv-count-nodes')).toBe(false);
    expect(attributes.get('data-xv-count-groups')).toBe('0');
  });
});
