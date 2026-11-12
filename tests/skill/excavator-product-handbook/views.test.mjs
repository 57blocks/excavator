// O1 (views) of openspec change handbook-entities-and-views: `--views` takes
// product, technical or both (any order, no repeats), defaults to product,
// and refuses anything else with the allowed values; assemble, page and
// reply all take it.
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_VIEWS, VIEWS, parseViews } from '../../../skills/excavator-product-handbook/lib/views.mjs';
import { makeCheckedMapRun } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

describe('parseViews', () => {
  it('defaults to the product view when --views is not given', () => {
    expect(DEFAULT_VIEWS).toEqual(['product']);
    expect(parseViews(undefined)).toEqual({ ok: true, views: ['product'] });
  });

  it('accepts one view or both, in any order and with repeats, and returns them in the fixed order', () => {
    expect(VIEWS).toEqual(['product', 'technical']);
    expect(parseViews('product')).toEqual({ ok: true, views: ['product'] });
    expect(parseViews('technical')).toEqual({ ok: true, views: ['technical'] });
    expect(parseViews('product,technical')).toEqual({ ok: true, views: ['product', 'technical'] });
    expect(parseViews('technical,product')).toEqual({ ok: true, views: ['product', 'technical'] });
    expect(parseViews('technical,technical,product')).toEqual({ ok: true, views: ['product', 'technical'] });
    expect(parseViews(' product , technical ')).toEqual({ ok: true, views: ['product', 'technical'] });
  });

  it('refuses any other value and prints the allowed ones', () => {
    for (const bad of ['design', 'product,design', 'Product', '', ',', 'product,', 'product technical']) {
      const result = parseViews(bad);
      expect(result.ok, bad).toBe(false);
      expect(result.lines.join('\n'), bad).toContain('product');
      expect(result.lines.join('\n'), bad).toContain('technical');
    }
    expect(parseViews('product,design').lines[0]).toContain('"design"');
  });
});

describe('--views on the commands', () => {
  for (const command of ['assemble', 'page', 'reply']) {
    it(`${command} exits 1 and prints product and technical for an invalid view, before it reads the run`, () => {
      const run = makeCheckedMapRun();
      cleanups.push(run.cleanup);
      const result = run.run(command, '--views', 'design');
      expect(result.status, result.stdout + result.stderr).toBe(1);
      expect(result.stdout).toContain('product');
      expect(result.stdout).toContain('technical');
      expect(result.stdout).toContain('"design"');
    });
  }

  it('an option the command does not know is still a usage error', () => {
    const run = makeCheckedMapRun();
    cleanups.push(run.cleanup);
    expect(run.run('assemble', '--view', 'product').status).toBe(2);
  });
});
