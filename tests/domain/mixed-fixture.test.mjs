/**
 * The mixed-directory measurement fixture keeps the premise its before/after
 * numbers rest on: one legacy routes directory, one legacy services
 * directory and one jobs directory each hold every business area side by
 * side, each business area also has a clean module, and the ground truth
 * names the area of every file in the mixed directories.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLazy } from './helpers/facts.mjs';
import {
  AREA_MODULES, MIXED_AREAS, MIXED_DIRECTORIES, MIXED_FILE_AREAS, NON_BUSINESS_FILES, writeMixedLegacyProject,
} from '../fixtures/domain-areas/mixed-legacy.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXTRACT = resolve(repoRoot, 'skills/excavator-domain/extract-domain-context.py');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe('mixed legacy fixture', () => {
  it('is deterministic, and every mixed directory holds entry points of several areas', () => {
    const a = mkdtempSync(join(tmpdir(), 'domain-mixed-'));
    const b = mkdtempSync(join(tmpdir(), 'domain-mixed-'));
    roots.push(a, b);
    const files = writeMixedLegacyProject(a);
    expect(writeMixedLegacyProject(b)).toEqual(files);
    for (const file of files) expect(readFileSync(join(b, file), 'utf-8')).toBe(readFileSync(join(a, file), 'utf-8'));

    for (const file of [...Object.keys(MIXED_FILE_AREAS), ...NON_BUSINESS_FILES]) expect(files, file).toContain(file);
    for (const module of Object.values(AREA_MODULES)) expect(files.some((f) => f.startsWith(`${module}/`)), module).toBe(true);

    runLazy(a);
    const result = spawnSync('python3', [EXTRACT, a], { encoding: 'utf-8' });
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    const context = JSON.parse(readFileSync(join(a, '.excavator/intermediate/domain-context.json'), 'utf-8'));
    const areasWithEntries = (dir) => new Set(context.entryPoints
      .filter((e) => dirname(e.file) === dir && MIXED_FILE_AREAS[e.file])
      .map((e) => MIXED_FILE_AREAS[e.file]));
    expect(areasWithEntries('services/legacy/routes').size).toBe(MIXED_AREAS.length);
    expect(areasWithEntries('services/jobs/cmd').size).toBe(MIXED_AREAS.length);
    expect(areasWithEntries('services/legacy/services').size).toBeGreaterThanOrEqual(2);
    expect(MIXED_DIRECTORIES).toHaveLength(3);
    for (const file of NON_BUSINESS_FILES) expect(context.entryPoints.some((e) => e.file === file), file).toBe(true);
  });
});
