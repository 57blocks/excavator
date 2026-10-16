import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf-8');

// Every text source file under a repo-relative directory (node_modules and
// build output excluded), repo-relative paths.
function sourceFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(repoRoot, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(child);
      } else if (/\.(?:[cm]?[jt]sx?|md|css|html|json)$/.test(entry.name)) {
        out.push(child);
      }
    }
  };
  walk(dir);
  return out;
}

// Server-start constructs the static view must never contain: it is one file
// opened from file://, with nothing listening.
const SERVER_START_TOKENS = ['listen(', 'createServer(', 'http.createServer', 'express('];

describe('service-only distribution contract', () => {
  it('ships no HTML dashboard, viewer, dashboard skill, tour builder, or thumbnail helper', () => {
    for (const path of [
      'packages/dashboard',
      'packages/viewer',
      'skills/excavator-dashboard',
      'agents/excavator-tour-builder.md',
      'packages/core/src/analyzer/tour-generator.ts',
      'packages/core/src/figma/thumbnails.ts',
    ]) {
      expect(existsSync(join(repoRoot, path)), path).toBe(false);
    }
  });

  it('has one runtime mode with no presentation flags or launch instructions', () => {
    const excavator = read('skills/excavator/SKILL.md');
    const hook = read('hooks/auto-update-prompt.md');
    const configTypes = read('packages/core/src/types.ts');

    for (const text of [excavator, hook, configTypes]) {
      expect(text).not.toContain('terminalOnly');
      expect(text).not.toContain('--terminal-only');
      expect(text).not.toContain('--with-dashboard');
      expect(text).not.toContain('excavator-tour-builder');
      expect(text).not.toContain('/excavator-dashboard');
    }
    expect(excavator).toContain('tour: []');
  });

  it('keeps analysis skills as JSON producers without dashboard handoffs', () => {
    for (const path of [
      'skills/excavator-chat/SKILL.md',
      'skills/excavator-diff/SKILL.md',
      'skills/excavator-domain/SKILL.md',
      'skills/excavator-figma/SKILL.md',
      'skills/excavator-knowledge/SKILL.md',
    ]) {
      const text = read(path);
      expect(text, path).not.toContain('/excavator-dashboard');
      expect(text, path).not.toMatch(/\bdashboard\b/i);
    }
  });

  it('does not include display packages in build, tests, or plugin metadata', () => {
    const buildConfig = `${read('package.json')}\n${read('vitest.config.ts')}`;
    const manifest = read('.claude-plugin/plugin.json');
    expect(buildConfig).not.toMatch(/packages\/(dashboard|viewer)/);
    expect(manifest).not.toMatch(/\bdashboard\b/i);
  });

  it('ships the static view with no server start code', () => {
    const files = [...sourceFiles('packages/view/src'), ...sourceFiles('skills/excavator-view')];
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('skills/excavator-view/SKILL.md');
    for (const path of files) {
      const text = read(path);
      for (const token of SERVER_START_TOKENS) {
        expect(text.includes(token), `${path} contains ${token}`).toBe(false);
      }
    }
  });

  it('keeps the view skill free of presentation flags, ports and local URLs', () => {
    const skill = read('skills/excavator-view/SKILL.md');
    expect(skill).not.toContain('--with-dashboard');
    expect(skill).not.toMatch(/\bdashboard\b/i);
    expect(skill).not.toMatch(/\bports?\b/i);
    expect(skill).not.toContain('localhost:');
    expect(skill).not.toMatch(/localhost|127\.0\.0\.1/i);
  });
});
