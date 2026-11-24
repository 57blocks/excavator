/**
 * The /excavator-relations skill runs the scripts in order, dispatches one
 * analyzer per area with only three paths, never writes a product itself,
 * and names no model.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './fixture.mjs';

const skill = readFileSync(resolve(repoRoot, 'skills/excavator-relations/SKILL.md'), 'utf-8');
const agent = readFileSync(resolve(repoRoot, 'agents/excavator-relations-analyzer.md'), 'utf-8');
const MODEL_NAMES = /\b(?:opus|sonnet|haiku|fable|gpt-?\d|gemini|claude-[a-z0-9-]+)\b/i;

describe('/excavator-relations skill', () => {
  it('runs units, areas and merge in order from the plugin root', () => {
    const steps = [
      'node "$PLUGIN_ROOT/skills/excavator-relations/plan-units.mjs" "$PROJECT_ROOT"',
      'node "$PLUGIN_ROOT/skills/excavator-relations/split-relation-areas.mjs" "$PROJECT_ROOT"',
      'node "$PLUGIN_ROOT/skills/excavator-relations/merge-relations.mjs" "$PROJECT_ROOT"',
    ].map((command) => skill.indexOf(command));
    expect(steps.every((i) => i > 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(skill).toContain('node "$PLUGIN_ROOT/skills/excavator-relations/relations-freshness.mjs" "$PROJECT_ROOT"');
    expect(skill).toContain('--graph "$DATA_DIR/knowledge-graph.jsonl"');
  });

  it('dispatches one analyzer per area with only its paths, and handles exits 3 and 4', () => {
    expect(skill).toMatch(/one subagent per area/i);
    expect(skill).toContain('$PLUGIN_ROOT/agents/excavator-relations-analyzer.md');
    expect(skill).toMatch(/Give each one only: the project root, the path of its area's context file and the path of its output file/);
    expect(skill).toMatch(/in the foreground/);
    expect(skill).toMatch(/Exit 4[^\n]*\n?[^\n]*\*\*STOP\*\*/);
    expect(skill).toMatch(/Exit 3[^\n]*fresh subagent once/);
    expect(skill).toContain('Never write, copy or edit an area\'s output, the relations graph or the coverage report yourself.');
    expect(skill).toContain('silent-zero');
    expect(skill).toContain('quote-failed');
  });

  it('keeps the reply language rule and names no model', () => {
    expect(skill).toContain('`$LANGUAGE` is English unless `--language` gives another.');
    expect(skill).not.toMatch(MODEL_NAMES);
    expect(agent).not.toMatch(MODEL_NAMES);
  });
});

describe('relations analyzer prompt', () => {
  it('asks for quoted ends, one side only, and the run token', () => {
    expect(agent).toMatch(/^---\nname: excavator-relations-analyzer\n/);
    expect(agent).toContain('copy it into your output unchanged');
    expect(agent).toContain('You write only the ends that are in your files.');
    expect(agent).toMatch(/Never write an end you did not read, never guess/);
    expect(agent).toContain('"unresolved"');
    expect(agent).toContain('skippedFiles');
    expect(agent).toContain('outOfScope');
    for (const kind of ['`http`', '`rpc`', '`message`', '`realtime`', '`external`']) expect(agent).toContain(kind);
  });

  it('runs the self-check before finishing and never edits an address to pass it', () => {
    expect(agent).toContain('## Check before you finish');
    expect(agent).toContain('run the `check` command exactly as given');
    expect(agent).toContain('Never drop a word from an address');
    expect(agent).toMatch(/after three runs, stop/);
  });

  it('asks the analyzer to account for every call line, and never to write an end only to account for one', () => {
    expect(agent).toContain('## Call lines');
    expect(agent).toContain('`callLines` is a floor, not the list of relations.');
    expect(agent).toContain('Never write an end only to account for a line');
    expect(agent).toContain('"skippedLines"');
    expect(agent).toContain('`unaccounted <file>:<line> <pattern>: <text>`');
    expect(skill).toContain('the `unaccounted` call lines');
    expect(skill).toMatch(/never a relation by itself/);
  });

  it('asks for the service or its host, never a library, as an external name, and explains the notices', () => {
    expect(agent).toContain('never the library that carries the call');
    expect(agent).toContain('your `name` is kept only as a label');
    expect(agent).toContain('`transport-name`');
    expect(agent).toContain('`host-not-quoted`');
    expect(skill).toContain('`external-services.json`');
    expect(skill).toMatch(/`key-mismatch`.*`previous-only`.*`current-only`/);
  });
});
