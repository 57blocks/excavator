/**
 * The plugin manifest is a silent single point of failure.
 *
 * `.claude-plugin/plugin.json` had `"agents": "./agents"` — a string where the
 * loader's schema wants an array. The consequence is not an error message: in
 * `-p` mode `--plugin-dir` loads NOTHING (no skills, no agents, no hooks),
 * prints nothing, and every `/excavator:*` invocation comes back as
 * "Unknown command: /excavator:excavator" with `num_turns: 0`. A whole
 * acceptance run was spent diagnosing that.
 *
 * So the shape is asserted two ways: structurally (no `claude` binary needed,
 * so it gates every run) and, when the binary is present, by asking the real
 * validator. The structural check is verified against a known-bad copy first —
 * a checker that cannot go red is not a checker.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const pluginJsonPath = resolve(repoRoot, '.claude-plugin/plugin.json');
const marketplacePath = resolve(repoRoot, '.claude-plugin/marketplace.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * The rule, as a pure function over a parsed manifest, so it can be pointed at
 * a deliberately broken copy as well as at the real one.
 */
export function manifestShapeViolations(plugin, repoDir) {
  const violations = [];
  if (typeof plugin?.name !== 'string' || plugin.name.length === 0) {
    violations.push('plugin.json has no name');
  }
  if (Object.hasOwn(plugin ?? {}, 'agents')) {
    if (!Array.isArray(plugin.agents)) {
      violations.push(`"agents" must be an array or absent, got ${typeof plugin.agents}`);
    } else {
      for (const entry of plugin.agents) {
        if (typeof entry !== 'string') {
          violations.push(`"agents" entry is not a string: ${JSON.stringify(entry)}`);
          continue;
        }
        const abs = resolve(repoDir, entry.replace(/^\.\//, ''));
        if (!existsSync(abs) || !statSync(abs).isFile()) {
          violations.push(`"agents" entry "${entry}" is not a file`);
        }
      }
    }
  }
  for (const [key, kind] of [['skills', 'dir'], ['hooks', 'file']]) {
    if (!Object.hasOwn(plugin ?? {}, key)) continue;
    const value = plugin[key];
    if (typeof value !== 'string') {
      violations.push(`"${key}" must be a path string, got ${typeof value}`);
      continue;
    }
    const abs = resolve(repoDir, value.replace(/^\.\//, ''));
    if (!existsSync(abs)) {
      violations.push(`"${key}" path "${value}" does not exist`);
    } else if (kind === 'dir' && !statSync(abs).isDirectory()) {
      violations.push(`"${key}" path "${value}" is not a directory`);
    } else if (kind === 'file' && !statSync(abs).isFile()) {
      violations.push(`"${key}" path "${value}" is not a file`);
    }
  }
  return violations;
}

describe('plugin.json shape', () => {
  const plugin = readJson(pluginJsonPath);

  it('parses and names the plugin', () => {
    expect(plugin.name).toBe('excavator');
  });

  it('has no violations', () => {
    expect(manifestShapeViolations(plugin, repoRoot)).toEqual([]);
  });

  it('keeps `agents` absent (auto-discovery) or an array of real files', () => {
    if (!Object.hasOwn(plugin, 'agents')) {
      // Auto-discovery: the agents still have to be there to be discovered.
      expect(existsSync(resolve(repoRoot, 'agents'))).toBe(true);
      return;
    }
    expect(Array.isArray(plugin.agents)).toBe(true);
    for (const entry of plugin.agents) {
      expect(existsSync(resolve(repoRoot, entry.replace(/^\.\//, '')))).toBe(true);
    }
  });

  it('resolves the skills directory and the hooks file', () => {
    expect(statSync(resolve(repoRoot, plugin.skills.replace(/^\.\//, ''))).isDirectory()).toBe(true);
    expect(statSync(resolve(repoRoot, plugin.hooks.replace(/^\.\//, ''))).isFile()).toBe(true);
  });

  it('goes red on the exact shape that silently loaded nothing', () => {
    // The instrument check: this is the manifest as it was.
    const broken = { ...plugin, agents: './agents' };
    const violations = manifestShapeViolations(broken, repoRoot);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('"agents" must be an array or absent');
  });

  it('goes red on an agents array naming a file that is not there', () => {
    const broken = { ...plugin, agents: ['./agents/excavator-does-not-exist.md'] };
    expect(manifestShapeViolations(broken, repoRoot)).toEqual([
      '"agents" entry "./agents/excavator-does-not-exist.md" is not a file',
    ]);
  });

  it('goes red on a skills path that does not resolve', () => {
    const broken = { ...plugin, skills: './not-skills' };
    expect(manifestShapeViolations(broken, repoRoot)[0]).toContain('does not exist');
  });
});

describe('marketplace.json shape', () => {
  const marketplace = readJson(marketplacePath);

  it('has a description, so the validator does not warn and users see something', () => {
    expect(typeof marketplace.description).toBe('string');
    expect(marketplace.description.trim().length).toBeGreaterThan(0);
  });

  it('lists the plugin with a source that exists', () => {
    expect(marketplace.plugins.length).toBeGreaterThan(0);
    for (const entry of marketplace.plugins) {
      expect(typeof entry.source).toBe('string');
      expect(existsSync(resolve(repoRoot, entry.source.replace(/^\.\//, '')))).toBe(true);
    }
  });
});

describe('check-refs enforces the manifest shape without the claude binary', () => {
  it('reports the manifest entries it checked', () => {
    const result = spawnSync(process.execPath, [resolve(repoRoot, 'scripts/check-refs.mjs')], {
      encoding: 'utf-8',
      cwd: repoRoot,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('plugin manifest entries checked:');
  });

  it('fails on a copy whose agents key is a string', () => {
    // A whole-repo copy would be 500MB; check-refs only needs the parts it
    // reads, and a missing part of the corpus is itself a violation, so this
    // asserts the manifest failure is REPORTED rather than that the run is
    // otherwise clean.
    const dir = mkdtempSync(join(tmpdir(), 'excavator-manifest-'));
    try {
      mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      cpSync(resolve(repoRoot, 'scripts/check-refs.mjs'), join(dir, 'scripts/check-refs.mjs'));
      cpSync(resolve(repoRoot, 'skills'), join(dir, 'skills'), { recursive: true });
      cpSync(resolve(repoRoot, 'agents'), join(dir, 'agents'), { recursive: true });
      cpSync(resolve(repoRoot, 'hooks'), join(dir, 'hooks'), { recursive: true });
      cpSync(marketplacePath, join(dir, '.claude-plugin/marketplace.json'));
      writeFileSync(
        join(dir, '.claude-plugin/plugin.json'),
        JSON.stringify({ ...readJson(pluginJsonPath), agents: './agents' }, null, 2),
        'utf-8',
      );

      const result = spawnSync(process.execPath, [join(dir, 'scripts/check-refs.mjs')], {
        encoding: 'utf-8',
        cwd: dir,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('"agents" must be an array of file paths or be absent');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the plugin loader's own validator", () => {
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf-8' });
  const available = probe.status === 0;

  it('accepts this repository as a plugin', () => {
    if (!available) {
      // Reported, not hidden: a silent skip here is how the broken manifest
      // survived in the first place.
      console.warn(
        '[plugin-manifest] SKIPPED `claude plugin validate`: the `claude` binary is not on PATH. ' +
        'The structural checks above still ran; the loader\'s own opinion was not obtained.',
      );
      expect(available).toBe(false);
      return;
    }
    const result = spawnSync('claude', ['plugin', 'validate', repoRoot], { encoding: 'utf-8' });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(output).toContain('Validation passed');
    expect(output).not.toContain('Validation failed');
  }, 120_000);
});
