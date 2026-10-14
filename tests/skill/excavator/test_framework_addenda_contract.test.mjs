/**
 * javaee-jsf-framework-knowledge, D5 / task 5.3: the registered framework
 * configs and the addenda under skills/excavator/frameworks/ belong together,
 * in both directions.
 *
 * - Every registered `FrameworkConfig` has an addendum named `<id>.md`, and its
 *   `promptSnippetPath` is `./frameworks/<id>.md`.
 * - Every addendum (README.md aside) belongs to a registered config.
 *
 * The configs are read from the built core, the same module the scan loads.
 * The check itself is `contractViolations`; the last block runs it over mutated
 * copies of the inputs (a config with no addendum, an addendum with no config,
 * a wrong path) and expects each to be reported, so a green result above is
 * not a check that cannot fail.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { builtinFrameworkConfigs } from '@excavator/core';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FRAMEWORKS_DIR = resolve(repoRoot, 'skills/excavator/frameworks');

/** Addendum ids on disk: the file names without `.md`, `README.md` excluded. */
const addendumIdsOnDisk = () =>
  readdirSync(FRAMEWORKS_DIR)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => name.slice(0, -'.md'.length))
    .sort();

/**
 * @param {Array<{ id: string, promptSnippetPath?: string }>} configs
 * @param {string[]} addendumIds
 * @returns {string[]} one line per way the two disagree; empty when they agree
 */
function contractViolations(configs, addendumIds) {
  const violations = [];
  const configIds = new Set(configs.map((config) => config.id));
  for (const config of configs) {
    if (!addendumIds.includes(config.id)) violations.push(`config ${config.id} has no addendum ${config.id}.md`);
    if (config.promptSnippetPath !== `./frameworks/${config.id}.md`) {
      violations.push(`config ${config.id}: promptSnippetPath is ${config.promptSnippetPath}, expected ./frameworks/${config.id}.md`);
    }
  }
  for (const id of addendumIds) {
    if (!configIds.has(id)) violations.push(`addendum ${id}.md has no registered config`);
  }
  return violations;
}

describe('framework configs and addenda (both directions)', () => {
  const addendumIds = addendumIdsOnDisk();
  const configIds = builtinFrameworkConfigs.map((config) => config.id).sort();

  it('the set of config ids equals the set of addendum file names', () => {
    expect(configIds).toEqual(addendumIds);
  });

  it('every config points at ./frameworks/<id>.md, and that file exists', () => {
    for (const config of builtinFrameworkConfigs) {
      expect(config.promptSnippetPath).toBe(`./frameworks/${config.id}.md`);
      expect(existsSync(resolve(FRAMEWORKS_DIR, `${config.id}.md`)), `${config.id}.md should exist`).toBe(true);
    }
  });

  it('has no violation', () => {
    expect(contractViolations(builtinFrameworkConfigs, addendumIds)).toEqual([]);
  });

  it('includes the javaee and jsf pair', () => {
    expect(configIds).toEqual(expect.arrayContaining(['javaee', 'jsf']));
  });
});

describe('the contract check reports what it should (mutated copies, product code untouched)', () => {
  const configs = builtinFrameworkConfigs;
  const addendumIds = addendumIdsOnDisk();

  it('reports a registered config that has no addendum', () => {
    const withFoo = [...configs, { id: 'foo', promptSnippetPath: './frameworks/foo.md' }];
    expect(contractViolations(withFoo, addendumIds)).toEqual(['config foo has no addendum foo.md']);
  });

  it('reports an addendum that no registered config owns', () => {
    const withoutJsf = configs.filter((config) => config.id !== 'jsf');
    expect(contractViolations(withoutJsf, addendumIds)).toEqual(['addendum jsf.md has no registered config']);
    expect(contractViolations(configs, [...addendumIds, 'bar'])).toEqual(['addendum bar.md has no registered config']);
  });

  it('reports a promptSnippetPath that does not name the addendum', () => {
    const wrongPath = configs.map((config) => (config.id === 'javaee' ? { ...config, promptSnippetPath: './frameworks/jakartaee.md' } : config));
    expect(contractViolations(wrongPath, addendumIds)).toEqual([
      'config javaee: promptSnippetPath is ./frameworks/jakartaee.md, expected ./frameworks/javaee.md',
    ]);
    const missingPath = configs.map((config) => (config.id === 'jsf' ? { id: 'jsf' } : config));
    expect(contractViolations(missingPath, addendumIds)).toEqual([
      'config jsf: promptSnippetPath is undefined, expected ./frameworks/jsf.md',
    ]);
  });
});
