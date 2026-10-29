/**
 * `bufferLines` (skills/excavator/jsonl-lines.mjs): the lines of a Buffer are exactly the segments
 * `toString('utf-8').split('\n')` gives, and no string of the whole buffer is ever made.
 */

import { describe, expect, it } from 'vitest';

import { bufferLines } from '../../../skills/excavator/jsonl-lines.mjs';

const EACUTE = String.fromCharCode(0xe9);
const CJK = String.fromCharCode(0x4e2d, 0x6587);
const EMOJI = String.fromCharCode(0xd83d, 0xde00);

const INPUTS = {
  'no trailing newline': 'one\ntwo\nthree',
  'trailing newline': 'one\ntwo\n',
  'a single line': 'only',
  'a single newline': '\n',
  'crlf endings': 'one\r\ntwo\r\n',
  'a lone carriage return at the end': 'one\ntwo\r',
  'empty lines in the middle': 'one\n\n\ntwo\n',
  'leading empty line': '\none',
  'multibyte characters next to the newlines': `${EACUTE}\n${CJK}\n${EMOJI}${EMOJI}\n${EMOJI}`,
  'a json record per line': '{"a":1}\n{"b":"x y"}\n',
  'empty': '',
};

describe('bufferLines', () => {
  it.each(Object.entries(INPUTS))('gives the lines split("\\n") gives: %s', (_name, text) => {
    expect([...bufferLines(Buffer.from(text, 'utf-8'))]).toEqual(text.split('\n'));
  });

  it('gives one empty line for an empty buffer', () => {
    expect([...bufferLines(Buffer.alloc(0))]).toEqual(['']);
  });

  it('is lazy: a consumer that stops early decodes only the lines it took', () => {
    const decoded = [];
    const bytes = Buffer.from('a\nb\nc\n', 'utf-8');
    const original = bytes.toString.bind(bytes);
    bytes.toString = (...args) => {
      decoded.push(args);
      return original(...args);
    };
    const first = bufferLines(bytes).next().value;
    expect(first).toBe('a');
    expect(decoded).toEqual([['utf-8', 0, 1]]);
  });

  it('never decodes the whole buffer in one call', () => {
    const bytes = Buffer.from(`${EACUTE}\n${CJK}\n\nlast`, 'utf-8');
    const original = bytes.toString.bind(bytes);
    const calls = [];
    bytes.toString = (encoding, start, end) => {
      calls.push([start ?? 0, end ?? bytes.length]);
      return original(encoding, start, end);
    };
    [...bufferLines(bytes)];
    expect(calls.length).toBe(4);
    expect(calls.every(([start, end]) => end - start < bytes.length)).toBe(true);
  });
});
