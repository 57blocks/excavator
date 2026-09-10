/**
 * The ②b prompt additions are ADDITIVE by contract: the direction for this
 * step is that UA's pipeline semantics stay as they are and excavator only
 * supplements. For the two agent prompts that carry UA's analysis logic that
 * means new sections at the END and not one changed or removed line above.
 *
 * "No removed lines" is asserted structurally rather than by parsing a diff:
 * the file as of `excavator-v2` (the integration branch these commits target)
 * must be a byte-exact PREFIX of the working copy. A prefix cannot have had a
 * line deleted, reworded, or reordered — every `git diff` hunk against that
 * ref is necessarily an append.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

/** The UA-semantics files this step is only allowed to append to. */
const ADDITIVE_ONLY_FILES = [
  'agents/excavator-file-analyzer.md',
  'agents/excavator-domain-analyzer.md',
];

/** Candidate refs for "the branch these commits are based on", in order. */
const BASE_REFS = ['excavator-v2', 'origin/excavator-v2'];

function readRepoFile(relPath) {
  return readFileSync(resolve(repoRoot, relPath), 'utf-8');
}

function git(args) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * The base branch's copy of a file. Fails loudly when no base ref resolves:
 * an additive-only check that quietly skips itself is worse than no check,
 * because it is green in exactly the situation it cannot see.
 */
function readBaseVersion(relPath) {
  const tried = [];
  for (const ref of BASE_REFS) {
    try {
      git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    } catch {
      tried.push(`${ref} (no such ref)`);
      continue;
    }
    try {
      return git(['show', `${ref}:${relPath}`]);
    } catch (err) {
      tried.push(`${ref} (git show failed: ${err.message})`);
    }
  }
  throw new Error(
    `cannot read the base version of ${relPath}: tried ${tried.join(', ')}. ` +
    'The additive-only guarantee for the UA prompt files cannot be checked ' +
    'without it, so this is a failure, not a skip.',
  );
}

const fileAnalyzer = readRepoFile('agents/excavator-file-analyzer.md');
const domainAnalyzer = readRepoFile('agents/excavator-domain-analyzer.md');

describe('UA prompt files are only ever appended to', () => {
  it.each(ADDITIVE_ONLY_FILES)('%s: the base version is a byte-exact prefix', relPath => {
    const base = readBaseVersion(relPath);
    const current = readRepoFile(relPath);

    expect(current.length).toBeGreaterThan(base.length);
    // slice + equality rather than startsWith so a mismatch reports where.
    expect(current.slice(0, base.length)).toBe(base);
  });

  it.each(ADDITIVE_ONLY_FILES)('%s: git diff against the base shows no removed lines', relPath => {
    const base = readBaseVersion(relPath);
    const current = readRepoFile(relPath);
    const baseLines = base.split('\n');
    const currentLines = current.split('\n');

    // A prefix relationship at line granularity: every base line survives at
    // its original index. This is the same property `git diff` would report
    // as "no `-` lines", derived from content rather than from diff output.
    expect(currentLines.length).toBeGreaterThanOrEqual(baseLines.length);
    const removed = baseLines.filter((line, i) => currentLines[i] !== line);
    expect(removed).toEqual([]);
  });
});

describe('SKILL.md only ever gains lines', () => {
  /**
   * SKILL.md gains phases by INSERTION, not by appending, so the prefix rule
   * used above cannot apply to it. The equivalent property is that its diff
   * against the base branch removes nothing: `git diff --numstat` reports a
   * deletion count of zero. That is the same "no `-` lines" check, read off
   * git rather than off a substring comparison.
   */
  it('has zero deleted lines against the base branch', () => {
    const relPath = 'skills/excavator/SKILL.md';
    // Confirm a base ref resolves at all — readBaseVersion throws otherwise.
    readBaseVersion(relPath);
    const ref = BASE_REFS.find(candidate => {
      try {
        git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
        return true;
      } catch {
        return false;
      }
    });
    const numstat = git(['diff', '--numstat', ref, '--', relPath]).trim();
    if (numstat === '') return; // identical to the base
    const [added, deleted] = numstat.split('\n')[0].split('\t');
    expect(Number(deleted), `SKILL.md deleted ${deleted} line(s); phases are additive`).toBe(0);
    expect(Number(added)).toBeGreaterThan(0);
  });
});

