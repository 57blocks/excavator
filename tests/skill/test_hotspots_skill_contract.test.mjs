/**
 * The excavator-hotspots skill and the chat section that answers from its
 * product are prompts; their rules only hold if each one sits in the step where
 * the model acts on it. These tests pin every rule to its step, run the skill's
 * own jq recipes and advice check against a real product, and check that every
 * product field the prose names is one the script writes.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const skill = readFileSync(resolve(repoRoot, 'skills/excavator-hotspots/SKILL.md'), 'utf-8');
const chat = readFileSync(resolve(repoRoot, 'skills/excavator-chat/SKILL.md'), 'utf-8');
const SCRIPT = resolve(repoRoot, 'skills/excavator/hotspots.mjs');
const flat = (text) => text.replace(/\s+/g, ' ');

/** Split the skill into its `## Step N — Title` sections, keyed by N. */
function steps(text) {
  const out = new Map();
  const parts = text.split(/^## Step (\d+) — /m);
  for (let i = 1; i < parts.length; i += 2) out.set(Number(parts[i]), flat(parts[i + 1]));
  return out;
}
const step = steps(skill);
const before = flat(skill.split(/^## Step 1 — /m)[0]);
const rawStep = (n) => skill.split(new RegExp(`^## Step ${n} — `, 'm'))[1].split(/^## Step /m)[0];
const bashBlocks = (text) => [...text.matchAll(/^ *```bash\n([\s\S]*?)^ *```$/gm)].map((m) => m[1]);
const jqLines = (blocks) => blocks.flatMap((block) => block.split('\n')).map((line) => line.trim()).filter((line) => line.startsWith('jq '));
/** Run one jq recipe on the fixture product; a placeholder path is a file, or a directory for a directory lookup. */
function runRecipe(line, productPath) {
  const command = line.replaceAll(productPath, JSON.stringify(fixture.product))
    .replaceAll('<path>', line.includes('.directories[]') ? 'src' : 'src/b.js').replaceAll('<dir>', 'src');
  const result = spawnSync('sh', ['-c', command], { encoding: 'utf-8' });
  expect(result.status, `${line}\n${result.stderr}`).toBe(0);
  // the fixture has no lineage conflicts, so only that listing may be empty
  if (!line.includes('.lineageConflicts > 0')) expect(result.stdout.trim().length, line).toBeGreaterThan(0);
}
const section = chat.split('### Change-history questions')[1].split(/^##+ /m)[0];

/** A small repository with a rename, two authors and two directories, and its product. */
const fixture = (() => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hotspots-contract-')));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (args, extra = {}) => execFileSync('git', args, { cwd: dir, env: { ...env, ...extra } });
  git(['init', '-q', '-b', 'main']);
  let day = 1;
  const commit = (files, who = 'alice') => {
    for (const [path, content] of Object.entries(files)) {
      execFileSync('mkdir', ['-p', dirname(join(dir, path))]);
      writeFileSync(join(dir, path), content);
    }
    git(['add', '-A']);
    const when = `2024-01-0${day++}T10:00:00+00:00`;
    git(['-c', `user.name=${who}`, '-c', `user.email=${who}@example.test`, 'commit', '-q', '-m', 'change'],
      { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  };
  commit({ 'src/a.js': 'a\n', 'docs/readme.md': 'r\n' });
  commit({ 'src/a.js': 'a\nb\n' }, 'bob');
  git(['mv', 'src/a.js', 'src/b.js']);
  commit({ 'src/b.js': 'a\nb\nc\n' });
  const run = spawnSync('node', [SCRIPT, dir], { encoding: 'utf-8' });
  const product = join(dir, '.excavator/hotspots.json');
  return { dir, run, product };
})();
afterAll(() => rmSync(fixture.dir, { recursive: true, force: true }));
const product = () => JSON.parse(readFileSync(fixture.product, 'utf-8'));

describe('excavator-hotspots skill: steps', () => {
  it('has the four steps in order', () => {
    const titles = [...skill.matchAll(/^## Step \d+ — (.+)$/gm)].map((m) => m[1]);
    expect(titles).toEqual(['Run the count', 'Read the header', 'Read the rankings', 'Report to the user']);
    expect([...step.keys()]).toEqual([1, 2, 3, 4]);
  });

  it('frontmatter names the skill after its directory', () => {
    expect(skill.startsWith('---\nname: excavator-hotspots\n')).toBe(true);
  });

  it('does not need the knowledge graph', () => {
    expect(before).toContain('The product does not depend on the knowledge graph: no `/excavator` run is needed first.');
  });
});

describe('excavator-hotspots skill: each rule in its step', () => {
  it('step 1 runs the script and reports a refusal as it stands', () => {
    const s = step.get(1);
    expect(s).toContain('node "$PLUGIN_ROOT/skills/excavator/hotspots.mjs" "$PROJECT_ROOT"');
    expect(s).toContain('A non-zero exit writes no product.');
    expect(s).toContain('do not convert a phrase such as "last year" into a date yourself');
  });

  it('step 2 reads the header with jq and settles what the history can show first', () => {
    const s = step.get(2);
    expect(s).toContain("Never read `$HS` whole");
    expect(s).toContain(`jq 'del(.files, .directories)' "$HS"`);
    expect(s).toContain('**`historyAvailable` is false:**');
    expect(s).toContain('there is no ranking to report');
    expect(s).toContain("Say first that this repo's counts are lower bounds");
  });

  it('step 3 reads the rankings, the conflicts and the residual assumptions', () => {
    const s = step.get(3);
    expect(s).toContain('select(.lineageConflicts > 0)');
    expect(s).toContain(`jq -r '.residualAssumptions[]' "$HS"`);
  });

  it('step 4 states only product numbers, gives no advice and checks for it', () => {
    const s = step.get(4);
    expect(s).toContain('**State only numbers the product holds.**');
    expect(s).toContain('**Give no advice.**');
    expect(s).toContain('**A ranking by another field comes from its own query over every file.**');
    expect(s).toContain('**Say what a conflict means.**');
    expect(s).toContain('its counts may miss part of its history or include another history that once had the same path');
    expect(s).toContain('A 0 means no conflict was detected, not that the counts are complete; never call a count reliable or accurate.');
    expect(s).toContain("**A shallow repo's counts are lower bounds.**");
    expect(s).toContain('**Never edit, move or delete project files, and never run a `git` command that changes the repository.**');
    expect(s).toContain('6. The residual assumptions, every one, as the product states them.');
    expect(s).toContain('ending with the line `advice check: 0 lines`');
  });

  it('keeps the step rules out of the preamble, where they would be skipped', () => {
    for (const rule of ['Give no advice', 'State only numbers', 'lower bounds']) expect(before).not.toContain(rule);
  });
});

describe('excavator-hotspots skill: agrees with the script', () => {
  it('the fixture product was written', () => {
    expect(fixture.run.status, fixture.run.stderr).toBe(0);
  });

  it('names only header, file and directory fields the product has', () => {
    const p = product();
    const header = /`(sourceRevision|sourceKind|historyAvailable|repos|window|counts|conservation|residualAssumptions)`/g;
    for (const [, key] of skill.matchAll(header)) expect(p).toHaveProperty(key);
    for (const key of ['path', 'head', 'shallow', 'boundaryCommits', 'earliestVisibleCommit']) expect(p.repos[0]).toHaveProperty(key);
    for (const key of ['changesRead', 'attributed', 'outsideSelection']) expect(p.conservation).toHaveProperty(key);
    for (const key of ['since']) expect(p.window).toHaveProperty(key);
    for (const key of ['filesWithHistory', 'filesWithoutHistory', 'binaryFiles', 'filesWithLineageConflicts']) expect(p.counts).toHaveProperty(key);
    const fileFields = ['score', 'commits', 'authors', 'lines', 'added', 'removed', 'lastChanged', 'lineageConflicts', 'path'];
    for (const key of fileFields) expect(p.files[0]).toHaveProperty(key);
    for (const key of ['score', 'commits', 'authors', 'files', 'lines', 'path']) expect(p.directories[0]).toHaveProperty(key);
  });

  it('runs every jq recipe of steps 2 and 3 on the product', () => {
    const recipes = jqLines([...bashBlocks(rawStep(2)), ...bashBlocks(rawStep(3))]);
    expect(recipes.length).toBeGreaterThanOrEqual(7);
    for (const line of recipes) runRecipe(line, '"$HS"');
  });

  it('the advice check catches advice and passes the residual assumptions as they stand', () => {
    const grep = bashBlocks(rawStep(4)).map((block) => block.trim()).find((block) => block.startsWith('grep '));
    const check = (text) => {
      const report = join(fixture.dir, '.excavator/hotspots-report.md');
      writeFileSync(report, text);
      return spawnSync('sh', ['-c', grep.replaceAll('"$DATA/hotspots-report.md"', JSON.stringify(report))], { encoding: 'utf-8' });
    };
    expect(check(`${product().residualAssumptions.join('\n')}\n`).status).toBe(1);
    for (const advice of ['You should refactor src/b.js.', 'Consider splitting it.', 'We recommend more tests.', '建议拆分这个文件。', '这个目录应该重构。']) {
      expect(check(`${advice}\n`).stdout, advice).not.toBe('');
    }
  });
});

describe('excavator-chat: change-history questions', () => {
  it('routes change-history questions before the graph check', () => {
    const stepOne = flat(chat.split(/^## Instructions$/m)[1].split(/^1\. /m)[1].split(/^2\. /m)[0]);
    expect(stepOne).toContain('**Change-history questions do not need the graph.**');
    expect(stepOne.indexOf('Change-history questions')).toBeLessThan(stepOne.indexOf('knowledge-graph.jsonl'));
  });

  it('answers only from the product, never from the graph', () => {
    const s = flat(section);
    expect(s).toContain('Answer these questions only from `.excavator/hotspots.json`');
    expect(s).toContain('**Never infer change history from the graph**');
    expect(s).toContain('**Product missing:** say this project has no change-history count yet and suggest running `/excavator-hotspots`');
  });

  it('checks freshness against the shared helper', () => {
    const s = flat(section);
    expect(s).toContain('jq -r .sourceRevision .excavator/hotspots.json');
    expect(s).toContain('skills/excavator/consumer-freshness.mjs" "$PROJECT_ROOT" 2>/dev/null | jq -r .currentSourceRevision');
    expect(s).toContain('say the product is stale');
    expect(s).toContain('Do not estimate how much the new commits change the counts or the ranking');
  });

  it('says lower bounds, no history and conflicts, and gives no advice', () => {
    const s = flat(section);
    expect(s).toContain('its counts are lower bounds');
    expect(s).toContain('`historyAvailable` false: there is no Git history');
    expect(s).toContain('its counts may miss part of its history or include another history that once had the same path');
    expect(s).toContain('Give no advice about what to change');
    expect(s).toContain('**`lineageConflicts` 0 means no conflict was detected, not that the counts are complete**');
    expect(s).toContain('do not explain why a file changes often');
    expect(s).toContain('**A ranking by any other field comes from its own query over every file**');
    expect(s).toContain('mostCommits: ([.files[] | select(.commits != null)] | sort_by(-.commits)');
    expect(s).toContain('it gives the score ranking together with the files that lead on `commits` and on `authors` over the whole list');
    expect(s).toContain('do not inspect them to judge it');
    expect(s).toContain('call `finalizeVerifiedAnswerLanguage` as that gate says, and write the whole answer, notes included, in the language it returns');
    expect(s).toContain('`lines` is the file\'s line count at HEAD, not lines changed');
  });

  it('the freshness helper and the product agree on the revision of an unchanged project', () => {
    const helper = spawnSync('node', [resolve(repoRoot, 'skills/excavator/consumer-freshness.mjs'), fixture.dir], { encoding: 'utf-8' });
    expect(JSON.parse(helper.stdout).currentSourceRevision).toBe(product().sourceRevision);
  });

  it('runs the lookup recipes on the product', () => {
    const recipes = jqLines(bashBlocks(section));
    expect(recipes.length).toBeGreaterThanOrEqual(5);
    for (const line of recipes) runRecipe(line, '.excavator/hotspots.json');
  });
});
