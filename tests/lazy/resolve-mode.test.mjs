// Slice A / Task 3 — analysisMode / --mode resolution contract
// (openspec: changes/lazy-first-run/specs/lazy-analysis).
//
// `resolveMode` is a pure function: no config.json I/O, no argv parsing side
// effects. These tests exercise every scenario named in the spec's
// "analysisMode config and --mode flag" requirement plus the tasks.md checklist:
// default lazy, single-run --mode override (not persisted), --full (forced
// rebuild, not persisted), stored config wins, and the "existing full graph
// not wiped" invariant at the resolveMode level.
import { describe, expect, it } from 'vitest';
import { resolveMode } from '../../skills/excavator/resolve-mode.mjs';

describe('resolveMode — default', () => {
  it('no flags, no stored config: resolves to lazy with no forced rebuild', () => {
    const result = resolveMode({ argv: [], config: {} });
    expect(result.mode).toBe('lazy');
    expect(result.forceRebuild).toBe(false);
  });

  it('bootstraps the explicit default into config.json only for the plain-default case', () => {
    const result = resolveMode({ argv: [], config: {} });
    expect(result.persist).toEqual({ analysisMode: 'lazy' });
  });
});

describe('resolveMode — --mode overrides a single run, never persists', () => {
  it('--mode=full overrides a stored lazy config for this run only', () => {
    const result = resolveMode({ argv: ['--mode=full'], config: { analysisMode: 'lazy' } });
    expect(result.mode).toBe('full');
    expect(result.forceRebuild).toBe(false);
    expect(result.persist).toBeUndefined();
  });

  it('--mode=lazy overrides a stored full config for this run only', () => {
    const result = resolveMode({ argv: ['--mode=lazy'], config: { analysisMode: 'full' } });
    expect(result.mode).toBe('lazy');
    expect(result.forceRebuild).toBe(false);
    expect(result.persist).toBeUndefined();
  });

  it('also accepts the two-token "--mode <value>" form', () => {
    const result = resolveMode({ argv: ['--mode', 'full'], config: {} });
    expect(result.mode).toBe('full');
    expect(result.persist).toBeUndefined();
  });

  it('rejects an unrecognized --mode value instead of silently defaulting', () => {
    expect(() => resolveMode({ argv: ['--mode=bogus'], config: {} })).toThrow(/lazy.*full/i);
  });
});

describe('resolveMode — --full is a forced rebuild, never persisted', () => {
  it('--full resolves to full mode with forceRebuild true', () => {
    const result = resolveMode({ argv: ['--full'], config: { analysisMode: 'lazy' } });
    expect(result.mode).toBe('full');
    expect(result.forceRebuild).toBe(true);
    expect(result.persist).toBeUndefined();
  });

  it('--full takes precedence over an explicit --mode=lazy on the same invocation', () => {
    const result = resolveMode({ argv: ['--mode=lazy', '--full'], config: {} });
    expect(result.mode).toBe('full');
    expect(result.forceRebuild).toBe(true);
  });
});

describe('resolveMode — stored config.json analysisMode wins when no flag is given', () => {
  it('stored full is honored with no forced rebuild', () => {
    const result = resolveMode({ argv: [], config: { analysisMode: 'full' } });
    expect(result.mode).toBe('full');
    expect(result.forceRebuild).toBe(false);
    expect(result.persist).toBeUndefined();
  });

  it('stored lazy is honored and does not re-bootstrap persist (already explicit)', () => {
    const result = resolveMode({ argv: [], config: { analysisMode: 'lazy' } });
    expect(result.mode).toBe('lazy');
    expect(result.forceRebuild).toBe(false);
    expect(result.persist).toBeUndefined();
  });
});

describe('resolveMode — existing full graph not wiped when default is lazy', () => {
  it('never sets a wipe/rebuild signal for a plain lazy default, regardless of what is on disk', () => {
    // resolveMode has no notion of "is there an existing graph" at all — it
    // is a pure function of argv/config, so it structurally cannot special-
    // case that. The invariant this test pins is: forceRebuild is false for
    // the plain-default path, and the return shape carries no OTHER signal
    // that could be read as "wipe/rebuild" by a caller.
    const result = resolveMode({ argv: [], config: {} });
    expect(result.forceRebuild).toBe(false);
    expect(Object.keys(result).sort()).toEqual(['forceRebuild', 'mode', 'persist']);
  });
});
