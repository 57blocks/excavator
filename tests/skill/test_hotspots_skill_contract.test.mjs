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

/** A small repository with a rename, two authors, two directories and a pair changed together, and its product. */
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
  // src/b.js and docs/readme.md change together a third time: one listed pair
  commit({ 'src/b.js': 'a\nb\nc\nd\n', 'docs/readme.md': 'r\ns\n' });
  commit({ 'src/b.js': 'a\nb\nc\nd\ne\n', 'docs/readme.md': 'r\ns\nt\n' });
  const run = spawnSync('node', [SCRIPT, dir], { encoding: 'utf-8' });
  const product = join(dir, '.excavator/hotspots.json');
  return { dir, run, product };
})();
afterAll(() => rmSync(fixture.dir, { recursive: true, force: true }));
const product = () => JSON.parse(readFileSync(fixture.product, 'utf-8'));

/** The products of a plain directory and of a repository's subdirectory: the two reasons for no history. */
const noHistoryFixtures = (() => {
  const plain = realpathSync(mkdtempSync(join(tmpdir(), 'hotspots-contract-plain-')));
  writeFileSync(join(plain, 'a.js'), 'a\n');
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'hotspots-contract-sub-')));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (args) => execFileSync('git', args, { cwd: repo, env });
  git(['init', '-q', '-b', 'main']);
  execFileSync('mkdir', ['-p', join(repo, 'apps/web')]);
  writeFileSync(join(repo, 'apps/web/a.js'), 'a\n');
  git(['add', '-A']);
  git(['-c', 'user.name=alice', '-c', 'user.email=alice@example.test', 'commit', '-q', '-m', 'change']);
  const read = (root) => {
    const run = spawnSync('node', [SCRIPT, root], { encoding: 'utf-8' });
    expect(run.status, run.stderr).toBe(0);
    return JSON.parse(readFileSync(join(root, '.excavator/hotspots.json'), 'utf-8'));
  };
  return { dirs: [plain, repo], read: () => ({ plain: read(plain), sub: read(join(repo, 'apps/web')) }) };
})();
afterAll(() => noHistoryFixtures.dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

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
    expect(s).toContain('means a history exists but cannot be read here: never describe that project as having no history');
    expect(s).toContain('do not convert a phrase such as "last year" into a date yourself');
  });

  it('step 2 reads the header with jq and settles what the history can show first', () => {
    const s = step.get(2);
    expect(s).toContain("Never read `$HS` whole");
    expect(s).toContain(`jq 'del(.files, .directories, .pairs)' "$HS"`);
    expect(s).toContain('**`coChange`:**');
    expect(s).toContain('The two sets do not overlap, so never give one count as a part of the other');
    expect(s).toContain('**`historyAvailable` is false:**');
    expect(s).toContain('there is no ranking to report');
    expect(s).toContain('Say first why, from `noHistory.reason`');
    expect(s).toContain('`not-a-repository`: the project root is not inside a Git work tree, and no child directory is a Git repository with commits.');
    expect(s).toContain('gives this directory\'s numbers in the directory row `noHistory.pathInRepository`');
    expect(s).toContain('Never say this project is not a Git repository.');
    expect(s).not.toContain('the project is not a Git repository and holds no member repositories');
    expect(s).toContain("Say first that this repo's counts are lower bounds");
  });

  it('step 3 reads the rankings, the conflicts and the residual assumptions', () => {
    const s = step.get(3);
    expect(s).toContain('select(.lineageConflicts > 0)');
    expect(s).toContain(`jq -r '.residualAssumptions[]' "$HS"`);
    expect(s).toContain(`jq -r '.pairs[:20][] | [.together, .shareOfA, .shareOfB, .a, .b] | @tsv' "$HS"`);
    expect(s).toContain('leaving out every pair with a path that looks like a test by its name');
    expect(s).toContain('select(.a == $p or .b == $p)');
    expect(s).toContain('when that is more than the rows you show, say how many you show out of how many');
  });

  it('filters out pairs whose paths look like tests by name, and keeps the others', () => {
    const line = jqLines(bashBlocks(rawStep(3))).find((recipe) => recipe.includes('all(test('));
    const pair = (a, b) => ({ a, b, together: 3, shareOfA: 1, shareOfB: 1 });
    const kept = [pair('src/Engine.java', 'src/Context.java'), pair('web/page.xhtml', 'props/Bundle.properties'), pair('lib/contest.js', 'lib/latest.js')];
    const tests = [
      pair('src/main/A.java', 'src/test/java/ATest.java'), pair('a.ts', 'a.test.ts'), pair('b.js', 'b.spec.js'), pair('c.go', 'c_test.go'),
      pair('d.py', 'test_d.py'), pair('e.js', '__tests__/e.js'), pair('f.rb', 'spec/f_spec.rb'), pair('g.java', 'GTests.java'),
    ];
    const product = join(fixture.dir, '.excavator/pairs-filter.json');
    writeFileSync(product, JSON.stringify({ pairs: [...kept, ...tests] }));
    const result = spawnSync('sh', ['-c', line.replaceAll('"$HS"', JSON.stringify(product))], { encoding: 'utf-8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split('\n').map((row) => row.split('\t').slice(3).join(' '))).toEqual(kept.map((p) => `${p.a} ${p.b}`));
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
    expect(s).toContain('**A pair is a count, not a link.**');
    expect(s).toContain('Never say that one file depends on, calls, uses or causes changes in the other');
    expect(s).toContain('5. Files changed together: the top pairs, then the top pairs where no path looks like a test by its name');
    expect(s).toContain('Show the second list whole, every row its query prints, and do not describe how it differs from the first');
    expect(s).toContain('introduced with the words "pairs where neither path looks like a test by its name (a filter on names, not on content)"');
    expect(s).toContain('**Never edit, move or delete project files, and never run a `git` command that changes the repository.**');
    expect(s).toContain('7. The residual assumptions, every one, as the product states them.');
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
    const header = /`(sourceRevision|sourceKind|historyAvailable|noHistory|repos|window|counts|coChange|conservation|residualAssumptions)`/g;
    for (const [, key] of skill.matchAll(header)) expect(p).toHaveProperty(key);
    for (const key of ['path', 'head', 'shallow', 'boundaryCommits', 'earliestVisibleCommit']) expect(p.repos[0]).toHaveProperty(key);
    for (const key of ['changesRead', 'attributed', 'outsideSelection']) expect(p.conservation).toHaveProperty(key);
    for (const key of ['since']) expect(p.window).toHaveProperty(key);
    for (const key of ['filesWithHistory', 'filesWithoutHistory', 'binaryFiles', 'filesWithLineageConflicts']) expect(p.counts).toHaveProperty(key);
    const fileFields = ['score', 'commits', 'authors', 'lines', 'added', 'removed', 'lastChanged', 'lineageConflicts', 'path'];
    for (const key of fileFields) expect(p.files[0]).toHaveProperty(key);
    for (const key of ['score', 'commits', 'authors', 'files', 'lines', 'path']) expect(p.directories[0]).toHaveProperty(key);
    for (const key of ['maxFilesPerCommit', 'minTogether', 'commitsOverLimit', 'pairsBelowMinimum']) expect(p.coChange).toHaveProperty(key);
    expect(p.pairs.length).toBeGreaterThan(0);
    for (const key of ['together', 'shareOfA', 'shareOfB', 'a', 'b']) expect(p.pairs[0]).toHaveProperty(key);
    for (const text of [skill, section]) {
      for (const [, key] of text.matchAll(/`coChange\.(\w+)`/g)) expect(p.coChange).toHaveProperty(key);
    }
  });

  it('names the reasons for no history and their fields as the script writes them', () => {
    const { plain, sub } = noHistoryFixtures.read();
    expect(plain.noHistory).toEqual({ reason: 'not-a-repository', repositoryRoot: null, pathInRepository: null });
    expect(sub.noHistory).toEqual({ reason: 'inside-repository', repositoryRoot: '../..', pathInRepository: 'apps/web' });
    for (const text of [skill, flat(section)]) {
      const keys = [...text.matchAll(/`noHistory\.(\w+)`/g)].map((match) => match[1]);
      expect(new Set(keys)).toEqual(new Set(['reason', 'repositoryRoot', 'pathInRepository']));
      for (const key of keys) expect(sub.noHistory).toHaveProperty(key);
      for (const reason of ['not-a-repository', 'inside-repository']) expect(text).toContain(`\`${reason}\``);
    }
  });

  it('the one-file pairs query of the skill and of chat prints how many pairs include the file, then the rows', () => {
    const listed = product().pairs.filter((p) => p.a === 'src/b.js' || p.b === 'src/b.js');
    expect(listed.length).toBeGreaterThan(0);
    for (const [text, productPath] of [[rawStep(3), '"$HS"'], [section, '.excavator/hotspots.json']]) {
      const line = jqLines(bashBlocks(text)).find((recipe) => recipe.includes('select(.a == $p or .b == $p)'));
      const command = line.replaceAll(productPath, JSON.stringify(fixture.product)).replaceAll('<path>', 'src/b.js');
      const result = spawnSync('sh', ['-c', command], { encoding: 'utf-8' });
      expect(result.status, result.stderr).toBe(0);
      const rows = result.stdout.trim().split('\n');
      expect(rows[0]).toBe(`listed pairs with this file: ${listed.length}`);
      expect(rows.length).toBe(1 + Math.min(listed.length, 20));
    }
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
    for (const cause of ['src/b.js depends on docs/readme.md.', 'A change in x causes changes in y.', 'x calls y.', 'b.js 依赖 readme.md。', '改 a 导致要改 b。']) {
      expect(check(`${cause}\n`).stdout, cause).not.toBe('');
    }
    for (const plain of ['gradle/dependencies.gradle and pom.xml changed together in 5 commits.', 'src/FooCallback.java changed in 4 commits.']) {
      expect(check(`${plain}\n`).status, plain).toBe(1);
    }
  });
});

