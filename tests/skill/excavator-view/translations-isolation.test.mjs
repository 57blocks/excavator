/**
 * The translation table is a view artifact, not semantics (openspec: changes/view-name-translation, design D1 and
 * oracle 8; spec canonical-semantic-language, "view name translation is presentation"): Chat, the MCP tools, retrieval,
 * verification and the analysis scripts never mention the table or the name table. A text scan over those files.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './plugin-fixture.mjs';

const FORBIDDEN = /view-translations|name-translations|excavator-view-translat/;

/** Every file under `dir` (relative to `base`), skipping dependency and build folders. */
function filesUnder(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-node') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path, base));
    else if (statSync(path).isFile()) out.push(path);
  }
  return out;
}

/** The files in `paths` (files or directories) whose text matches the pattern. */
export function mentions(paths, pattern = FORBIDDEN) {
  return paths
    .flatMap((path) => (statSync(path).isDirectory() ? filesUnder(path) : [path]))
    .filter((path) => pattern.test(readFileSync(path, 'utf-8')))
    // Repository files are named relative to the root; any other path (a temporary directory) stays absolute.
    .map((path) => (path.startsWith(`${repoRoot}/`) ? path.slice(repoRoot.length + 1) : path));
}

const at = (...parts) => join(repoRoot, ...parts);

// What reads or writes semantics: Chat and its prompts, the MCP server and the project service it runs on,
// retrieval and verification, the analysis scripts, the product code and the core package's sources.
const SEMANTIC_SIDE = [
  at('skills/excavator-chat'),
  at('skills/excavator/mcp-server.mjs'),
  at('skills/excavator/project-service.mjs'),
  at('skills/excavator/retrieve.mjs'),
  at('skills/excavator/apply-verification.mjs'),
  at('skills/excavator-verify'),
  at('skills/excavator'),
  at('skills/excavator-domain'),
  at('src'),
  at('packages/core/src'),
  at('agents/excavator-summary-verifier.md'),
  at('agents/excavator-tour-verifier.md'),
];

describe('Chat, MCP, retrieval and verification do not read the translation table', () => {
  it.each(SEMANTIC_SIDE)('%s', (path) => {
    expect(mentions([path])).toEqual([]);
  });

  it('the scan sees a planted mention (the instrument is not blind)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xv-scan-'));
    try {
      mkdirSync(join(dir, 'nested'));
      writeFileSync(join(dir, 'clean.mjs'), 'export const a = 1;\n');
      writeFileSync(join(dir, 'nested', 'bad.mjs'), "readFileSync('view-translations/zh.json');\n");
      const found = mentions([dir]);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/bad\.mjs$/);
      writeFileSync(join(dir, 'nested', 'bad.mjs'), "const t = 'name-translations.json';\n");
      expect(mentions([join(dir, 'nested', 'bad.mjs')])).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the view skill itself does name them (the pattern matches the real thing)', () => {
    expect(mentions([at('skills/excavator-view')]).length).toBeGreaterThan(0);
  });
});
