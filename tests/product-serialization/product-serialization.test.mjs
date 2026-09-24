// Group 1 (openspec: changes/product-serialization-ceiling, capability
// `product-serialization`) — the whole-document JSON serialization ceiling
// helper. Every case here is a pure in-memory unit test; no disk I/O, no
// child process, no real 512MB fixture (the RangeError path is exercised via
// a spy, not by actually allocating a string past V8's limit — the whole
// point of `computeSerializedLength` is that it never needs to).
import { describe, expect, it, vi } from 'vitest';
import { constants as bufferConstants } from 'node:buffer';

import {
  DEFAULT_LIMIT_CHARS,
  ProductTooLargeError,
  computeSerializedLength,
  serializeJsonProduct,
  createHeadroomRecorder,
} from '../../skills/excavator/product-serialization.mjs';

// ---------------------------------------------------------------------------
// DEFAULT_LIMIT_CHARS — Requirement "整文档产物报告序列化余量": the ceiling SHALL
// come from the runtime itself, MUST NOT be written as a literal constant.
// ---------------------------------------------------------------------------
describe('DEFAULT_LIMIT_CHARS', () => {
  it('reads buffer.constants.MAX_STRING_LENGTH, not a hardcoded number', () => {
    expect(DEFAULT_LIMIT_CHARS).toBe(bufferConstants.MAX_STRING_LENGTH);
  });
});

