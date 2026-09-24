import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnClaude } from '../../deploy/run-excavator.mjs';

// Acceptor review finding: an open-but-silent stdin makes `claude -p` wait
// ~3s and print "Warning: no stdin data received in 3s, proceeding without
// it" to stderr on every production run. This is a one-shot, non-interactive
// invocation — nothing is ever piped in — so stdin must be closed outright.
describe('spawnClaude stdin handling', () => {
  it('spawns claude with stdin explicitly ignored (closed), not inherited or left open', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'excavator-spawnclaude-'));
    let capturedOpts = null;

    const spawnFn = (cmd, args, opts) => {
      capturedOpts = opts;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      setImmediate(() => {
        child.stdout.end();
        child.emit('close', 0);
      });
      return child;
    };

    try {
      await spawnClaude({
        claudeBin: 'claude', args: [], cwd: outDir, env: {},
        outDir, timeoutMinutes: 5, graceSeconds: 1, spawnFn,
      });
      expect(Array.isArray(capturedOpts.stdio)).toBe(true);
      expect(capturedOpts.stdio[0]).toBe('ignore');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
