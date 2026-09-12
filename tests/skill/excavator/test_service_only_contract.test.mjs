import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
});