// ---------------------------------------------------------------------------
// computeSerializedLength — must match real JSON.stringify(...).length
// exactly on every input this project's products can contain. This is the
// instrument the failure path depends on, so it is verified directly against
// the real built-in before anything else trusts it (verify-the-instrument-
// first).
// ---------------------------------------------------------------------------
describe('computeSerializedLength — matches JSON.stringify(v) and JSON.stringify(v, null, 2) exactly', () => {
  const samples = [
    ['null', null],
    ['true', true],
    ['false', false],
    ['zero', 0],
    ['negative zero', -0],
    ['negative number', -17.5],
    ['large exponential number', 1e21],
    ['small exponential number', 1e-21],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['empty string', ''],
    ['quotes and backslash', 'a"b\\c'],
    ['named escapes (tab/newline/cr/ff/bs)', 'a\tb\nc\rd\fe\bf'],
    ['other control characters', '\u0001\u0002\u001f'],
    ['valid surrogate pair (emoji)', '😀 emoji'],
    ['lone high surrogate', '\uD800 lone-high'],
    ['lone low surrogate', '\uDC00 lone-low'],
    ['multi-byte BMP characters', '中文字符串'],
    ['empty array', []],
    ['empty object', {}],
    ['flat array', [1, 2, 3]],
    ['flat object', { a: 1, b: 2 }],
    ['undefined/function/symbol dropped from object', { a: undefined, b: 1, c: () => {}, d: Symbol('x') }],
    ['undefined/function/symbol -> null in array', [undefined, 1, () => {}, Symbol('x'), null]],
    ['nested indentation', { a: { b: [1, 2, { c: 3 }] } }],
    ['deeply nested mixed', { nested: { deeply: { still: { more: [1, [2, [3, [4]]]] } } } }],
    ['array of objects and arrays', [{ a: 1 }, { b: 2 }, [1, 2, [3, 4]]]],
    ['toJSON honored (Date)', { date: new Date(0) }],
    ['toJSON returning a plain object', { toJSON() { return { x: 1 }; } }],
    // toJSON is applied ONCE, not chained: the object toJSON returns is
    // serialized as-is even though it also has its own toJSON (matches real
    // JSON.stringify — verified against Node directly before writing this).
    ['toJSON is not chained', { outer: { toJSON() { return { toJSON() { return 42; } }; } } }],
    ['empty nested containers', { emptyNested: { a: {}, b: [] } }],
    ['larger array of records', Array.from({ length: 50 }, (_, i) => ({ id: i, name: `item-${i}`, tags: [`t${i}`, `t${i + 1}`] }))],
    ['keys needing escaping', { unicodeKey: 1, '\u0001key': 2, 'key with "quotes"': 3 }],
  ];

  for (const [label, value] of samples) {
    for (const indent of [0, 2]) {
      it(`${label} (indent=${indent})`, () => {
        const expected = JSON.stringify(value, null, indent);
        expect(typeof expected).toBe('string'); // every sample above is a real product-shaped root, never itself omitted
        expect(computeSerializedLength(value, indent)).toBe(expected.length);
      });
    }
  }

  it('throws a TypeError (not silently miscounting) for a BigInt anywhere in the structure', () => {
    expect(() => computeSerializedLength({ big: 1n })).toThrow(TypeError);
    expect(() => JSON.stringify({ big: 1n })).toThrow(TypeError); // real JSON.stringify agrees this is unserializable
  });

  it('throws a TypeError for a root value that itself serializes to undefined', () => {
    expect(JSON.stringify(undefined)).toBeUndefined();
    expect(() => computeSerializedLength(undefined)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// serializeJsonProduct — success path.
// ---------------------------------------------------------------------------
describe('serializeJsonProduct — success path', () => {
  it('returns the same string JSON.stringify would, and records chars/limitChars/percentOfLimit when a recorder is given', () => {
    const value = { a: 1, b: [2, 3] };
    const recorder = createHeadroomRecorder();
    const result = serializeJsonProduct('demo-product', value, { indent: 2, limit: 1_000_000, recorder });

    expect(result).toBe(JSON.stringify(value, null, 2));
    const [entry] = recorder.entries();
    expect(entry).toMatchObject({
      product: 'demo-product',
      chars: result.length,
      limitChars: 1_000_000,
      measuredAs: 'chars',
    });
    expect(entry.percentOfLimit).toBeCloseTo((result.length / 1_000_000) * 100, 10);
  });

  it('works with no recorder at all', () => {
    const result = serializeJsonProduct('no-recorder', { x: 1 });
    expect(result).toBe(JSON.stringify({ x: 1 }));
  });

  it('defaults limit to DEFAULT_LIMIT_CHARS', () => {
    // A tiny product never approaches the real ceiling, so this only fails if
    // the default silently changed to something absurdly small.
    expect(() => serializeJsonProduct('tiny', { ok: true })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// serializeJsonProduct — named failure via an injected small limit (the
// result was built successfully, but exceeds a caller-supplied ceiling —
// this is how tests trigger the failure path without gigabytes of data).
// ---------------------------------------------------------------------------
describe('serializeJsonProduct — injected small limit triggers a named failure', () => {
  it('throws ProductTooLargeError naming the product, required chars and limit; no recorder entry is added', () => {
    const value = { payload: 'x'.repeat(100) };
    const expectedChars = JSON.stringify(value).length;
    const recorder = createHeadroomRecorder();

    let thrown;
    try {
      serializeJsonProduct('small-limit-product', value, { limit: 10, recorder });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProductTooLargeError);
    expect(thrown.name).toBe('ProductTooLargeError');
    expect(thrown.product).toBe('small-limit-product');
    expect(thrown.requiredChars).toBe(expectedChars);
    expect(thrown.limitChars).toBe(10);
    expect(thrown.message).toContain('small-limit-product');
    expect(thrown.message).toContain(String(expectedChars));
    expect(thrown.message).toContain('10');
    expect(recorder.entries()).toEqual([]); // a failure never gets a headroom entry
  });
});

// ---------------------------------------------------------------------------
// serializeJsonProduct — real RangeError simulation via a spy on the first
// JSON.stringify call, standing in for V8's own "Invalid string length"
// (the real failure mode this whole module exists for; it is proven here
// without allocating a real 512MB+ string).
// ---------------------------------------------------------------------------
describe('serializeJsonProduct — JSON.stringify throwing RangeError falls back to the recursive counter', () => {
  it('computes requiredChars via computeSerializedLength and throws ProductTooLargeError', () => {
    const value = { a: { b: [1, 2, { c: 'hello world' }] } };
    const expectedChars = computeSerializedLength(value, 2); // independently computed — no JSON.stringify involved

    const spy = vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new RangeError('Invalid string length');
    });
    try {
      let thrown;
      try {
        serializeJsonProduct('huge-product', value, { indent: 2, limit: 999_999_999 });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ProductTooLargeError);
      expect(thrown.product).toBe('huge-product');
      expect(thrown.requiredChars).toBe(expectedChars);
      expect(thrown.limitChars).toBe(999_999_999);
    } finally {
      spy.mockRestore();
    }
  });

  it('re-throws any error that is not a RangeError untouched (e.g. a circular structure)', () => {
    const circular = {};
    circular.self = circular;
    expect(() => serializeJsonProduct('circular', circular)).toThrow(TypeError);
    expect(() => serializeJsonProduct('circular', circular)).not.toThrow(ProductTooLargeError);
  });

  // F3 (batch A fix): a RangeError whose message is NOT V8's own "the string
  // would exceed the single-string ceiling" message must propagate as-is —
  // most notably "Maximum call stack size exceeded" from a deeply/circularly
  // nested structure, which is a stack-depth problem, not a size problem, and
  // must not be reinterpreted as a fabricated ProductTooLargeError.
  it('a RangeError with an unrelated message (e.g. stack overflow) is re-thrown unchanged, never wrapped', () => {
    const value = { a: 1 };
    const stackOverflow = new RangeError('Maximum call stack size exceeded');
    const spy = vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => { throw stackOverflow; });
    try {
      let thrown;
      try {
        serializeJsonProduct('deeply-nested', value, { indent: 2, limit: 10 });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(stackOverflow); // the exact same error object, untouched
      expect(thrown).not.toBeInstanceOf(ProductTooLargeError);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// createHeadroomRecorder — aggregates chars- and bytes-measured entries,
// sorted by percent of limit descending.
// ---------------------------------------------------------------------------
describe('createHeadroomRecorder', () => {
  it('sorts mixed chars/bytes entries by percentOfLimit descending', () => {
    const recorder = createHeadroomRecorder();
    recorder.recordChars('graph', 100, 1000); // 10%
    recorder.recordBytes('structure-all', 900, 1000); // 90% (sub-process, measured via fs.statSync)
    recorder.recordChars('manifest', 500, 1000); // 50%

    const entries = recorder.entries();
    expect(entries.map((e) => e.product)).toEqual(['structure-all', 'manifest', 'graph']);
    expect(entries[0]).toMatchObject({ product: 'structure-all', bytes: 900, limitChars: 1000, measuredAs: 'bytes' });
    expect(entries[0].percentOfLimit).toBeCloseTo(90, 10);
    expect(entries[1]).toMatchObject({ product: 'manifest', chars: 500, limitChars: 1000, measuredAs: 'chars' });
  });

  it('starts empty', () => {
    expect(createHeadroomRecorder().entries()).toEqual([]);
  });
});