describe('excavator-chat: change-history questions', () => {
  it('routes change-history questions before the graph check', () => {
    const stepOne = flat(chat.split(/^## Instructions$/m)[1].split(/^1\. /m)[1].split(/^2\. /m)[0]);
    expect(stepOne).toContain('**Change-history questions do not need the graph.**');
    expect(stepOne).toContain('or about which files changed in the same commits as a file (what usually changes along with it)');
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
    expect(s).toContain('`historyAvailable` false: every history field is `null`, so do not rank; say why from `noHistory.reason`.');
    expect(s).toContain('jq \'{sourceKind, historyAvailable, noHistory, repos, window, counts, coChange, conservation}\'');
    expect(s).toContain('gives this directory\'s numbers in the directory row `noHistory.pathInRepository`');
    expect(s).toContain('Never say such a project is not a Git repository.');
    expect(s).not.toContain('there is no Git history');
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
    expect(s).toContain('**A pair is a count, not a link**: never say that one file depends on, calls, uses or causes changes in the other');
    expect(s).toContain('A file in no listed pair was not changed together with any file at least `coChange.minTogether` times');
    expect(s).toContain('Its first line is how many listed pairs include the file; when that is more than the rows you show, say how many you show out of how many.');
    expect(s).toContain('never that it does not change with other files');
    expect(s).toContain('A question about what depends on or calls a file is about the code, not its history: answer it from the graph.');
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