describe('file-analyzer evidence section', () => {
  it('adds the section without disturbing the existing headings', () => {
    expect(fileAnalyzer).toContain('## Evidence Fields (added — nothing above changes)');
    // The pre-existing headings are all still present and still ahead of it.
    for (const heading of [
      '## Phase 1 -- Structural Extraction (Bundled Script)',
      '## Phase 2 -- Semantic Analysis',
      '### Step 3 -- Create Edges',
      '## Critical Constraints',
      '## Writing Results — single or multi-part',
    ]) {
      expect(fileAnalyzer).toContain(heading);
      expect(fileAnalyzer.indexOf(heading)).toBeLessThan(
        fileAnalyzer.indexOf('## Evidence Fields (added — nothing above changes)'),
      );
    }
  });

  it('requires an evidence entry whose line is copied, not estimated', () => {
    const section = fileAnalyzer.slice(
      fileAnalyzer.indexOf('## Evidence Fields (added — nothing above changes)'),
    );
    expect(section).toContain('"source": "model"');
    expect(section).toContain('copied from the extraction results');
    expect(section).toMatch(/never\s+estimated/);
    // Every structural edge type has a named line source.
    for (const type of ['contains', 'exports', 'calls', 'imports']) {
      expect(section).toContain(`\`${type}\``);
    }
    expect(section).toContain('startLine');
    expect(section).toContain('lineNumber');
    expect(section).toContain('exports[].line');
    expect(section).toContain('imports[].line');
  });

  it('routes an uncopyable line to inferred rather than to a guess', () => {
    const section = fileAnalyzer.slice(
      fileAnalyzer.indexOf('## Evidence Fields (added — nothing above changes)'),
    );
    expect(section).toContain('"provenance": "inferred"');
    expect(section).toContain('Never write `"provenance": "extracted"` yourself.');
  });

  it('keeps no-extractor and parse-failed files to a file node only', () => {
    const section = fileAnalyzer.slice(
      fileAnalyzer.indexOf('### Files with no structural records'),
    );
    expect(section.length).toBeGreaterThan(0);
    expect(section).toContain('`no-extractor`');
    expect(section).toContain('`parse-failed`');
    expect(section).toContain('Still create exactly one node for the file');
    expect(section).toContain('Do **NOT** invent `function:` or `class:` nodes for them');
    expect(section).toContain('Do **NOT** emit `calls` edges for them');
    // The existing 1:1 imports rule must be preserved, not weakened.
    expect(section).toContain('`imports` edges are unaffected');
    expect(section).toContain('batchImportData');
  });

  it('keeps a reported owner and forbids inventing one', () => {
    const section = fileAnalyzer.slice(
      fileAnalyzer.indexOf('### Keep `owner` when it is given'),
    );
    expect(section.length).toBeGreaterThan(0);
    expect(section).toContain('copy it verbatim onto the node as `"owner": "<value>"`');
    expect(section).toContain('leave the field off');
    expect(section).toContain('Do not change the node `id` because of an `owner`');
  });
});

describe('file-analyzer framework guidance hook', () => {
  const section = () =>
    fileAnalyzer.slice(fileAnalyzer.indexOf('## Framework Guidance (added — nothing above changes)'));

  it('points at the frameworks directory next to the dispatching skill', () => {
    expect(fileAnalyzer).toContain('## Framework Guidance (added — nothing above changes)');
    expect(section()).toContain('<SKILL_DIR>/frameworks/<framework-id-lowercase>.md');
    expect(section()).toContain('<SKILL_DIR>/frameworks/README.md');
  });

  it('makes a missing addendum silence rather than a licence to guess', () => {
    expect(section()).toContain('continue silently');
    expect(section()).toMatch(/not licence to\s+reconstruct them/);
  });

  it('does not let a convention stand in for a cited line', () => {
    expect(section()).toContain('An addendum never outranks the evidence rules.');
    expect(section()).toContain('"provenance": "inferred"');
  });
});

describe('frameworks/README.md explains the hook', () => {
  const readme = readRepoFile('skills/excavator/frameworks/README.md');

  it('names both readers and the file-naming rule', () => {
    expect(readme).toContain('excavator-architecture-analyzer');
    expect(readme).toContain('excavator-file-analyzer');
    expect(readme).toContain('lower-cased framework id');
  });

  it('states that a missing addendum is skipped, not reconstructed', () => {
    expect(readme).toContain('A missing file is silence, not a licence');
    expect(readme).toContain('skip it and continue');
  });

  it('says the rule packs arrive with step ③ and are not here yet', () => {
    expect(readme).toContain('step ③');
    expect(readme).toContain('angular');
    expect(readme).toContain('maui');
  });

  it('lists every addendum file that exists in the directory', () => {
    const dir = resolve(repoRoot, 'skills/excavator/frameworks');
    const addenda = readdirSync(dir)
      .filter(name => name.endsWith('.md') && name !== 'README.md')
      .sort();
    expect(addenda.length).toBeGreaterThan(0);
    for (const name of addenda) {
      expect(readme, `README.md should list ${name}`).toContain(`\`${name}\``);
    }
  });
});

describe('domain-analyzer step anchors', () => {
  const section = () =>
    domainAnalyzer.slice(domainAnalyzer.indexOf('## Step Anchors (added — nothing above changes)'));

  it('asks for real graph ids on step nodes', () => {
    expect(domainAnalyzer).toContain('## Step Anchors (added — nothing above changes)');
    expect(section()).toContain('`nodeIds`');
    expect(section()).toContain('real ids of the');
    expect(section()).toContain('copied verbatim');
  });

  it('accepts omission marked inferred but not an id that is not in the graph', () => {
    expect(section()).toContain('omit `nodeIds`');
    expect(section()).toContain('"provenance": "inferred"');
    expect(section()).toMatch(/a `nodeIds`\s+entry that is not in the graph is not/);
  });
});
