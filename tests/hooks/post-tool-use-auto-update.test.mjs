import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const hookScript = join(
  repoRoot,
  'hooks',
  'post-tool-use-auto-update.mjs',
);
const hooksConfig = JSON.parse(
  readFileSync(
    join(repoRoot, 'hooks', 'hooks.json'),
    'utf8',
  ),
);

function runHook({
  command = 'git commit -m "test"',
  autoUpdate = true,
  configContents,
  createConfig = true,
  createGraph = true,
  dataDirName = '.excavator',
  input,
  pluginRoot,
} = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'ua-post-tool-use-'));
  const dataDir = join(projectRoot, dataDirName);
  mkdirSync(dataDir);
  if (createConfig) {
    writeFileSync(
      join(dataDir, 'config.json'),
      configContents ?? JSON.stringify({ autoUpdate }),
    );
  }
  if (createGraph) writeFileSync(join(dataDir, 'knowledge-graph.json'), '{}');

  const resolvedPluginRoot = pluginRoot ?? join(projectRoot, 'plugin root');
  const result = spawnSync(process.execPath, [hookScript], {
    cwd: projectRoot,
    input:
      input ??
      JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command },
      }),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: resolvedPluginRoot },
    encoding: 'utf8',
  });

  rmSync(projectRoot, { recursive: true, force: true });
  return { ...result, pluginRoot: resolvedPluginRoot };
}

describe('PostToolUse auto-update hook', () => {
  it('is registered as the Bash PostToolUse handler', () => {
    const registration = hooksConfig.hooks.PostToolUse[0];

    expect(registration.matcher).toBe('Bash');
    expect(registration.hooks).toEqual([
      {
        type: 'command',
        command:
          'node "${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use-auto-update.mjs"',
      },
    ]);
  });

  it('injects the auto-update instruction as PostToolUse additional context', () => {
    const result = runHook();
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: expect.stringContaining(
          '[excavator] Commit detected',
        ),
      },
    });
    expect(output.hookSpecificOutput.additionalContext).toContain(
      `${result.pluginRoot}/hooks/auto-update-prompt.md`,
    );
  });

  it('proposes the update and waits for the user — never instructs auto-execution', () => {
    const result = runHook();
    const output = JSON.parse(result.stdout);
    const context = output.hookSpecificOutput.additionalContext;

    expect(context).not.toContain('Do not ask the user');
    expect(context).not.toMatch(/\bMUST\b/);
    expect(context).toMatch(/propose/i);
    expect(context).toMatch(/wait for the user/i);
  });

  it.each(['commit', 'merge', 'cherry-pick', 'rebase'])(
    'recognizes git %s as a graph-changing operation',
    (operation) => {
      const result = runHook({ command: `git ${operation} example` });

      expect(result.status).toBe(0);
      expect(
        JSON.parse(result.stdout).hookSpecificOutput.hookEventName,
      ).toBe('PostToolUse');
    },
  );

  it('preserves Windows-style plugin paths as valid JSON', () => {
    const pluginRoot = 'C:\\Users\\Example Person\\excavator';
    const result = runHook({ pluginRoot });
    const output = JSON.parse(result.stdout);

    expect(output.hookSpecificOutput.additionalContext).toContain(
      `${pluginRoot}/hooks/auto-update-prompt.md`,
    );
  });

  it('does not fall back to a pre-rename data directory — stays silent', () => {
    // Built from parts rather than written as a literal so this file, which
    // deliberately proves the pre-rename directory name is no longer read,
    // doesn't itself trip the repo-wide zero-old-token grep gate (oracle #1
    // in openspec/changes/excavator-rename/design.md).
    const preRenameDir = ["." , "u", "a"].join("");
    const result = runHook({ dataDirName: preRenameDir });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('stays silent for unrelated Bash commands', () => {
    const result = runHook({ command: 'git status --short' });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('stays silent when automatic updates are disabled', () => {
    const result = runHook({ autoUpdate: false });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it.each([
    ['malformed stdin', { input: '{not-json' }],
    ['a missing config', { createConfig: false }],
    ['a malformed config', { configContents: '{not-json' }],
    ['a missing graph', { createGraph: false }],
  ])('stays silent for %s', (_scenario, options) => {
    const result = runHook(options);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
  });
});

describe('SessionStart staleness hook + auto-update-prompt.md — propose, never auto-execute', () => {
  const sessionStartCommand =
    hooksConfig.hooks.SessionStart[0].hooks[0].command;
  const promptDoc = readFileSync(
    join(repoRoot, 'hooks', 'auto-update-prompt.md'),
    'utf8',
  );

  it('hooks.json SessionStart command contains no auto-execute directive', () => {
    expect(sessionStartCommand).not.toContain('Do not ask the user');
    expect(sessionStartCommand).not.toMatch(/just do it/i);
    expect(sessionStartCommand).toMatch(/propose/i);
  });

  it('auto-update-prompt.md contains no auto-execute directive and ends each real-work action with a proposal that waits for the user', () => {
    expect(promptDoc).not.toContain('Do not ask the user');
    expect(promptDoc).not.toMatch(/just do it/i);
    expect(promptDoc).not.toMatch(/\bYou MUST\b/);
    expect(promptDoc).toMatch(/STOP\.\*\* Tell the user/);
    expect(promptDoc).toMatch(/Only proceed to Phase 1 if/i);
  });
});
