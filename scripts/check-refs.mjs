#!/usr/bin/env node
/**
 * check-refs.mjs — cross-reference integrity gate for the Excavator plugin.
 *
 * Zero dependencies, zero network. Verifies that every cross-reference
 * between skills, agents, hooks, and dashboard locales in this repository
 * actually resolves to something that exists — so a rename, a typo, or a
 * moved file shows up as a hard failure instead of a silent dangling
 * reference discovered only when a user hits it.
 *
 * Checks (see openspec/changes/excavator-rename/design.md D8):
 *   1. skills/<dir>/SKILL.md frontmatter `name` == <dir>;
 *      agents/<file>.md frontmatter `name` == <file>.
 *   2. Every `agents/<x>.md` path mentioned in skills/**\/*.md, agents/*.md
 *      or hooks/* resolves to a real file; every backticked
 *      `excavator-[a-z-]+` token in the same corpus is a real skill
 *      directory name or a real agent id.
 *   3. Every `/excavator` or `/excavator-<suffix>` (bare or
 *      `/excavator:excavator...` Claude Code-prefixed) slash reference in
 *      that corpus (plus README.md) names an existing skill directory.
 *   4. Every `.mjs`/`.py`/`.sh` path referenced in that corpus, after
 *      stripping a `${CLAUDE_PLUGIN_ROOT}`/`$PLUGIN_ROOT`/`<SKILL_DIR>`
 *      prefix, resolves relative to the repo root or to the referencing
 *      file's own skill directory.
 *   5. Every `${CLAUDE_PLUGIN_ROOT}/...` path in hooks/hooks.json resolves.
 *   6. All packages/dashboard/src/locales/*.ts files export the same set
 *      of (possibly nested) keys.
 *   7. `.claude-plugin/plugin.json` and `marketplace.json` have a shape the
 *      Claude Code plugin loader accepts: `agents` absent or an ARRAY of
 *      existing files, `skills`/`hooks` paths that resolve, and every
 *      `plugins[].source` present. An invalid manifest makes `--plugin-dir`
 *      load NOTHING, silently, with no error in `-p` mode — the whole plugin
 *      disappears and every slash command becomes "Unknown command".
 *
 * Usage: node scripts/check-refs.mjs
 * Exit code: 0 if every check passes; 1 and one line per violation
 * otherwise (plus a final summary of what was checked).
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const violations = [];
function fail(check, message) {
  violations.push(`[check ${check}] ${message}`);
}

// ── Filesystem helpers ──────────────────────────────────────────────────

function listDirNames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function listFiles(dir, { suffix = '' } = {}) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(suffix))
    .map((d) => d.name);
}

/** Recursively list all files under `dir` matching `suffix`, repo-relative. */
function walkFiles(dir, suffix) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, suffix));
    } else if (entry.isFile() && abs.endsWith(suffix)) {
      out.push(abs);
    }
  }
  return out;
}

function readText(path) {
  return readFileSync(path, 'utf-8');
}

// ── Corpus: every file that can carry a cross-reference ─────────────────

const skillsDir = join(REPO_ROOT, 'skills');
const agentsDir = join(REPO_ROOT, 'agents');
const hooksDir = join(REPO_ROOT, 'hooks');

const skillDirNames = listDirNames(skillsDir).sort();
const agentFileNames = listFiles(agentsDir, { suffix: '.md' }).sort();
const agentIds = new Set(agentFileNames.map((f) => f.replace(/\.md$/, '')));
const skillDirSet = new Set(skillDirNames);

// Framework/language/locale reference docs are pure prompt-injection content
// (glob patterns, illustrative file names, translated prose) — not skill
// logic — and legitimately contain filename-shaped text that is not a real
// cross-reference (e.g. a Django detection table mentioning `*/settings.py`).
// Excluded from the corpus rather than special-cased in every check's regex.
const REFERENCE_DOC_DIRS = new Set(['frameworks', 'languages', 'locales']);
function isReferenceDoc(filePath) {
  const rel = relative(skillsDir, filePath);
  if (rel.startsWith('..')) return false;
  const segment = rel.split('/')[1];
  return REFERENCE_DOC_DIRS.has(segment);
}

