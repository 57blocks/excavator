/**
 * Every subagent the product-handbook skill dispatches is a named handbook agent type
 * whose definition lists only the tools its task uses (openspec change
 * handbook-subagent-tools, O1). Without a `tools` key a subagent inherits every tool of
 * the environment, which costs tens of thousands of tokens of startup context.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const skillDir = join(repoRoot, 'skills/excavator-product-handbook');
const agentsDir = join(repoRoot, 'agents');

const EXPECTED_TOOLS = {
  'excavator-handbook-verifier': 'Read, Write',
  'excavator-handbook-priority-judge': 'Read, Write',
  'excavator-handbook-remedy-judge': 'Read, Write',
  'excavator-handbook-topic-judge': 'Read, Write',
  'excavator-handbook-tracer': 'Read, Grep, Glob, Bash, Write',
  'excavator-handbook-writer': 'Read, Grep, Glob, Bash, Write, Edit',
};

function frontmatter(name) {
  const text = readFileSync(join(agentsDir, `${name}.md`), 'utf-8');
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  expect(match, `${name} has frontmatter`).not.toBeNull();
  return match[1];
}

function markdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...markdownFiles(path));
    else if (entry.endsWith('.md')) out.push(path);
  }
  return out;
}

describe('handbook agent definitions list only the tools their task uses', () => {
  it('the set of handbook agents is exactly the expected set', () => {
    const found = readdirSync(agentsDir)
      .filter((f) => /^excavator-handbook-.+\.md$/.test(f))
      .map((f) => f.replace(/\.md$/, ''))
      .sort();
    expect(found).toEqual(Object.keys(EXPECTED_TOOLS).sort());
  });

  for (const [name, tools] of Object.entries(EXPECTED_TOOLS)) {
    it(`${name} has tools: ${tools}, no model, no Agent or Task tool`, () => {
      expect(existsSync(join(agentsDir, `${name}.md`))).toBe(true);
      const fm = frontmatter(name);
      expect(fm).toContain(`name: ${name}`);
      expect(fm.split('\n')).toContain(`tools: ${tools}`);
      expect(fm).not.toMatch(/^model:/m);
      expect(tools.split(', ')).not.toContain('Agent');
      expect(tools.split(', ')).not.toContain('Task');
    });
  }
});

describe('the skill names a handbook agent type at every subagent dispatch', () => {
  const files = markdownFiles(skillDir);
  const typeRe = /excavator-handbook-([a-z-]+)/g;

  it('no skill file mentions general-purpose', () => {
    for (const file of files) expect(readFileSync(file, 'utf-8'), file).not.toContain('general-purpose');
  });

  it('every dispatching line that mentions a subagent, and every Who/Does table row about a subagent, names an existing handbook agent type', () => {
    const missing = [];
    for (const file of files) {
      readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
        const dispatches = /\bdispatch(es)?\b/i.test(line) && /subagent/i.test(line) && !/dispatch no |no subagent/i.test(line);
        const tableRow = /^\| (One|Two) /.test(line) && /subagent/i.test(line);
        if (!dispatches && !tableRow) return;
        const types = [...line.matchAll(typeRe)].map((m) => `excavator-handbook-${m[1]}`);
        const ok = types.length > 0 && types.every((t) => Object.hasOwn(EXPECTED_TOOLS, t));
        if (!ok) missing.push(`${file.slice(repoRoot.length + 1)}:${i + 1}`);
      });
    }
    expect(missing).toEqual([]);
  });
});
