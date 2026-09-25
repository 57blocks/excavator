/**
 * The ②b prompt additions are ADDITIVE by contract: the direction for this
 * step is that UA's pipeline semantics stay as they are and excavator only
 * supplements. For the two agent prompts that carry UA's analysis logic that
 * means new sections at the END and not one changed or removed line above.
 *
 * "No removed lines" is asserted structurally rather than by parsing a diff:
 * the frozen baseline below (the file's UTF-8 byte length and SHA-256 as of
 * commit 5a10e468 on main's history, before the ②b additions) must match the
 * first bytes of the working copy exactly. A byte-exact prefix cannot have
 * had a line deleted, reworded, or reordered — every change since is
 * necessarily an append. The baseline lives here rather than behind a git
 * ref so the check needs no branch and no network fetch, and it can never
 * silently skip.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

/** The UA-semantics files this step is only allowed to append to, with their frozen baselines. */
const ADDITIVE_ONLY_BASELINES = [
  {
    path: 'agents/excavator-file-analyzer.md',
    bytes: 34886,
    sha256: '872620f1344acf255469d14c4569ee2900bcf7bcd8385fad37a7612575d00301',
  },
];

function readRepoFile(relPath) {
  return readFileSync(resolve(repoRoot, relPath), 'utf-8');
}

const fileAnalyzer = readRepoFile('agents/excavator-file-analyzer.md');
const domainAnalyzer = readRepoFile('agents/excavator-domain-analyzer.md');

describe('UA prompt files are only ever appended to', () => {
  it.each(ADDITIVE_ONLY_BASELINES)('$path: the frozen baseline is a byte-exact prefix', ({ path, bytes, sha256 }) => {
    const current = readFileSync(resolve(repoRoot, path));

    expect(current.length).toBeGreaterThan(bytes);
    const prefixHash = createHash('sha256').update(current.subarray(0, bytes)).digest('hex');
    expect(
      prefixHash,
      `the first ${bytes} bytes of ${path} no longer match the frozen UA baseline: a line above the appended sections was changed or removed`,
    ).toBe(sha256);
  });
});

describe('SKILL.md service-only contract', () => {
  it('keeps evidence phases while removing presentation mode', () => {
    const current = readRepoFile('skills/excavator/SKILL.md');
    expect(current).toContain('## Phase 2.3 — ANNOTATE');
    expect(current).toContain('## Phase 2.5 — VERIFY');
    expect(current).toContain('## Phase 6b — VALIDATE');
    expect(current).toContain('## Phase 5 — SERVICE OUTPUT');
    expect(current).not.toContain('--terminal-only');
    expect(current).not.toContain('--with-dashboard');
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

  it('says the framework readers are tracked as OpenSpec changes, naming the targets', () => {
    expect(readme).toContain('openspec/changes');
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
