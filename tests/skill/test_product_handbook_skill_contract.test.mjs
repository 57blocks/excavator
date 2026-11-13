/**
 * The contract of the product-handbook skill text (openspec change handbook-skill-first, oracle O5): every
 * subagent is the writer, the cross chapters never get the project to read, every command the text runs
 * exists, the section names agree with the script, the text names none of the removed structured files,
 * and every chapter prompt carries the same rules on citations, form and the final check.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SECTIONS } from '../../skills/excavator-product-handbook/lib/sections.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const skillDir = join(repoRoot, 'skills/excavator-product-handbook');
const read = (path) => readFileSync(join(skillDir, path), 'utf-8');

function markdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...markdownFiles(path));
    else if (entry.endsWith('.md')) out.push(relative(skillDir, path));
  }
  return out.sort();
}

const FILES = markdownFiles(skillDir);
const TEXT = Object.fromEntries(FILES.map((file) => [file, read(file)]));

/** The fenced ````text blocks of a file: the prompts it gives subagents. */
const prompts = (text) => Array.from(text.matchAll(/````text\n([\s\S]*?)\n````/g), (match) => match[1]);

/** The command names of handbook.mjs, from its COMMANDS table. */
function commandNames() {
  const source = readFileSync(join(skillDir, 'handbook.mjs'), 'utf-8');
  const table = source.slice(source.indexOf('const COMMANDS = {'));
  return new Set(Array.from(table.matchAll(/^ {2}(?:async )?'?([a-z][a-z-]*)'?\(args\)/gm), (match) => match[1]));
}

