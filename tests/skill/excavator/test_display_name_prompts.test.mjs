/**
 * Prompt contract of the node `displayName` (openspec: changes/node-display-name,
 * design decisions 2 and 4): the analyzer writes it in both output modes with the
 * fixed writing rules, the dispatch and commit prose carry it, and the verifier
 * judges it with the summary in one verdict.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relPath) => readFileSync(resolve(repoRoot, relPath), 'utf-8');
/** One line: hard-wrapped prose and bold markers do not break a phrase match. */
const flat = (text) => text.replace(/\*\*/g, '').replace(/\s+/g, ' ');

const analyzer = flat(read('agents/excavator-file-analyzer.md'));
const fullSkill = flat(read('skills/excavator/SKILL.md'));
const chatSkill = flat(read('skills/excavator-chat/SKILL.md'));
const verifier = flat(read('agents/excavator-summary-verifier.md'));

describe('excavator-file-analyzer writes displayName', () => {
  it('has a displayName section with the writing rules of design decision 2', () => {
    expect(analyzer).toContain('## Display Name');
    for (const rule of [
      'a reader who does not read code',
      'what the node is or does in the product, not how',
      'verb phrases',
      'noun phrases',
      '2 to 8 words',
      'at most 60 characters',
      'sentence case',
      'no full stop',
      'reuse it',
      'never an invented business meaning',
    ]) {
      expect(analyzer, rule).toContain(rule);
    }
  });

  it('asks for it in both the semantic patch mode and the GraphNode mode', () => {
    const patchMode = analyzer.slice(analyzer.indexOf('## Semantic Patch Mode'));
    expect(patchMode).toContain('"displayName"');
    const nodeMode = analyzer.slice(analyzer.indexOf('## Display Name'));
    expect(nodeMode).toMatch(/GraphNode/);
    expect(nodeMode).toContain('`displayName` (string)');
  });

  it('adds displayName to the required node fields and the examples written above it', () => {
    const section = analyzer.slice(analyzer.indexOf('## Display Name'));
    expect(section).toContain('adds `displayName` to the Required fields for every node above');
    expect(section).toContain('`name` stays the code name');
    expect(section).toContain('The GraphNode examples above predate this field');
  });

  it('puts displayName under the canonical storage language', () => {
    expect(analyzer).toContain('Write every model-owned `summary`, `displayName`, `tags`, and `languageNotes` value in English');
  });
});

describe('/excavator carries displayName through Phase F2 and Phase 2', () => {
  it('lists it in the F2 dispatch patch shape, language rule and commit description', () => {
    expect(fullSkill).toContain('"summary": "...", "displayName": "...", "tags": ["..."]');
    expect(fullSkill).toContain('Write every model-owned `summary`, `displayName`, and `tags` value in English');
    expect(fullSkill).toContain('the patch\'s `summary`, `displayName` and `tags` pass through hydration');
  });

  it('lists it in the Phase 2 GraphNode fields and language rule', () => {
    expect(fullSkill).toContain('Write every model-owned `summary`, `displayName`, `tags`, and `languageNotes` value in English');
    expect(fullSkill).toContain('every GraphNode carries a `displayName`');
  });
});

describe('/excavator-chat generates and commits displayName', () => {
  it('writes it with the summary and passes it in the commit fields', () => {
    expect(chatSkill).toContain('write the model-owned `summary`, `displayName` and `tags` in English');
    expect(chatSkill).toContain("displayName: '<2 to 8 words");
    expect(chatSkill).toContain('2 to 8 words, at most 60 characters');
  });
});

describe('excavator-summary-verifier judges the name with the summary', () => {
  it('receives displayName and gives one verdict for both texts', () => {
    expect(verifier).toContain('`displayName`');
    expect(verifier).toContain('One verdict covers both texts');
    expect(verifier).toContain('the name or the summary contradicts the source');
    expect(verifier).toContain('the reason says which of the two');
  });
});
