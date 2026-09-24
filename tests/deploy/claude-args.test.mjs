import { describe, expect, it } from 'vitest';

import { buildClaudeArgs } from '../../deploy/run-excavator.mjs';

const COMMON = Object.freeze({
  repoPath: '/work/repo',
  pluginDir: '/opt/excavator',
  model: 'eu.anthropic.claude-sonnet-5',
  maxBudgetUsd: 5,
});

// The exact argument list from design.md D3. Any drift here must be a
// deliberate, reviewed change to the design, not an accidental refactor.
function expectedArgs(promptModeFlag) {
  return [
    '-p', `/excavator:excavator /work/repo ${promptModeFlag}`,
    '--plugin-dir', '/opt/excavator',
    '--setting-sources', 'user',
    '--settings', '{"disableAllHooks": true}',
    '--model', 'eu.anthropic.claude-sonnet-5',
    '--permission-mode', 'bypassPermissions',
    '--permission-prompts', 'none',
    '--max-budget-usd', '5',
    '--no-session-persistence',
    '--output-format', 'stream-json',
    '--verbose',
  ];
}

describe('buildClaudeArgs (design D3, task 2.5)', () => {
  it('equals the D3 argument set exactly for the --mode=full case', () => {
    const args = buildClaudeArgs({ ...COMMON, fullFlagArg: '--mode=full' });
    expect(args).toEqual(expectedArgs('--mode=full'));
  });

  it('equals the D3 argument set exactly for the --full (no existing product) case', () => {
    const args = buildClaudeArgs({ ...COMMON, fullFlagArg: '--full' });
    expect(args).toEqual(expectedArgs('--full'));
  });

  it('equals the D3 argument set exactly for the --full (forced) case', () => {
    const args = buildClaudeArgs({ ...COMMON, fullFlagArg: '--full' });
    expect(args).toEqual(expectedArgs('--full'));
  });

  it('never contains --bare, in any of the three cases', () => {
    for (const flag of ['--mode=full', '--full']) {
      const args = buildClaudeArgs({ ...COMMON, fullFlagArg: flag });
      expect(args).not.toContain('--bare');
      expect(args.join(' ')).not.toMatch(/--bare/);
    }
  });
});
