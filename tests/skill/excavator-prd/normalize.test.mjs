// The passage normalization of check-lane is doc-map's (task 2.3): this test
// runs both on the same strings and compares the compared text and the
// origin of every character. Every non-ASCII character here is built from
// its code point, so the file holds none.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { findOnce, normalize } from '../../../skills/excavator-prd/lib/normalize.mjs';
import { repoRoot } from './helpers.mjs';

const cp = (...points) => String.fromCodePoint(...points);

const SAMPLES = [
  `He said ${cp(0x201c)}stop${cp(0x201d)} ${cp(0x2014)} then left${cp(0x2026)}`,
  `it${cp(0x2019)}s ${cp(0x2018)}quoted${cp(0x2019)} and ${cp(0x2032)}prime${cp(0x2033)}`,
  `soft${cp(0x00ad)}hyphen zero${cp(0x200b)}width${cp(0x200c)}${cp(0x200d)} joiner${cp(0x2060)} bom${cp(0xfeff)}`,
  `non${cp(0x00a0)}breaking\t\ttabs\n\n  and   runs   `,
  `   leading and trailing   `,
  `full${cp(0xff07)}width${cp(0xff07)} ${cp(0xff21, 0xff22, 0xff23)} ${cp(0xff08)}x${cp(0xff09)}`,
  `cafe${cp(0x0301)} and caf${cp(0x00e9)} and ${cp(0xfb01)}le`,
  `minus ${cp(0x2212)}1 and ${cp(0x2010)}${cp(0x2011)}${cp(0x2012)}${cp(0x2013)}${cp(0x2015)}`,
  `sep${cp(0x1c)}${cp(0x1d)}fs ${cp(0x2028)}ls ${cp(0x3000)}ideographic`,
  `Case Is Kept`,
];

/** doc-map.py's normalize, run by the host's python3 on the same strings. */
function pythonNormalize(samples) {
  const script = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("doc_map", ${JSON.stringify(join(repoRoot, 'skills/excavator/doc-map.py'))})`,
    'mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)',
    'print(json.dumps([list(mod.normalize(s)) for s in json.load(sys.stdin)]))',
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-I', '-c', script], { input: JSON.stringify(samples), encoding: 'utf-8' }));
}

describe('passage normalization', () => {
  it('gives the text and origins doc-map.py gives', () => {
    const python = pythonNormalize(SAMPLES);
    SAMPLES.forEach((sample, index) => {
      const ours = normalize(sample);
      expect(ours.text, JSON.stringify(sample)).toBe(python[index][0]);
      // Every sample is in the Basic Multilingual Plane, so code-unit and code-point origins agree.
      expect(ours.starts, JSON.stringify(sample)).toEqual(python[index][1]);
    });
  });

  it('finds a passage once and reports its 1-based line, or how often it occurs', () => {
    const file = 'one\ntwo = "a";\nthree\ntwo = "a";\nfour = ' + cp(0x201c) + 'b' + cp(0x201d) + ';\n';
    expect(findOnce(file, 'three')).toEqual({ count: 1, line: 3 });
    expect(findOnce(file, 'two = "a";')).toEqual({ count: 2, line: null });
    expect(findOnce(file, 'four = "b";')).toEqual({ count: 1, line: 5 });
    expect(findOnce(file, 'three two')).toEqual({ count: 1, line: 3 });
    expect(findOnce(file, 'five')).toEqual({ count: 0, line: null });
    expect(findOnce(file, '   ')).toEqual({ count: 0, line: null });
  });
});
