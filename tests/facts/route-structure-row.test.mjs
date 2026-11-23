// route-entry-points, task 2.1: a structure row carries the `routes` facts the
// core extractor wrote, a bad shape fails the file the way a bad `jsx` does, and
// a row of a file no rule matched is byte-identical to what it was.
import { beforeAll, describe, expect, it } from 'vitest';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

function row(file, source) {
  const extracted = analyzeFileWithOutcomes(registry, file, source);
  expect(extracted.structureOutcome).toBe('succeeded');
  const lines = source.split('\n');
  return buildResult(file, lines.length, lines.filter((l) => l.trim()).length,
    extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
}

describe('structure row: routes', () => {
  it('passes the facts of a file a rule matched through', () => {
    const file = { path: 'app.js', language: 'javascript', fileCategory: 'code' };
    const result = row(file, [
      "const express = require('express');",
      "const app = express();",
      "const u = require('./routes/u')(passport);",
      "app.use('/u', u);",
      "app.get('/a', h);",
      '',
    ].join('\n'));
    expect(result.routes.sites).toEqual([{
      framework: 'express', form: 'call', line: 5, method: 'GET',
      path: { literal: '/a' }, anchor: { kind: 'root' }, handler: { kind: 'name', text: 'h', line: 5 },
    }]);
    expect(result.routes.mounts).toEqual([{
      framework: 'express', line: 4, path: { literal: '/u' }, anchor: { kind: 'root' },
      target: { kind: 'require', source: './routes/u', called: true },
    }]);
    expect(result.routes.rules).toEqual({ express: { kind: 'http', join: 'append' } });
    expect(result.routes.ignoredMounts).toEqual({});
  });

  it('writes no routes field for a file no rule matched', () => {
    const file = { path: 'src/util.js', language: 'javascript', fileCategory: 'code' };
    const result = row(file, 'export function f() { return 1; }\n');
    expect(result).not.toHaveProperty('routes');
    expect(Object.keys(result)).not.toContain('routes');
  });
});

describe('structure row: routes validation', () => {
  const file = { path: 'app.js', language: 'javascript', fileCategory: 'code' };
  const fake = (structure) => {
    const plugin = { analyzeFileFull: () => ({ structure, callGraph: [] }) };
    return { getPluginForFile: () => plugin, analyzeFileFull: plugin.analyzeFileFull };
  };
  const site = (fields = {}) => ({
    framework: 'express', form: 'call', line: 1, method: 'GET',
    path: { literal: '/a' }, anchor: { kind: 'root' }, handler: null, ...fields,
  });
  const routes = (fields = {}) => ({
    sites: [site()], mounts: [], ignoredMounts: {}, rules: { express: { kind: 'http', join: 'append' } }, ...fields,
  });
  const outcome = (r) => analyzeFileWithOutcomes(
    fake({ functions: [], classes: [], imports: [], exports: [], routes: r }), file, '').structureOutcome;

  it('accepts the shapes the extractor writes', () => {
    expect(outcome(routes())).toBe('succeeded');
    expect(outcome(routes({
      sites: [
        site({ method: null, form: 'element', path: { unresolved: 'own', text: 'base' }, anchor: { kind: 'local', name: 'r' },
          handler: { kind: 'name', text: 'X', line: 1, wrappedBy: 'wrap' } }),
        site({ anchor: { kind: 'parameter', name: 'g', type: '*gin.RouterGroup' }, handler: { kind: 'inline', line: 1, endLine: 3 } }),
        site({ handler: { kind: 'module', source: './x', line: 1 } }),
        site({ handler: { kind: 'other', text: 'a[b]', line: 1 } }),
      ],
      mounts: [{ framework: 'express', line: 2, path: { literal: '/x' }, anchor: { kind: 'root' }, target: { kind: 'binding', name: 'r' } },
        { framework: 'express', line: 2, path: { literal: '/x' }, anchor: { kind: 'root' }, target: { kind: 'require', source: './r', called: false } },
        { framework: 'express', line: 2, path: { literal: '/x' }, anchor: { kind: 'root' }, target: { kind: 'local', name: 'r' } },
        { framework: 'express', line: 2, path: { literal: '/x' }, anchor: { kind: 'root' }, target: { kind: 'other', text: 'x' } }],
      ignoredMounts: { express: 2 },
      exportsValue: { local: 'router', factory: true, line: 9 },
    }))).toBe('succeeded');
  });

  it('rejects a malformed shape the way a bad jsx fails', () => {
    expect(outcome('routes')).toBe('failed');
    expect(outcome(routes({ sites: {} }))).toBe('failed');
    expect(outcome(routes({ mounts: undefined }))).toBe('failed');
    expect(outcome(routes({ ignoredMounts: { express: -1 } }))).toBe('failed');
    expect(outcome(routes({ ignoredMounts: [] }))).toBe('failed');
    expect(outcome(routes({ rules: { express: { kind: 'rpc', join: 'append' } } }))).toBe('failed');
    expect(outcome(routes({ rules: { express: { kind: 'http', join: 'zip' } } }))).toBe('failed');
    expect(outcome(routes({ exportsValue: { local: 'r', factory: 'yes', line: 1 } }))).toBe('failed');
    expect(outcome(routes({ sites: [site({ form: 'tag' })] }))).toBe('failed');
    expect(outcome(routes({ sites: [site({ line: '1' })] }))).toBe('failed');
    expect(outcome(routes({ sites: [site({ method: 3 })] }))).toBe('failed');
    expect(outcome(routes({ sites: [site({ path: { literal: 1 } })] }))).toBe('failed');
    expect(outcome(routes({ sites: [site({ path: { unresolved: 'both', text: 'x' } })] }))).toBe('failed');
    expect(outcome(routes({ sites: [site({ anchor: { kind: 'parameter', name: 'g' } })] }))).toBe('failed');
    expect(outcome(routes({ sites: [site({ anchor: { kind: 'nowhere' } })] }))).toBe('failed');
    expect(outcome(routes({ sites: [site({ handler: { kind: 'name', text: 'h' } })] }))).toBe('failed');
    expect(outcome(routes({ sites: [site({ handler: { kind: 'inline', line: 1 } })] }))).toBe('failed');
    expect(outcome(routes({ sites: [site({ handler: { kind: 'magic' } })] }))).toBe('failed');
    expect(outcome(routes({ mounts: [{ framework: 'express', line: 1, path: { literal: '/' }, anchor: { kind: 'root' }, target: { kind: 'require', source: './r' } }] }))).toBe('failed');
    expect(outcome(routes({ mounts: [{ framework: 'express', line: 1, path: { literal: '/' }, anchor: { kind: 'root' } }] }))).toBe('failed');
  });
});
