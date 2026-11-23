/**
 * semantic-read-evidence: the prose that asks the Phase F2 analyzer and the
 * Phase F4 verifier for the line they read. The scripts enforce the rule;
 * these checks keep the prompts asking for the shape the scripts check.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// Blockquote markers of a dispatch template are dropped so a sentence that wraps reads as one line.
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf-8').replace(/\n\s*> ?/g, ' ').replace(/\s+/g, ' ');
const skill = read('skills/excavator/SKILL.md');
const analyzer = read('agents/excavator-file-analyzer.md');

describe('Phase F2 asks for read evidence', () => {
  it('puts evidence in the dispatch patch shape', () => {
    expect(skill).toContain('"tags": ["..."], "evidence": { "line": <n>, "quote": "..." } }] }');
    expect(skill).toContain('A patch without it is not committed.');
  });

  it('has the analyzer read each readRange and quote a body line', () => {
    expect(analyzer).toContain('"evidence": {"line": <n>, "quote": "..."}}');
    expect(analyzer).toContain('the line is not its first line (the declaration): pick a line of the body');
    expect(analyzer).toContain('Do not put the node\'s file path or any line number in `summary` or `displayName`.');
  });
});

describe('Phase F4 asks for read evidence', () => {
  const verifier = read('agents/excavator-summary-verifier.md');

  it('has the verifier quote the body line that decided a verified or contradicted verdict', () => {
    expect(verifier).toContain('`evidence` is required with `verified` and `contradicted`');
    expect(verifier).toContain('"evidence": { "line": 14, "quote": "if (!order.customerId) throw new ValidationError" }');
    expect(verifier).toContain('which needs no `evidence`');
  });

  it('says in Phase F4 that a verdict without evidence is not written', () => {
    expect(skill).toContain('is not written, and is counted as `no-evidence`');
    expect(skill).toContain('marks a selected id with no verdict, or with no evidence for its verdict, `unverified`');
  });
});
