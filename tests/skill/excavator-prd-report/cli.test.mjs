// prd.mjs help and errors (task 3.3): 0 ok, 1 a check failed, 2 usage or IO.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { FIXTURES, runPrd } from './helpers.mjs';

const COMMANDS = ['entrypoints', 'check-index', 'check-lane', 'check-priorities', 'aggregate', 'assemble', 'page', 'mark', 'reply'];
const MISSING = join(FIXTURES, 'no-such-out');

describe('prd.mjs command line', () => {
  it('prints help naming every command and the exit codes, with exit 0', () => {
    for (const args of [['--help'], ['help'], ['-h'], ['aggregate', '--help']]) {
      const out = runPrd(args);
      expect(out.status, args.join(' ')).toBe(0);
      for (const command of COMMANDS) expect(out.stdout, command).toMatch(new RegExp(`^  ${command} `, 'm'));
      expect(out.stdout).toMatch(/Exit codes: 0 ok; 1 a check failed; 2 usage or IO error/);
    }
  });

  it('exits 2 with the usage for no command and for an unknown one', () => {
    const none = runPrd([]);
    expect(none.status).toBe(2);
    expect(none.stderr).toMatch(/Usage:/);
    const unknown = runPrd(['publish']);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toMatch(/unknown command publish/);
  });

  it('exits 2 and names the directory when <out> does not exist, for every command that reads one', () => {
    for (const args of [['check-index', MISSING], ['check-lane', MISSING, 'F1'], ['check-priorities', MISSING], ['aggregate', MISSING], ['assemble', MISSING], ['page', MISSING], ['mark', MISSING, 'F1', 'dispatched'], ['reply', MISSING]].map((a) => [...a, '--project', FIXTURES])) {
      const out = runPrd(args);
      expect(out.status, args[0]).toBe(2);
      expect(out.stderr, args[0]).toContain(MISSING);
      expect(out.stdout, args[0]).toBe('');
    }
  });

  it('exits 2 for a missing or extra argument and for an unknown option', () => {
    for (const args of [['check-index'], ['check-lane', MISSING], ['check-priorities'], ['check-priorities', 'a', 'b'], ['aggregate'], ['assemble', 'a', 'b'], ['aggregate', MISSING, '--fast', 'x'], ['entrypoints', '.', '--scope']]) {
      const out = runPrd(args);
      expect(out.status, args.join(' ')).toBe(2);
      expect(out.stderr, args.join(' ')).not.toBe('');
    }
  });
});
