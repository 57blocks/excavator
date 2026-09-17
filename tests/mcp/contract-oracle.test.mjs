import { describe, expect, it } from 'vitest';

export const EXPECTED_TOOLS = Object.freeze([
  'project_status',
  'sync_facts',
  'recall',
  'traverse',
  'read_evidence',
  'semantic_plan',
  'semantic_commit',
]);

function assertSevenToolSurface(tools) {
  expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  for (const tool of tools) {
    expect(tool.inputSchema?.type).toBe('object');
  }
}

describe('frozen MCP discovery oracle', () => {
  it('detects an extra model-proxy capability in the known-bad control', () => {
    const knownBad = [
      ...EXPECTED_TOOLS.map((name) => ({ name, inputSchema: { type: 'object' } })),
      { name: 'answer_question', inputSchema: { type: 'object' } },
    ];
    expect(() => assertSevenToolSurface(knownBad)).toThrow();
  });

  it('accepts exactly seven schema-bearing tools; red control injects the bad list', () => {
    const tools = EXPECTED_TOOLS.map((name) => ({ name, inputSchema: { type: 'object' } }));
    if (process.env.EXCAVATOR_ORACLE_BAD === '1') {
      tools.push({ name: 'answer_question', inputSchema: { type: 'object' } });
    }
    assertSevenToolSurface(tools);
  });
});
