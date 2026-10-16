/**
 * Two prompts that drifted behind the fact graph: the chat skill listed four
 * traversable fact edge types while retrieval follows every type in
 * DETERMINISTIC_EDGE_TYPES, and the architecture analyzer sent every
 * `endpoint` node to the Data layer although a Java route endpoint is owned by
 * the resource class that declares it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DETERMINISTIC_EDGE_TYPES } from '../../../skills/excavator/retrieve.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf-8').replace(/\s+/g, ' ');
const chat = read('skills/excavator-chat/SKILL.md');
const analyzer = read('agents/excavator-architecture-analyzer.md');
const skill = read('skills/excavator/SKILL.md');

describe('chat skill fact edge types', () => {
  it('lists every deterministic edge type for structural questions', () => {
    const list = DETERMINISTIC_EDGE_TYPES.map((type) => `\`${type}\``);
    const expected = `${list.slice(0, -1).join(', ')} and ${list.at(-1)}.`;
    expect(chat).toContain(`grep \`id\` / \`name\` / \`type\` and the fact \`edges\`: ${expected}`);
    expect(chat).toContain('These are the types in `DETERMINISTIC_EDGE_TYPES`');
  });

  it('makes every listed type authoritative and traversable', () => {
    expect(chat).toContain('Fact edges (every type listed above) and `gaps` are authoritative');
    expect(chat).toContain('Only fact edges of the types listed above are traversable');
  });

  it('no longer names a four-type subset', () => {
    expect(chat).not.toMatch(/`(contains|imports|exports|calls)` ?\/ ?`(contains|imports|exports|calls)`/);
    expect(chat).not.toContain('only `contains`/`imports`/`exports`/`calls` are traversable');
  });
});

describe('architecture analyzer endpoint layers', () => {
  it('sends only owner-less endpoints to the Data layer', () => {
    expect(analyzer).toContain('Include `table` and `schema` type nodes, and the `endpoint` nodes that have no `owner`');
    expect(analyzer).toContain('- `table`, `schema` nodes, and `endpoint` nodes without an `owner` → Data layer');
    expect(analyzer).not.toContain('- `table`, `schema`, `endpoint` nodes → Data layer');
    expect(analyzer).not.toContain('Include `table`, `schema`, and `endpoint` type nodes.');
  });

  it('assigns an owned endpoint to the layer of its owner unless an addendum places it', () => {
    expect(analyzer).toContain('Assign each to the layer of its `owner` class, normally the API layer.');
    expect(analyzer).toContain('- `endpoint` nodes with an `owner` → the layer of the owner class (normally the API layer), unless a framework addendum\'s layer table says otherwise');
  });

  it('receives owner on both architecture paths', () => {
    expect(skill).toContain('`{id, type, name, filePath}`, plus `owner` when the node has one');
    expect(skill).toContain('for ALL file-level nodes, plus `owner` when the node has one');
  });
});
