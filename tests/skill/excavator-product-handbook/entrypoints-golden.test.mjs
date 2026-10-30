// Oracle O4 of openspec change product-handbook-map: the entrypoint lister
// moved out of the PRD report skill, and that skill's `entrypoints` command
// must print the same bytes as before the move. The golden files were
// captured from the code before the move; the only edit is that the absolute
// project root, which differs per machine, is written as <ROOT>.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIXTURES, graphHeaderLine, makeTempDir, runPrd } from '../excavator-prd-report/helpers.mjs';

const GOLDEN = join(resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/product-handbook/entrypoints-golden'));
const golden = (name) => readFileSync(join(GOLDEN, name), 'utf-8');

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function entrypointsOutput(root, extra = []) {
  const out = runPrd(['entrypoints', root, ...extra]);
  expect(out.status, out.stderr).toBe(0);
  return out.stdout.split(root).join('<ROOT>');
}

describe('prd entrypoints output is byte-identical to the pre-move golden (O4)', () => {
  it.each([
    ['express-app', [], 'express-app.json'],
    ['gin-service', [], 'gin-service.json'],
    ['react-web', [], 'react-web.json'],
    ['express-app', ['--scope', 'src/routes'], 'express-app-scoped.json'],
  ])('fixture %s %j', (fixture, extra, file) => {
    const root = join(FIXTURES, fixture);
    // The command prints the realpath of the root; the fixture path is already one.
    expect(entrypointsOutput(root, extra)).toBe(golden(file));
  });

  it('matches when the frameworks come from a knowledge-graph header', () => {
    const dir = makeTempDir();
    cleanups.push(dir.cleanup);
    mkdirSync(join(dir.root, '.excavator'), { recursive: true });
    mkdirSync(join(dir.root, 'src/router'), { recursive: true });
    writeFileSync(join(dir.root, '.excavator/knowledge-graph.jsonl'), `${graphHeaderLine(['react-router'])}\n`);
    writeFileSync(join(dir.root, 'src/router/index.tsx'), "export const routes = [{ path: '/orders' }];\n");
    expect(entrypointsOutput(dir.root)).toBe(golden('graph-header-react-router.json'));
  });

  it('keeps format as the first key, stamped by the command', () => {
    const out = runPrd(['entrypoints', join(FIXTURES, 'express-app')]);
    expect(Object.keys(out.json)[0]).toBe('format');
    expect(out.json.format).toBe('excavator-prd-report-entrypoints/1');
  });
});
