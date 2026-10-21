import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf-8');

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

  // The one exception: /excavator-view writes a static page and opens it (openspec: changes/report-viewer, design D8).
  describe('the /excavator-view exception stays narrow', () => {
    const walk = (dir) => readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => (
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
    ));

    it('has a viewer project with no package.json, no import or require, and no http(s) resource', () => {
      expect(existsSync(join(repoRoot, 'viewer/package.json'))).toBe(false);
      for (const path of walk('viewer')) {
        const text = read(path);
        expect(text, path).not.toMatch(/^\s*(import|export)\b/m);
        expect(text, path).not.toMatch(/\b(import\s*\(|require\s*\()/);
        expect(text, path).not.toMatch(/https?:/i);
      }
    });

    it('starts no server from the packer or the skill', () => {
      for (const path of ['skills/excavator-view/pack.mjs', 'skills/excavator-view/SKILL.md']) {
        const text = read(path);
        expect(text, path).not.toContain('createServer');
        expect(text, path).not.toContain('.listen(');
        expect(text, path).not.toContain('listen(');
      }
    });

    it('is referenced by no other skill, agent or hook', () => {
      const others = [
        ...readdirSync(join(repoRoot, 'skills')).filter((name) => name !== 'excavator-view').map((name) => `skills/${name}/SKILL.md`),
        ...readdirSync(join(repoRoot, 'agents')).map((name) => `agents/${name}`),
        ...readdirSync(join(repoRoot, 'hooks')).map((name) => `hooks/${name}`),
      ].filter((path) => existsSync(join(repoRoot, path)) && /\.(md|json)$/.test(path));
      expect(others.length).toBeGreaterThan(10);
      for (const path of others) {
        expect(read(path), path).not.toMatch(/excavator-view/);
      }
    });

    it('is the only skill that mentions a browser opener', () => {
      for (const name of readdirSync(join(repoRoot, 'skills')).filter((n) => n !== 'excavator-view')) {
        const text = read(`skills/${name}/SKILL.md`);
        expect(text, name).not.toMatch(/\bxdg-open\b|cmd\.exe \/c start|\bopen "\$/);
      }
    });
  });
});