describe('the phase files', () => {
  it('are exactly the files the sections table and SKILL.md use', () => {
    expect(FILES).toEqual(['SKILL.md', 'sections/cross.md', 'sections/data.md', 'sections/features.md', 'sections/history.md', 'sections/remedies.md', 'sections/review.md', 'sections/system.md', 'stages/cross-prompt.md', 'stages/map.md', 'stages/outline.md']);
  });

  it('are ASCII only', () => {
    for (const [file, text] of Object.entries(TEXT)) {
      const bad = text.split('\n').findIndex((line) => /[^\x09\x20-\x7e]/.test(line));
      expect(bad, `${file}:${bad + 1}`).toBe(-1);
    }
  });

  it('number their phases once each, and every phase a text points to exists', () => {
    const headings = Object.values(TEXT).flatMap((text) => Array.from(text.matchAll(/^## Phase (\d+):/gm), (match) => Number(match[1])));
    expect([...headings].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const [file, text] of Object.entries(TEXT)) {
      for (const match of text.matchAll(/\bPhases? (\d+)\b/g)) expect(headings, `${file}: Phase ${match[1]}`).toContain(Number(match[1]));
    }
  });

  it('name none of the structured files and commands of the earlier version', () => {
    const removed = [/entries\/<id>\.json/, /entries\/overview\.json/, /\.findings\.json/, /findings\.json/, /architecture\.json/, /priority\//, /topics\//, /\btry-[a-z]/, /check-(entry|findings|overview|priority|remedies|topics|domains|domain-flows|outline|architecture|chapter|system-findings)\b/, /\bmark "\$OUT"/, /AFTER_TRACE/, /outline-facts/];
    for (const [file, text] of Object.entries(TEXT)) for (const pattern of removed) expect(text, `${file} ${pattern}`).not.toMatch(pattern);
  });
});

describe('the commands', () => {
  it('every handbook.mjs command the text runs is in the command table', () => {
    const names = commandNames();
    for (const [file, text] of Object.entries(TEXT)) {
      for (const match of text.matchAll(/handbook\.mjs" ([a-z][a-z-]*)/g)) expect(names.has(match[1]), `${file}: ${match[1]}`).toBe(true);
    }
  });

  it('SKILL.md lists every section of the script under --sections', () => {
    const option = TEXT['SKILL.md'].split('\n').find((line) => line.startsWith('- `--sections <list>`'));
    expect(option).toBeDefined();
    const named = Array.from(option.matchAll(/`([a-z]+)`/g), (match) => match[1]);
    expect(new Set(named)).toEqual(new Set(SECTIONS));
  });

  it('SKILL.md documents --review in the hint and as an option, and the sections command with it', () => {
    const skill = TEXT['SKILL.md'];
    expect(skill).toMatch(/^argument-hint: .*\[--review\]/m);
    expect(skill).toMatch(/- `--review` - /);
    expect(skill).toMatch(/handbook\.mjs" sections "[^"]*"\n\s*```\n\s*When `--review` is given/);
  });

  it('keeps --features, --language with English as the default, --fresh and resuming', () => {
    const skill = TEXT['SKILL.md'];
    expect(skill).toMatch(/- `--features <list>`/);
    expect(skill).toMatch(/- `--language <lang>` - [^\n]*English when it is not given/);
    expect(skill).toMatch(/- `--fresh`/);
    expect(skill).toContain('**Resuming.**');
    expect(skill).toContain('excavator-product-handbook-state/1');
    expect(skill).toContain('excavator-product-handbook-state/2');
  });
});

describe('the dispatches', () => {
  it('every line that dispatches a subagent names the writer', () => {
    const missing = [];
    for (const [file, text] of Object.entries(TEXT)) {
      text.split('\n').forEach((line, i) => {
        if (/\bdispatch(es)?\b/i.test(line) && /subagent/i.test(line) && !/dispatch no |no subagent|dispatches no/i.test(line) && !line.includes('excavator-handbook-writer')) missing.push(`${file}:${i + 1}`);
      });
    }
    expect(missing).toEqual([]);
  });

  it('every chapter prompt asks for citations, the final check without recording, and the two fixed sections', () => {
    for (const file of ['sections/system.md', 'sections/features.md']) {
      const [prompt] = prompts(TEXT[file]);
      expect(prompt, file).toMatch(/`<path[^`]*>:<a>-<b>`/);
      expect(prompt, file).toMatch(/--no-record/);
      expect(prompt, file).toContain('$OPEN_QUESTIONS');
      expect(prompt, file).toContain('$PROBLEMS');
      expect(prompt, file).toContain('$NONE');
      expect(prompt, file).toMatch(/at most 4 sentences/);
      expect(prompt, file).toMatch(/mermaid/);
    }
  });

  it('the cross chapters never give the writer the project: PROJECT_ROOT occurs only as the argument of the check', () => {
    const files = ['stages/cross-prompt.md', 'sections/cross.md', 'sections/remedies.md'];
    for (const file of files) {
      for (const prompt of prompts(TEXT[file])) {
        const uses = Array.from(prompt.matchAll(/\$PROJECT_ROOT/g)).length;
        const asCheck = Array.from(prompt.matchAll(/--project "\$PROJECT_ROOT"/g)).length;
        expect(uses, file).toBe(asCheck);
      }
    }
    expect(prompts(TEXT['stages/cross-prompt.md'])[0]).toMatch(/never open, search or read the project's code/);
  });

  it('the cross phase gates on every feature having its chapter, and writes the five chapters; remedies has its own file', () => {
    const text = TEXT['sections/cross.md'];
    expect(text).toContain('check "$OUT" --before cross');
    for (const name of ['domains', 'roles', 'notifications', 'topics', 'defects']) expect(text).toContain(`**${name}** (\`$OUT/chapters/${name}.md\`)`);
    expect(text).not.toContain('**remedies**');
    expect(TEXT['sections/remedies.md']).toContain('**remedies** (`$OUT/chapters/remedies.md`)');
    expect(TEXT['sections/review.md']).toContain('check "$OUT" --before review');
  });

  it('the domains writer also writes domains.json, and a passed domains record without json is written again', () => {
    const text = TEXT['sections/cross.md'];
    const block = text.slice(text.indexOf('**domains** ('), text.indexOf('**roles** ('));
    expect(block).toContain('$OUT/domains.json');
    for (const key of ['"domains"', '"handovers"', '"from"', '"to"', '"what"', '"cites"', '"features"']) expect(block).toContain(key);
    expect(block).toMatch(/--no-record/);
    expect(text).toMatch(/`passed` but has no `json` field/);
    expect(TEXT['stages/cross-prompt.md']).toMatch(/Write only the file or files named below/);
  });

  it('the three citation prompts name the full-width parentheses of a language written with them', () => {
    for (const file of ['sections/system.md', 'sections/features.md', 'stages/cross-prompt.md']) expect(TEXT[file]).toContain('U+FF08');
  });

  it('the feature phase prints each feature\'s seed files and entrypoints', () => {
    expect(TEXT['sections/features.md']).toContain('--slurpfile m "$OUT/map.json"');
  });

  it('only the remedies prompt allows advice', () => {
    const text = TEXT['sections/remedies.md'];
    expect(text).toMatch(/\*\*remedies\*\*[\s\S]*the only chapter of the handbook that gives advice/);
    expect(TEXT['sections/features.md']).toMatch(/give no advice/);
    expect(TEXT['sections/system.md']).toMatch(/give no advice/);
  });

  it('every writer is dispatched in the foreground and a failed chapter gets one more attempt, never a third', () => {
    expect(TEXT['sections/features.md']).toMatch(/never dispatch in the background/);
    expect(TEXT['sections/features.md']).toMatch(/Never make a third attempt/);
    expect(TEXT['sections/features.md']).toMatch(/whatever the run has spent/);
  });
});
