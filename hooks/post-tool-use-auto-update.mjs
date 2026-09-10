import { existsSync, readFileSync } from 'node:fs';

const COMMIT_COMMAND = /git\s+(commit|merge|cherry-pick|rebase)/;

const DATA_DIR = '.excavator';

function autoUpdateEnabled(dataDir) {
  try {
    const config = JSON.parse(readFileSync(`${dataDir}/config.json`, 'utf8'));
    return config.autoUpdate === true;
  } catch {
    return false;
  }
}

async function readStdin() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return;
  }

  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || !COMMIT_COMMAND.test(command)) return;

  const dataDir = DATA_DIR;
  if (!autoUpdateEnabled(dataDir)) return;
  if (!existsSync(`${dataDir}/knowledge-graph.json`)) return;

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? '';
  const additionalContext =
    `[excavator] Commit detected with auto-update enabled. ` +
    `Read the file at ${pluginRoot}/hooks/auto-update-prompt.md, follow its ` +
    'instructions to detect what structurally changed, and propose ' +
    'incrementally updating the knowledge graph to the user with a summary ' +
    'of the detected changes. Wait for the user\'s decision before updating it.';

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext,
      },
    }),
  );
}

await main();
