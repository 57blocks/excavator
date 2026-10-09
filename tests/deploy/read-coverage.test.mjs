import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeReadCoverage, measureReadCoverage, parseRunEvents } from '../../deploy/read-coverage.mjs';

const FILES = new Map([
  ['src/a/Alpha.java', 100],
  ['src/a/Beta.java', 50],
  ['src/b/Gamma.java', 40],
  ['docs/readme.txt', 10],
]);

let nextId = 0;
/** One assistant tool_use event plus the user tool_result event that answers it. */
function call(name, input, output) {
  nextId += 1;
  const id = `toolu_${nextId}`;
  return [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: output }] } },
  ];
}

const numbered = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${String(from + i).padStart(6)}\tline`).join('\n');

function coverage(events, scopePrefixes = []) {
  return computeReadCoverage({ events, files: FILES, aliases: ['/repo'], scopePrefixes });
}

describe('computeReadCoverage', () => {
  it('counts the numbered lines a Read call returned, in both bounds', () => {
    const result = coverage(call('Read', { file_path: '/repo/src/a/Alpha.java' }, numbered(1, 30)));
    expect(result.lower.lines).toBe(30);
    expect(result.upper.lines).toBe(30);
    expect(result.lower.files).toBe(1);
  });

  it('counts an unpiped sed range in both bounds and a piped one only in the upper bound', () => {
    const plain = coverage(call('Bash', { command: "sed -n '10,19p' src/a/Alpha.java" }, 'x'));
    expect(plain.lower.lines).toBe(10);
    expect(plain.upper.lines).toBe(10);

    const piped = coverage(call('Bash', { command: 'sed -n 10,19p src/a/Alpha.java | grep -v "^$"' }, 'x'));
    expect(piped.lower.lines).toBe(0);
    expect(piped.upper.lines).toBe(10);
  });

  it('resolves relative paths against cd, including an absolute cd into the repo alias', () => {
    const events = [
      ...call('Bash', { command: 'cd /repo/src/a; sed -n 1,5p Beta.java' }, 'x'),
      ...call('Bash', { command: 'cd /work/repo && cd src/b && sed -n 1,4p Gamma.java' }, 'x'),
    ];
    const result = coverage(events);
    expect(result.lower.lines).toBe(9);
    expect(result.lower.files).toBe(2);
  });

  it('does not attribute relative paths after cd leaves the repository', () => {
    const result = coverage(call('Bash', { command: 'cd /tmp; sed -n 1,5p Beta.java' }, 'x'));
    expect(result.upper.lines).toBe(0);
  });

  it('counts path:line hits from grep -n output', () => {
    const output = 'src/a/Alpha.java:12:    foo();\nsrc/b/Gamma.java:3-  bar\nnot a hit';
    const result = coverage(call('Bash', { command: 'grep -rn foo src' }, output));
    expect(result.lower.lines).toBe(2);
    expect(result.lower.files).toBe(2);
  });

  it('counts cat as the whole file in both bounds; cat -n | sed and awk NR only in the upper bound', () => {
    const cat = coverage(call('Bash', { command: 'cat src/a/Beta.java' }, 'x'));
    expect(cat.lower.lines).toBe(50);
    const catSed = coverage(call('Bash', { command: 'cat -n src/a/Alpha.java | sed -n 20,29p' }, 'x'));
    expect(catSed.lower.lines).toBe(0);
    expect(catSed.upper.lines).toBe(10);
    const awk = coverage(call('Bash', { command: "awk '{print NR\": \"$0}' src/b/Gamma.java" }, 'x'));
    expect(awk.lower.lines).toBe(0);
    expect(awk.upper.lines).toBe(40);
  });

  it('counts read_evidence ranges; without an end line only the upper bound gets the default span', () => {
    const bounded = coverage(call('mcp__plugin_excavator_excavator__read_evidence', { path: 'src/a/Alpha.java', startLine: 5, endLine: 14 }, '{}'));
    expect(bounded.lower.lines).toBe(10);
    const open = coverage(call('mcp__plugin_excavator_excavator__read_evidence', { path: 'src/a/Alpha.java', startLine: 91 }, '{}'));
    expect(open.lower.lines).toBe(1);
    expect(open.upper.lines).toBe(10); // capped at the file's 100 lines
  });

  it('de-duplicates overlapping reads of the same lines', () => {
    const events = [
      ...call('Read', { file_path: 'src/a/Alpha.java' }, numbered(1, 20)),
      ...call('Bash', { command: 'sed -n 11,30p src/a/Alpha.java' }, 'x'),
    ];
    expect(coverage(events).lower.lines).toBe(30);
  });

  it('ignores files outside the repository and untracked paths', () => {
    const events = [
      ...call('Read', { file_path: '/etc/hosts' }, numbered(1, 5)),
      ...call('Bash', { command: 'sed -n 1,5p src/a/Missing.java' }, 'x'),
    ];
    expect(coverage(events).upper.lines).toBe(0);
  });

  it('splits reads into scope and outside scope and reports the scope size and percentage', () => {
    const events = [
      ...call('Bash', { command: 'sed -n 1,50p src/a/Alpha.java' }, 'x'),
      ...call('Bash', { command: 'sed -n 1,20p src/b/Gamma.java' }, 'x'),
    ];
    const result = coverage(events, ['src/a/']);
    expect(result.scope).toEqual({ prefixes: ['src/a/'], files: 2, lines: 150 });
    expect(result.lower.lines).toBe(50);
    expect(result.lower.percentOfScope).toBe(33.3);
    expect(result.lower.outsideScope).toEqual({ files: 1, lines: 20 });
  });
});

describe('parseRunEvents', () => {
  it('keeps JSON object lines and skips the rest', () => {
    expect(parseRunEvents('{"type":"a"}\nnot json\n\n{"type":"b"}\n')).toEqual([{ type: 'a' }, { type: 'b' }]);
  });
});

describe('measureReadCoverage', () => {
  it('measures a run against a real Git repository, mapping its path and the /work/repo alias', () => {
    const repo = mkdtempSync(join(tmpdir(), 'read-coverage-'));
    try {
      mkdirSync(join(repo, 'src'));
      writeFileSync(join(repo, 'src', 'Main.java'), Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
      writeFileSync(join(repo, 'blob.bin'), Buffer.from([0, 1, 2, 0, 3]));
      const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
      git('init', '-q');
      git('add', '-A');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');

      const raw = [
        ...call('Read', { file_path: '/work/repo/src/Main.java' }, numbered(1, 3)),
        ...call('Bash', { command: `sed -n 5,6p ${join(repo, 'src', 'Main.java')}` }, 'x'),
      ].map((event) => JSON.stringify(event)).join('\n');
      const result = measureReadCoverage({ rawEvents: raw, repoRoot: repo });
      expect(result.scope.files).toBe(1); // the binary file is skipped
      expect(result.scope.lines).toBe(12);
      expect(result.lower.lines).toBe(5);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
