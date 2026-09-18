import { describe, expect, it } from 'vitest';
import { PluginRegistry, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';

describe('XAML extraction to fact-graph projection', () => {
  it('keeps a live concept and never projects a commented command as a fact', () => {
    const content = [
      '<ContentPage x:Class="Demo.Page" x:DataType="vm:Page">',
      '  <!-- <Button Command="{Binding CommentedCommand}" /> -->',
      '  <Label Text="{Binding LiveTitle}" />',
      '</ContentPage>',
    ].join('\n');
    const file = {
      path: 'views/page.xaml',
      language: 'xaml',
      fileCategory: 'markup',
      sizeLines: 4,
    };
    const registry = new PluginRegistry();
    registerAllParsers(registry);
    const extracted = analyzeFileWithOutcomes(registry, file, content);
    expect(extracted.structureOutcome).toBe('succeeded');
    expect(extracted.analysis.definitions.some((d) => d.name === 'LiveTitle')).toBe(true);

    const row = buildResult(file, 4, 4, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
    const graph = buildFactGraph({
      scan: { files: [file], skipped: [], coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } } },
      structureAll: { results: [row] },
      importMap: null,
    });
    expect(graph.nodes.some((node) => node.name === 'LiveTitle')).toBe(true);
    expect(graph.nodes.some((node) => node.name === 'CommentedCommand')).toBe(false);
    expect(graph.gaps).toEqual([]);
  });
});