const skillMarkdownFiles = walkFiles(skillsDir, '.md').filter(
  (f) => !isReferenceDoc(f),
);
const agentMarkdownFiles = agentFileNames.map((f) => join(agentsDir, f));
const hookFiles = existsSync(hooksDir)
  ? readdirSync(hooksDir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => join(hooksDir, d.name))
  : [];

/** The full corpus for checks 2-4: every skill/agent/hook text file. */
const corpusFiles = [...skillMarkdownFiles, ...agentMarkdownFiles, ...hookFiles];

/** The skill directory a given corpus file lives under, if any (for
 * resolving bare/relative script paths and <SKILL_DIR> placeholders). */
function skillDirFor(filePath) {
  const rel = relative(skillsDir, filePath);
  if (rel.startsWith('..')) return null;
  const skillName = rel.split('/')[0];
  return skillDirSet.has(skillName) ? join(skillsDir, skillName) : null;
}

// ── Check 1: name == directory/file name ─────────────────────────────────

function parseFrontmatterName(text) {
  const m = text.match(/^name:\s*(\S+)\s*$/m);
  return m ? m[1] : null;
}

function checkNames() {
  let checked = 0;
  for (const dirName of skillDirNames) {
    const skillMdPath = join(skillsDir, dirName, 'SKILL.md');
    if (!existsSync(skillMdPath)) {
      fail(1, `skills/${dirName}/ has no SKILL.md`);
      continue;
    }
    checked++;
    const name = parseFrontmatterName(readText(skillMdPath));
    if (name !== dirName) {
      fail(
        1,
        `skills/${dirName}/SKILL.md frontmatter name "${name}" does not match directory name "${dirName}"`,
      );
    }
  }
  for (const fileName of agentFileNames) {
    checked++;
    const expected = fileName.replace(/\.md$/, '');
    const name = parseFrontmatterName(readText(join(agentsDir, fileName)));
    if (name !== expected) {
      fail(
        1,
        `agents/${fileName} frontmatter name "${name}" does not match file name "${expected}"`,
      );
    }
  }
  return checked;
}

// ── Check 2: agent references (agents/<x>.md paths + backticked ids) ────

function checkAgentReferences() {
  let checked = 0;
  const pathRe = /agents\/([a-zA-Z0-9_-]+)\.md/g;
  const backtickRe = /`(excavator-[a-z][a-z-]*)`/g;

  for (const file of corpusFiles) {
    const text = readText(file);
    const relFile = relative(REPO_ROOT, file);

    for (const m of text.matchAll(pathRe)) {
      checked++;
      const agentName = m[1];
      if (!agentIds.has(agentName)) {
        fail(
          2,
          `${relFile} references agents/${agentName}.md, which does not exist (referenced agent: ${agentName})`,
        );
      }
    }

    for (const m of text.matchAll(backtickRe)) {
      checked++;
      const token = m[1];
      if (!agentIds.has(token) && !skillDirSet.has(token)) {
        fail(
          2,
          `${relFile} references \`${token}\`, which is neither an existing agent id (agents/${token}.md) nor an existing skill directory (skills/${token}/)`,
        );
      }
    }
  }
  return checked;
}

// ── Check 3: /excavator[-<suffix>] slash references ──────────────────────

function checkSlashReferences() {
  let checked = 0;
  // Matches bare `/excavator[-suffix]` and Claude Code-prefixed
  // `/excavator:excavator[-suffix]`, word-bounded so it doesn't also match
  // inside a longer path or URL segment. Excludes a match immediately
  // followed by a file extension (e.g. `/excavator-viewer.tgz` in a release
  // download URL) — that is a filename, not a skill invocation.
  const slashRe =
    /(?:^|[^a-zA-Z0-9_/])\/excavator(?::excavator)?(-[a-z]+)?\b(?!\.[a-z])/g;
  const files = [...corpusFiles, join(REPO_ROOT, 'README.md')].filter(existsSync);

  for (const file of files) {
    const text = readText(file);
    const relFile = relative(REPO_ROOT, file);
    for (const m of text.matchAll(slashRe)) {
      checked++;
      const suffix = m[1] ?? '';
      const skillName = `excavator${suffix}`;
      if (!skillDirSet.has(skillName)) {
        fail(
          3,
          `${relFile} references /${skillName} (or /excavator:${skillName}), which does not exist as skills/${skillName}/`,
        );
      }
    }
  }
  return checked;
}

// ── Check 4: script paths (.mjs/.py/.sh) ─────────────────────────────────

function checkScriptPaths() {
  let checked = 0;
  // One or more `/`-separated segments ending in .mjs/.py/.sh — no leading
  // slash required, so both `skills/excavator/foo.mjs` (bare, inside
  // backticks) and `$PLUGIN_ROOT/skills/excavator/foo.mjs` (variable-
  // prefixed) match as a single path. `<SKILL_DIR>` is a placeholder for
  // "this skill's own directory", stripped like the plugin-root variables.
  const pathRe =
    /(?:\$\{CLAUDE_PLUGIN_ROOT\}\/|\$PLUGIN_ROOT\/|<SKILL_DIR>\/)?([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*\.(?:mjs|py|sh))/g;

  for (const file of corpusFiles) {
    const text = readText(file);
    const relFile = relative(REPO_ROOT, file);
    const ownSkillDir = skillDirFor(file);
    // Agent files have no fixed home skill — <SKILL_DIR> there means
    // "whichever skill dispatched this agent", so accept any skill dir.
    const candidateSkillDirs = ownSkillDir
      ? [ownSkillDir]
      : skillDirNames.map((name) => join(skillsDir, name));

    for (const m of text.matchAll(pathRe)) {
      const raw = m[0];
      const strippedPath = m[1];
      // A bare single-segment filename with no plugin-root/<SKILL_DIR>
      // prefix and no "/" (e.g. "manage.py", "wsgi.py") is virtually always
      // an illustrative example in prose (entry-point conventions, etc.),
      // not a cross-reference to a real file in this repo — skip it.
      const hadPrefix = raw.length > strippedPath.length;
      if (!hadPrefix && !strippedPath.includes('/')) continue;
      checked++;

      const candidates = [resolve(REPO_ROOT, strippedPath)];
      for (const dir of candidateSkillDirs) candidates.push(resolve(dir, strippedPath));

      const found = candidates.some((c) => existsSync(c) && statSync(c).isFile());
      if (!found) {
        fail(
          4,
          `${relFile} references "${raw}" (resolved to "${strippedPath}"), which does not exist relative to the repo root${ownSkillDir ? ' or ' + relative(REPO_ROOT, ownSkillDir) + '/' : ' or any skill directory'}`,
        );
      }
    }
  }
  return checked;
}

// ── Check 5: hooks/hooks.json ${CLAUDE_PLUGIN_ROOT}/... paths ───────────

function checkHooksJsonPaths() {
  let checked = 0;
  const hooksJsonPath = join(hooksDir, 'hooks.json');
  if (!existsSync(hooksJsonPath)) {
    fail(5, 'hooks/hooks.json does not exist');
    return checked;
  }
  const text = readText(hooksJsonPath);
  const pathRe = /\$\{CLAUDE_PLUGIN_ROOT\}(\/[a-zA-Z0-9_./-]+)/g;
  for (const m of text.matchAll(pathRe)) {
    checked++;
    const relPath = m[1].replace(/^\//, '');
    const abs = resolve(REPO_ROOT, relPath);
    if (!existsSync(abs)) {
      fail(5, `hooks/hooks.json references \${CLAUDE_PLUGIN_ROOT}/${relPath}, which does not exist`);
    }
  }
  return checked;
}

// ── Check 6: dashboard locale key parity ─────────────────────────────────

/**
 * Import a locale .ts file's named (or default) export and return its
 * key-path set, via a child process so this script itself needs no special
 * `--experimental-strip-types` flag on its own invocation (design's
 * verification runs it as plain `node scripts/check-refs.mjs`).
 */
function importLocaleKeyPaths(filePath, modName) {
  const url = pathToFileURL(filePath).href;
  const inline = [
    `import { pathToFileURL } from 'node:url';`,
    `const mod = await import(${JSON.stringify(url)});`,
    `const exported = mod[${JSON.stringify(modName)}] ?? mod.default;`,
    `if (!exported || typeof exported !== 'object') { console.log(JSON.stringify(null)); process.exit(0); }`,
    `function collect(obj, prefix) {`,
    `  const keys = [];`,
    `  for (const [k, v] of Object.entries(obj)) {`,
    `    const path = prefix ? prefix + '.' + k : k;`,
    `    if (v !== null && typeof v === 'object' && !Array.isArray(v)) keys.push(...collect(v, path));`,
    `    else keys.push(path);`,
    `  }`,
    `  return keys;`,
    `}`,
    `console.log(JSON.stringify(collect(exported, '')));`,
  ].join('\n');
  const out = execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', inline],
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  return JSON.parse(out);
}

async function checkLocaleParity() {
  let checked = 0;
  const localesDir = join(REPO_ROOT, 'packages/dashboard/src/locales');
  const localeFiles = listFiles(localesDir, { suffix: '.ts' }).filter(
    (f) => f !== 'index.ts',
  );
  if (localeFiles.length === 0) {
    fail(6, `no locale files found under ${relative(REPO_ROOT, localesDir)}`);
    return checked;
  }

  const keySets = {};
  for (const file of localeFiles) {
    checked++;
    const modName = file.replace(/\.ts$/, '');
    const keyPaths = importLocaleKeyPaths(join(localesDir, file), modName);
    if (keyPaths === null) {
      fail(6, `${relative(REPO_ROOT, join(localesDir, file))} does not export an object named "${modName}" (or default)`);
      continue;
    }
    keySets[file] = new Set(keyPaths);
  }

  const fileNames = Object.keys(keySets);
  if (fileNames.length < 2) return checked;
  const reference = keySets[fileNames[0]];
  for (const file of fileNames.slice(1)) {
    const current = keySets[file];
    const missing = [...reference].filter((k) => !current.has(k));
    const extra = [...current].filter((k) => !reference.has(k));
    for (const k of missing) {
      fail(6, `${file} is missing key "${k}" present in ${fileNames[0]}`);
    }
    for (const k of extra) {
      fail(6, `${file} has extra key "${k}" not present in ${fileNames[0]}`);
    }
  }
  return checked;
}

// ── Check 7: plugin manifest shape ──────────────────────────────────────

/**
 * The loader is silent about a manifest it cannot parse: `--plugin-dir` on a
 * plugin whose `plugin.json` has `"agents": "./agents"` (a string where the
 * schema wants an array) loads no skills, no agents and no hooks, prints
 * nothing, and every `/excavator:*` command comes back as "Unknown command".
 * That cost a whole acceptance run to diagnose, so the shape is a gate now —
 * checkable without the `claude` binary.
 */
function checkPluginManifests() {
  let checked = 0;
  const pluginJsonPath = join(REPO_ROOT, '.claude-plugin', 'plugin.json');
  const marketplacePath = join(REPO_ROOT, '.claude-plugin', 'marketplace.json');

  const readJson = (path, label) => {
    if (!existsSync(path)) {
      fail(7, `${label} does not exist at ${relative(REPO_ROOT, path)}`);
      return null;
    }
    try {
      return JSON.parse(readText(path));
    } catch (err) {
      fail(7, `${label} is not valid JSON: ${err.message}`);
      return null;
    }
  };

  const plugin = readJson(pluginJsonPath, 'plugin.json');
  if (plugin) {
    checked++;
    if (typeof plugin.name !== 'string' || plugin.name.length === 0) {
      fail(7, 'plugin.json has no name');
    }
    // `agents` must be absent (auto-discovery from agents/) or an array of
    // files. A string here is the exact shape the loader rejects.
    if (Object.hasOwn(plugin, 'agents')) {
      checked++;
      if (!Array.isArray(plugin.agents)) {
        fail(
          7,
          `plugin.json "agents" must be an array of file paths or be absent (auto-discovery), got ${typeof plugin.agents}: ` +
          `${JSON.stringify(plugin.agents)} — a string here makes --plugin-dir load nothing, silently`,
        );
      } else {
        for (const entry of plugin.agents) {
          checked++;
          if (typeof entry !== 'string') {
            fail(7, `plugin.json "agents" entry is not a string: ${JSON.stringify(entry)}`);
            continue;
          }
          const abs = resolve(REPO_ROOT, entry.replace(/^\.\//, ''));
          if (!existsSync(abs) || !statSync(abs).isFile()) {
            fail(7, `plugin.json "agents" entry "${entry}" does not resolve to a file`);
          }
        }
      }
    }
    for (const [key, kind] of [['skills', 'directory'], ['hooks', 'file']]) {
      if (!Object.hasOwn(plugin, key)) continue;
      checked++;
      const value = plugin[key];
      if (typeof value !== 'string') {
        fail(7, `plugin.json "${key}" must be a path string, got ${typeof value}`);
        continue;
      }
      const abs = resolve(REPO_ROOT, value.replace(/^\.\//, ''));
      if (!existsSync(abs)) {
        fail(7, `plugin.json "${key}" path "${value}" does not exist`);
      } else if (kind === 'directory' && !statSync(abs).isDirectory()) {
        fail(7, `plugin.json "${key}" path "${value}" is not a directory`);
      } else if (kind === 'file' && !statSync(abs).isFile()) {
        fail(7, `plugin.json "${key}" path "${value}" is not a file`);
      }
    }
  }

  const marketplace = readJson(marketplacePath, 'marketplace.json');
  if (marketplace) {
    checked++;
    if (typeof marketplace.description !== 'string' || marketplace.description.trim().length === 0) {
      fail(7, 'marketplace.json has no description (the validator warns, and users see nothing)');
    }
    if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
      fail(7, 'marketplace.json has no plugins array');
    } else {
      for (const entry of marketplace.plugins) {
        checked++;
        const source = entry?.source;
        if (typeof source !== 'string' || source.length === 0) {
          fail(7, `marketplace.json plugin "${entry?.name ?? '<unnamed>'}" has no source`);
          continue;
        }
        const abs = resolve(REPO_ROOT, source.replace(/^\.\//, ''));
        if (!existsSync(abs)) {
          fail(7, `marketplace.json plugin source "${source}" does not exist`);
        }
      }
    }
  }

  return checked;
}

// ── Run ────────────────────────────────────────────────────────────────

async function main() {
  const namesChecked = checkNames();
  const agentRefsChecked = checkAgentReferences();
  const slashRefsChecked = checkSlashReferences();
  const scriptPathsChecked = checkScriptPaths();
  const hooksJsonChecked = checkHooksJsonPaths();
  const localeKeysChecked = await checkLocaleParity();
  const manifestEntriesChecked = checkPluginManifests();

  console.log(
    [
      `check-refs: ${skillDirNames.length} skills, ${agentFileNames.length} agents checked for name identity (${namesChecked} entries)`,
      `  agent references checked: ${agentRefsChecked}`,
      `  slash references checked: ${slashRefsChecked}`,
      `  script path references checked: ${scriptPathsChecked}`,
      `  hooks.json plugin-root paths checked: ${hooksJsonChecked}`,
      `  locale key entries checked: ${localeKeysChecked}`,
      `  plugin manifest entries checked: ${manifestEntriesChecked}`,
    ].join('\n'),
  );

  if (violations.length > 0) {
    console.error(`\n${violations.length} broken reference(s) found:`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log('\nAll references resolved. OK.');
}

await main();
