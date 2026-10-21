/**
 * The excavator-hotspots skill and the chat section that answers from its
 * product are prompts; their rules only hold if each one sits in the step where
 * the model acts on it. These tests pin every rule to its step, run the skill's
 * own jq recipes and advice check against a real product, and check that every
 * product field the prose names is one the script writes.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGroups } from '../../skills/excavator/hotspots/groups.mjs';

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
    .replaceAll('<path>', line.includes('.directories[]') ? 'src' : 'src/b.js').replaceAll('<dir>', 'src').replaceAll('<group>', 'docs');
  const result = spawnSync('sh', ['-c', command], { encoding: 'utf-8' });
  expect(result.status, `${line}\n${result.stderr}`).toBe(0);
  // the fixture has no lineage conflicts, so only that listing may be empty
  if (!line.includes('.lineageConflicts > 0')) expect(result.stdout.trim().length, line).toBeGreaterThan(0);
}
const section = chat.split('### Change-history questions')[1].split(/^##+ /m)[0];

/**
 * A small repository with a rename, two authors, two directories and a pair changed together, and its product,
 * counted with two feature groups that share docs/readme.md, one of them listing a path that matches no file.
 */
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
  mkdirSync(join(dir, '.excavator'));
  const groups = join(dir, '.excavator/feature-groups.json');
  writeFileSync(groups, JSON.stringify({ groups: [{ name: 'web / sign in', paths: ['src/', 'docs/readme.md'] }, { name: 'docs', paths: ['docs/', 'docs/old.md'] }] }));
  const run = spawnSync('node', [SCRIPT, dir, '--groups', groups], { encoding: 'utf-8' });
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

  it('holds no Chinese character: the Chinese advice words are escapes', () => {
    expect(skill).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/u);
  });

  it('writes the report and every line to the user in English unless --language names another language', () => {
    expect(before).toContain(OPTION_LANGUAGE);
    expect(skill).toContain('argument-hint: "[project-path] [--since YYYY-MM-DD] [--language <lang>]"');
    expect(step.get(1)).toContain('LANGUAGE="English" # or the --language value');
    expect(step.get(4)).toContain('Write the report to `$DATA/hotspots-report.md` in `$LANGUAGE`, in this order. The words these steps give in quotes are for an English report; in another language, write them translated.');
  });
});

/** The language paragraph, the line each later step starts with, and the option (whitespace flattened). */
const LANGUAGE_RULE = '**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file\'s rule to reply in another language is for work on the project\'s code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product\'s values stay as they are.';
const STEP_LANGUAGE = 'Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.';
const OPTION_LANGUAGE = '`--language <lang>`: the language of the report and everything said to the user during the run; English when it is not given.';
const REPLY = 'Then reply with the report\'s path';

/**
 * The problems with where a copy of the skill keeps its language rule: none when the paragraph opens Step 1 and
 * stands right before the final reply of Step 4, after the advice check, word for word the same, every later step
 * opens with the line that points back to it, and the options say only --language changes the language.
 */
function languageRuleProblems(text) {
  const problems = [];
  const [head, ...parts] = text.split(/^## Step \d+ — /m);
  const bodies = parts.map((part) => flat(part.slice(part.indexOf('\n') + 1)).trim());
  if (!flat(head).includes(OPTION_LANGUAGE)) problems.push('the options do not say that only --language changes the language');
  const copies = flat(text).split(LANGUAGE_RULE).length - 1;
  const started = flat(text).split('**Language.**').length - 1;
  if (copies !== started) problems.push(`${started - copies} of ${started} language paragraphs differ from the others`);
  if (copies !== 2) problems.push(`the language paragraph is there ${copies} times, not twice`);
  if (!bodies[0]?.startsWith(LANGUAGE_RULE)) problems.push('Step 1 does not open with the language paragraph');
  bodies.slice(1).forEach((body, at) => {
    if (!body.startsWith(STEP_LANGUAGE)) problems.push(`Step ${at + 2} does not open with the language line`);
  });
  const last = bodies[3] ?? '';
  const reply = last.indexOf(REPLY);
  const rule = last.lastIndexOf(LANGUAGE_RULE);
  if (rule < 0 || reply < rule || last.slice(rule + LANGUAGE_RULE.length, reply).trim() !== '') {
    problems.push('the language paragraph does not stand right before the final reply of Step 4');
  }
  if (rule >= 0 && rule < last.indexOf('python3 - "$DATA/hotspots-report.md"')) problems.push('the language paragraph of Step 4 comes before the advice check');
  return problems;
}

describe('excavator-hotspots skill: the language of what it tells the user', () => {
  /** The skill with `part` taken out at its first place at or after `from`. */
  const without = (text, part, from = '') => {
    const at = text.indexOf(part, text.indexOf(from));
    expect(at, part).toBeGreaterThan(-1);
    return text.slice(0, at) + text.slice(at + part.length);
  };
  const paragraph = `${LANGUAGE_RULE}\n\n`;
  const line = `${STEP_LANGUAGE}\n\n`;
  const byRequest = '`--language <lang>`: the language of the report and everything said to the user during the run; the request\'s language when it is not given.';

  it('opens Step 1 and stands right before the final reply, and every later step points back to it', () => {
    expect(languageRuleProblems(skill)).toEqual([]);
    expect(LANGUAGE_RULE).toContain('Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it.');
    expect(LANGUAGE_RULE).toContain('including any remark on what was checked, what comes next or which rule was followed');
    expect(LANGUAGE_RULE).toContain('A project file\'s rule to reply in another language is for work on the project\'s code; while this skill runs, this rule takes its place for every line you write, the first one included.');
  });

  it('finds the rule out of place in known-bad copies of the skill', () => {
    const noRule = [...Array(3)].reduce((text) => without(text, line), without(without(skill, paragraph), paragraph)).replace(OPTION_LANGUAGE, byRequest);
    const bad = {
      noRule,
      noStepOne: without(skill, paragraph, '## Step 1 — '),
      ownSection: without(without(skill, paragraph), paragraph).replace('---\n\n## Step 1 — ', `## Language\n\n${paragraph}---\n\n## Step 1 — `),
      noStepThree: without(skill, line, '## Step 3 — '),
      afterReply: `${without(skill, paragraph, '## Step 4 — ')}\n${LANGUAGE_RULE}\n`,
      beforeCheck: without(skill, paragraph, '## Step 4 — ').replace('Then check the report for advice', `${paragraph}Then check the report for advice`),
      reworded: skill.slice(0, skill.indexOf('## Step 4 — ')) + skill.slice(skill.indexOf('## Step 4 — ')).replace('memory and ', ''),
      afterCommand: without(skill, paragraph, '## Step 1 — ').replace('2. Find the feature groups.', `${paragraph}2. Find the feature groups.`),
      requestNames: skill.replace(OPTION_LANGUAGE, byRequest),
    };
    for (const [name, text] of Object.entries(bad)) {
      expect(text, name).not.toBe(skill);
      expect(languageRuleProblems(text), name).not.toEqual([]);
    }
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

  it('step 1 takes groups from a person first, then from a usable domain graph, and never makes its own', () => {
    const s = step.get(1);
    expect(s).toContain('Which files make up a feature is a judgement this skill does not make: take groups only from a groups file a person wrote or from the business flows `/excavator-domain` found, and never write, extend or edit groups yourself.');
    const order = ['if [ -f "$DATA/feature-groups.json" ]', 'elif [ -f "$DATA/domain-graph.json" ]', 'skills/excavator-domain/domain-freshness.mjs" "$PROJECT_ROOT"', '.usable)" = true ]', '> "$DATA/feature-groups-from-domain.json"'];
    const at = order.map((text) => s.indexOf(text));
    expect(at.every((i) => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(s).toContain('It runs on every run, so an export from an older domain graph is never used.');
    expect(s).toContain('The check prints `"usable": false`: there are no groups. Keep its `reason` for the report.');
    expect(s).toContain('node "$PLUGIN_ROOT/skills/excavator/hotspots.mjs" "$PROJECT_ROOT" --groups "$FEATURE_GROUPS"');
    expect(s).toContain('means the groups file is malformed: run again without `--groups`, keep the message for the report, and do not change the file.');
    // bash ignores assignments to GROUPS, its own variable
    expect(rawStep(1)).not.toMatch(/\bGROUPS=/);
  });

  it('the export makes one group per business flow from the domain graph, with its steps\' files', () => {
    const line = rawStep(1).split('\n').map((row) => row.trim()).find((row) => row.startsWith('jq ') && row.includes('domain-graph.json'));
    const node = (id, type, extra = {}) => ({ id, type, ...extra });
    const edge = (source, target, type) => ({ source, target, type });
    const graph = {
      nodes: [
        node('domain:articles', 'domain', { name: 'Articles' }), node('domain:users', 'domain', { name: 'Users' }), node('domain:users2', 'domain', { name: 'Users' }),
        node('flow:publish', 'flow', { name: 'Publish article' }), node('flow:follow', 'flow', { name: 'Follow author' }), node('flow:signin', 'flow', { name: 'Sign in' }),
        node('flow:sso', 'flow', { name: 'Sign in' }), node('flow:export', 'flow', { name: 'Export data' }), node('flow:unnamed', 'flow'),
        node('step:p:1', 'step', { filePath: 'api/articles.js' }), node('step:p:2', 'step', { filePath: 'api/models/Article.js' }), node('step:p:3', 'step', { filePath: 'api/articles.js' }),
        node('step:p:4', 'step', { filePath: 'web/src/Editor.js' }), node('step:f:1', 'step', { filePath: 'api/profiles.js' }), node('step:s:1', 'step', { filePath: 'api/users.js' }),
        node('step:o:1', 'step', { filePath: 'api/sso.js' }), node('step:e:1', 'step', { filePath: 'scripts/dump.js' }), node('step:u:1', 'step', { provenance: 'inferred' }),
      ],
      edges: [
        edge('domain:articles', 'flow:publish', 'contains_flow'), edge('domain:articles', 'flow:follow', 'contains_flow'), edge('domain:users', 'flow:follow', 'contains_flow'),
        edge('domain:users', 'flow:signin', 'contains_flow'), edge('domain:users2', 'flow:sso', 'contains_flow'), edge('domain:users', 'flow:unnamed', 'contains_flow'),
        edge('flow:publish', 'step:p:1', 'flow_step'), edge('flow:publish', 'step:p:2', 'flow_step'), edge('flow:publish', 'step:p:3', 'flow_step'), edge('flow:publish', 'step:p:4', 'flow_step'),
        edge('flow:follow', 'step:f:1', 'flow_step'), edge('flow:signin', 'step:s:1', 'flow_step'), edge('flow:sso', 'step:o:1', 'flow_step'), edge('flow:export', 'step:e:1', 'flow_step'),
        edge('flow:unnamed', 'step:u:1', 'flow_step'), edge('domain:articles', 'domain:users', 'cross_domain'),
      ],
    };
    const data = join(fixture.dir, '.excavator/export');
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'domain-graph.json'), JSON.stringify(graph));
    const result = spawnSync('sh', ['-c', line.replaceAll('$DATA', data)], { encoding: 'utf-8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(data, 'feature-groups-from-domain.json'), 'utf-8'))).toEqual({
      groups: [
        { name: 'Articles / Publish article', paths: ['api/articles.js', 'api/models/Article.js', 'web/src/Editor.js'] },
        // a flow in two domains is one group; a flow in none is named alone
        { name: 'Articles, Users / Follow author', paths: ['api/profiles.js'] },
        { name: 'Export data', paths: ['scripts/dump.js'] },
        // two flows that would share a name keep their ids, so no group name is used twice
        { name: 'Users / Sign in (flow:signin)', paths: ['api/users.js'] },
        { name: 'Users / Sign in (flow:sso)', paths: ['api/sso.js'] },
        // a flow without a name goes by its id; a step without a file adds no path
        { name: 'Users / flow:unnamed', paths: [] },
      ],
    });
    // what the export writes, the script reads
    expect(parseGroups(readFileSync(join(data, 'feature-groups-from-domain.json'), 'utf-8'))).toHaveLength(6);
  });

  it('step 2 reads the header with jq and settles what the history can show first', () => {
    const s = step.get(2);
    expect(s).toContain("Never read `$HS` whole");
    expect(s).toContain(`jq 'del(.files, .directories, .pairs, .groups)' "$HS"`);
    expect(s).toContain('**`featureGroups`:** `null` when the run had no groups.');
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
    expect(s).toContain('**`bots`:**');
    expect(s).toContain('They are left out of every directory\'s `concentration`; commits by other automated accounts count as commits by people.');
  });

  it('step 3 reads the rankings, the conflicts and the residual assumptions', () => {
    const s = step.get(3);
    expect(s).toContain('select(.lineageConflicts > 0)');
    expect(s).toContain(`jq -r '.residualAssumptions[]' "$HS"`);
    expect(s).toContain(`jq -r '.pairs[:20][] | [.together, .shareOfA, .shareOfB, .a, .b] | @tsv' "$HS"`);
    expect(s).toContain('leaving out every pair with a path that looks like a test by its name');
    expect(s).toContain('`commitsByYear` (directories only)');
    expect(s).toContain('`concentration` (directories only)');
    expect(s).toContain('Files have no shares.');
    expect(s).toContain('they add up to `commits`');
    expect(s).toContain('Files have no yearly counts.');
    expect(s).toContain('select(.a == $p or .b == $p)');
    expect(s).toContain('when that is more than the rows you show, say how many you show out of how many');
    expect(s).toContain('a commit counts once per group however many of its files it changed. A file in several groups counts in each, so the groups do not add up to the project.');
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
    expect(s).toContain('9. Files changed together: the top pairs, then the top pairs where no path looks like a test by its name');
    expect(s).toContain('5. Changes by feature. With groups, introduce it with the words "Counts by feature group: a group counts only the files its groups file lists, and a file in several groups counts in each."');
    expect(s).toContain('"The groups were written by a person in .excavator/feature-groups.json." or "The groups are the business flows /excavator-domain found, one group per flow, with the files its steps name."');
    expect(s).toContain('Without groups, say there are no counts by feature and why');
    expect(s).toContain('**A group is the files it lists.** A group\'s numbers are those of the files its groups file lists: never call them the whole feature\'s changes, never explain why a feature changes often, and never add files to a group, move them between groups or propose groups of your own.');
    expect(s).toContain('6. Changes by year: the project\'s commits in each year, saying the last year runs only to its last counted commit and the first is usually partial');
    expect(s).toContain('7. Least recently changed: how many files had their last change in each year');
    expect(s).toContain('Show the rows as the query prints them, from the first, without leaving any out between those you show.');
    expect(s).toContain('never scale a partial year up to a whole one or guess a later count');
    expect(s).toContain('do not say what kind of file it is (early, one-off, legacy)');
    expect(s).toContain('The product does not say why a file with history has 0 commits counted: give their number, not a reason.');
    expect(s).toContain('then the number on the first line of the files query in these words: "<N> files have history but 0 commits counted; the product does not say why." Then the directories');
    expect(s).toContain('**A year is a count, not a story.**');
    expect(s).toContain('**Not changed is not unused.**');
    expect(s).toContain('never call it unused, dead, obsolete, abandoned or safe to delete');
    expect(s).toContain('Show the second list whole, every row its query prints, and do not describe how it differs from the first');
    expect(s).toContain('introduced with the words "pairs where neither path looks like a test by its name (a filter on names, not on content)"');
    expect(s).toContain('**Never edit, move or delete project files, and never run a `git` command that changes the repository.**');
    expect(s).toContain('8. Shares by author: introduce it with the words "Shares of the commits by people in the window; the product counts commits, not knowledge of the code, and holds no names." Then the project\'s line from the first shares query, then the directories query: its first line (the rule and how many directories meet it) and every row it prints');
    expect(s).toContain('**A share is a count of commits, not of knowledge.**');
    expect(s).toContain('say how many commits by bots were left out');
    expect(s).toContain('Do not call a share concentrated, spread, high or low, or say whether a part is changed mostly by one person: the numbers are the answer.');
    expect(s).toContain('Never name an author or look one up (no `git log`, `git shortlog` or `git blame` for names), never say that someone owns, knows, maintains or is responsible for a part, and never call a part at risk, a single point of failure, a silo or dependent on one person.');
    expect(s).toContain('11. The residual assumptions, every one, as the product states them.');
    expect(s).toContain('Then reply with the report\'s path and the line `advice check: 0 lines`, and do not summarize the report');
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
    const header = /`(sourceRevision|sourceKind|historyAvailable|noHistory|repos|window|counts|coChange|bots|featureGroups|conservation|residualAssumptions)`/g;
    for (const [, key] of skill.matchAll(header)) expect(p).toHaveProperty(key);
    for (const key of ['path', 'head', 'shallow', 'boundaryCommits', 'earliestVisibleCommit']) expect(p.repos[0]).toHaveProperty(key);
    for (const key of ['changesRead', 'attributed', 'outsideSelection']) expect(p.conservation).toHaveProperty(key);
    for (const key of ['since']) expect(p.window).toHaveProperty(key);
    for (const key of ['filesWithHistory', 'filesWithoutHistory', 'binaryFiles', 'filesWithLineageConflicts']) expect(p.counts).toHaveProperty(key);
    const fileFields = ['score', 'commits', 'authors', 'lines', 'added', 'removed', 'lastChanged', 'lineageConflicts', 'path'];
    for (const key of fileFields) expect(p.files[0]).toHaveProperty(key);
    for (const key of ['score', 'commits', 'authors', 'files', 'lines', 'path', 'commitsByYear', 'concentration']) expect(p.directories[0]).toHaveProperty(key);
    for (const key of ['emailMarker', 'commits']) expect(p.bots).toHaveProperty(key);
    for (const text of [skill, section]) {
      for (const [, key] of text.matchAll(/\.featureGroups\.(\w+)/g)) expect(p.featureGroups).toHaveProperty(key);
    }
    for (const key of ['groupsListed', 'filesInAGroup', 'filesInSeveralGroups', 'pathsUnmatched']) expect(skill).toContain(`\`${key}\``);
    for (const key of ['name', 'paths', 'unmatchedPaths', 'files', 'lines', 'commits', 'authors', 'added', 'removed', 'lastChanged', 'score', 'commitsByYear', 'concentration']) {
      expect(p.groups[0]).toHaveProperty(key);
    }
    for (const text of [skill, section]) {
      for (const [, key] of text.matchAll(/\.concentration\.(\w+)/g)) expect(p.directories[0].concentration).toHaveProperty(key);
      for (const [, key] of text.matchAll(/\.bots\.(\w+)/g)) expect(p.bots).toHaveProperty(key);
    }
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

  it('the yearly queries print what they rely on first, and the last-change queries group by year', () => {
    const run = (text, productPath, marker) => {
      const line = jqLines(bashBlocks(text)).find((recipe) => recipe.includes(marker));
      const result = spawnSync('sh', ['-c', line.replaceAll(productPath, JSON.stringify(fixture.product))], { encoding: 'utf-8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim().split('\n');
    };
    const p = product();
    const root = p.directories.find((row) => row.path === '.');
    const years = Object.keys(root.commitsByYear);
    expect(years.length).toBeGreaterThan(0);
    for (const [text, productPath] of [[rawStep(3), '"$HS"'], [section, '.excavator/hotspots.json']]) {
      expect(run(text, productPath, '"last counted commit:')).toEqual([
        `last counted commit: ${root.lastChanged}`, ...years.map((year) => `${year}\t${root.commitsByYear[year]}`),
      ]);
      expect(run(text, productPath, 'keys[-2:]')[0]).toBe(`years: ${years.slice(-2).join(', ')}`);
      const [label, ...yearRows] = run(text, productPath, 'group_by(.)');
      expect(label).toBe('files by the year of their last change, each file once (none: 0 commits counted):');
      const byYear = yearRows.map((row) => row.split('\t'));
      expect(byYear.reduce((sum, [, count]) => sum + Number(count), 0)).toBe(p.files.filter((row) => row.commits !== null).length);
      expect(run(text, productPath, 'sort_by(.lastChanged // "", .path)').length).toBeGreaterThan(0);
      const files = run(text, productPath, 'files with history but 0 commits counted');
      const dated = p.files.filter((row) => row.lastChanged !== null);
      expect(files[0]).toBe(`files with history but 0 commits counted: ${p.files.filter((row) => row.commits !== null && row.lastChanged === null).length}`);
      expect(files.slice(1).map((row) => row.split('\t')[0])).toEqual(dated.map((row) => row.lastChanged.slice(0, 10)).sort().slice(0, 10));
    }
    const dir = p.directories.find((row) => row.path === 'src');
    const line = jqLines(bashBlocks(section)).find((recipe) => recipe.includes('last counted commit of the product'));
    const result = spawnSync('sh', ['-c', line.replaceAll('.excavator/hotspots.json', JSON.stringify(fixture.product)).replaceAll('<dir>', 'src')], { encoding: 'utf-8' });
    expect(result.stdout.trim().split('\n')).toEqual([
      `last counted commit of the product: ${root.lastChanged}; last change of this directory: ${dir.lastChanged}`,
      ...Object.entries(dir.commitsByYear).map(([year, count]) => `${year}\t${count}`),
    ]);
  });

  it('the shares queries print the project line, a directory\'s line, and the directories by share after their rule and count', () => {
    const run = (text, productPath, marker, path = fixture.product) => {
      const line = jqLines(bashBlocks(text)).find((recipe) => recipe.includes(marker));
      const result = spawnSync('sh', ['-c', line.replaceAll(productPath, JSON.stringify(path)).replaceAll('<dir>', 'src')], { encoding: 'utf-8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim().split('\n');
    };
    const p = product();
    const root = p.directories.find((row) => row.path === '.').concentration;
    expect(root).toEqual({ commitsByPeople: 5, topAuthorShare: 0.8, authorsFor80Percent: 1 });
    expect(run(rawStep(3), '"$HS"', '.bots.commits as $b')).toEqual([
      `commits by people: 5; by bots: ${p.bots.commits}; top author share: 0.8; authors for 80%: 1`,
    ]);
    const src = p.directories.find((row) => row.path === 'src');
    expect(run(section, '.excavator/hotspots.json', 'authors (every distinct email, bots included)')).toEqual([
      `commits: ${src.commits}; by people: ${src.concentration.commitsByPeople}; by bots: 0; top author share: ${src.concentration.topAuthorShare}; authors for 80%: ${src.concentration.authorsFor80Percent}; authors (every distinct email, bots included): ${src.authors}`,
    ]);
    // a directory whose files all sit in one subdirectory (a) is shown as that subdirectory (a/b); below 20 and without history are left out
    const dir = (path, files, commits, share, k, people = commits) => ({ path, files, commits, concentration: { commitsByPeople: people, topAuthorShare: share, authorsFor80Percent: k } });
    const shares = join(fixture.dir, '.excavator/shares.json');
    writeFileSync(shares, JSON.stringify({ directories: [
      dir('.', 20, 200, 0.3, 4), dir('a', 3, 30, 0.5, 2), dir('a/b', 3, 30, 0.5, 2), dir('c', 2, 19, 1, 1), dir('d', 5, 42, 0.9, 1, 40),
      dir('e', 4, 25, 0.5, 1), { path: 'f', files: 1, commits: null, concentration: null }, dir('g', 2, 20, 0.5, 2), dir('h', 6, 30, 0.5, 2, 0),
    ] }));
    for (const [text, productPath] of [[rawStep(3), '"$HS"'], [section, '.excavator/hotspots.json']]) {
      expect(run(text, productPath, '--argjson min 20', shares)).toEqual([
        'directories with at least 20 commits by people (a directory whose files all sit in one subdirectory is shown as that subdirectory): 4',
        '0.9\t1\t40\t42\td', '0.5\t1\t25\t25\te', '0.5\t2\t30\t30\ta/b', '0.5\t2\t20\t20\tg',
      ]);
    }
  });

  it('runs every jq recipe of steps 2 and 3 on the product', () => {
    const recipes = jqLines([...bashBlocks(rawStep(2)), ...bashBlocks(rawStep(3))]);
    expect(recipes.length).toBeGreaterThanOrEqual(13);
    for (const line of recipes) runRecipe(line, '"$HS"');
  });

  it('the advice check catches advice and passes the residual assumptions as they stand', () => {
    const command = bashBlocks(rawStep(4)).map((block) => block.trim()).find((block) => block.startsWith('python3 - "$DATA/hotspots-report.md"'));
    // the lines the check prints; a check that does not run fails here rather than passing the text
    const check = (text) => {
      const report = join(fixture.dir, '.excavator/hotspots-report.md');
      writeFileSync(report, text);
      const result = spawnSync('sh', ['-c', command.replaceAll('"$DATA/hotspots-report.md"', JSON.stringify(report))], { encoding: 'utf-8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    };
    expect(check(`${product().residualAssumptions.join('\n')}\n`)).toBe('');
    // the words step 4 tells the report to give as they stand pass the check
    const fixedWords = [...step.get(4).matchAll(/words:? "([^"]+)"/g)].map((match) => match[1]);
    expect(fixedWords.length).toBeGreaterThanOrEqual(3);
    expect(check(`${fixedWords.join('\n')}\n`), fixedWords.join('\n')).toBe('');
    // so do the sentences that say where the groups came from, and chat's words for a group
    const quoted = [...step.get(4).split('5. Changes by feature.')[1].split('6. Changes by year')[0].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(quoted).toHaveLength(3);
    const chatWords = [...flat(section).matchAll(/"(A group counts only[^"]+)"/g)].map((match) => match[1]);
    expect(chatWords).toHaveLength(1);
    expect(check(`${[...quoted, ...chatWords].join('\n')}\n`)).toBe('');
    for (const whole of ['These are the whole feature\'s changes.', 'The entire feature changed 40 times.', '\u8fd9\u662f\u6574\u4e2a\u529f\u80fd\u7684\u6539\u52a8\u3002']) {
      expect(check(`${whole}\n`), whole).not.toBe('');
    }
    for (const advice of ['You should refactor src/b.js.', 'Consider splitting it.', 'We recommend more tests.', '\u5efa\u8bae\u62c6\u5206\u8fd9\u4e2a\u6587\u4ef6\u3002', '\u8fd9\u4e2a\u76ee\u5f55\u5e94\u8be5\u91cd\u6784\u3002']) {
      expect(check(`${advice}\n`), advice).not.toBe('');
    }
    for (const cause of ['src/b.js depends on docs/readme.md.', 'A change in x causes changes in y.', 'x calls y.', 'b.js \u4f9d\u8d56 readme.md\u3002', '\u6539 a \u5bfc\u81f4\u8981\u6539 b\u3002']) {
      expect(check(`${cause}\n`), cause).not.toBe('');
    }
    for (const unused of ['src/old has dead code.', 'These files are unused.', 'The module is no longer used.', 'lib/x.js is obsolete.', 'An abandoned directory.', 'It is safe to delete.', '\u8fd9\u4e2a\u76ee\u5f55\u5df2\u5e9f\u5f03\u3002', '\u8fd9\u4e9b\u662f\u6b7b\u4ee3\u7801\u3002']) {
      expect(check(`${unused}\n`), unused).not.toBe('');
    }
    for (const owner of ['src is at risk.', 'A risky directory.', 'The bus factor is 1.', 'A single point of failure.', 'A knowledge silo.', 'One author owns src.', 'src is owned by one author.',
      'Ownership is narrow.', 'The experts on src.', 'One author is responsible for src.', 'One author knows src.', '\u8fd9\u4e2a\u76ee\u5f55\u6709\u98ce\u9669\u3002', '\u8fd9\u662f\u5355\u70b9\u3002', '\u77e5\u8bc6\u5b64\u5c9b\u3002', '\u4e00\u4e2a\u4eba\u8d1f\u8d23\u3002', '\u53ea\u6709\u4e13\u5bb6\u3002', '\u53ea\u6709\u4e00\u4e2a\u4eba\u719f\u6089\u3002', '\u4e00\u4e2a\u4eba\u638c\u63e1\u3002']) {
      expect(check(`${owner}\n`), owner).not.toBe('');
    }
    // paths that carry such words in real repositories: legacy, stale, risk and owner are left out of the check for them
    for (const plain of ['gradle/dependencies.gradle and pom.xml changed together in 5 commits.', 'src/FooCallback.java changed in 4 commits.',
      'db/migration/V5__legacy-templates.sql last changed in 2021.', '.github/workflows/stale.yml changed in 3 commits.',
      'web/flags-risk-count.js changed in 3 commits.', 'api/src/main/java/model/Owner.java changed in 2 commits.', '.github/CODEOWNERS changed in 4 commits.']) {
      expect(check(`${plain}\n`), plain).toBe('');
    }
  });
});

describe('excavator-chat: change-history questions', () => {
  it('routes change-history questions before the graph check', () => {
    const stepOne = flat(chat.split(/^## Instructions$/m)[1].split(/^1\. /m)[1].split(/^2\. /m)[0]);
    expect(stepOne).toContain('**Change-history questions do not need the graph.**');
    expect(stepOne).toContain('or about which files changed in the same commits as a file (what usually changes along with it)');
    expect(stepOne).toContain('or about how changes spread over the years and which parts have not changed for a long time');
    expect(stepOne).toContain('or about whether a part is changed mostly by one or a few people, or about which features change most, is answered');
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
    expect(s).toContain('jq \'{sourceKind, historyAvailable, noHistory, repos, window, counts, coChange, bots, featureGroups, conservation}\'');
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
    expect(s).toContain('run step 5 first and say it in the language step 5 prints');
    expect(s).toContain('`lines` is the file\'s line count at HEAD, not lines changed');
    expect(s).toContain('**A pair is a count, not a link**: never say that one file depends on, calls, uses or causes changes in the other');
    expect(s).toContain('A file in no listed pair was not changed together with any file at least `coChange.minTogether` times');
    expect(s).toContain('Its first line is how many listed pairs include the file; when that is more than the rows you show, say how many you show out of how many.');
    expect(s).toContain('never that it does not change with other files');
    expect(s).toContain('A question about what depends on or calls a file is about the code, not its history: answer it from the graph.');
    expect(s).toContain('For a directory\'s changes over the years, use the `<dir>` query with `commitsByYear`');
    expect(s).toContain('Files have no yearly counts: for a file, give its `commits` and `lastChanged`, say the product counts years only per directory, and never work out a file\'s count for a year.');
    expect(s).toContain('Its first line gives the last counted commit of the product: the last year runs only to that date (not to the directory\'s own last change), so after the years give it in these words: "<year> runs only to <date>, the product\'s last counted commit, so its count is partial." Never scale it up to a whole year or guess a later count.');
    expect(s).toContain('Say nothing else about how the counts move: not that they rise, fall or hold steady, not that the directory is active, cooling or quiet, and not why a year is higher or lower, the partial year included.');
    expect(s).toContain('A whole history (not shallow, no window) still leaves the residual assumptions: never call the counts complete, reliable or accurate.');
    expect(s).toContain('Show every row a query prints, in its order, one row each; do not merge, group or summarize rows.');
    expect(s).toContain('After the lists, give in these words: "The product records when each file last changed, not whether it is still used or why it has not changed."');
    expect(s).toContain('Describe none of the files or directories: not what they are (early, one-off, legacy, leftover, a script, a test, a document), not why they have not changed, and not how the counts by year move.');
    expect(s).toContain('For files with history but 0 commits counted, give the number on the first line of the files query in these words: "<N> files have history but 0 commits counted; the product does not say why."');
    expect(s).toContain('**Not changed is not unused**: change history does not show whether code is used, so never call a file or directory unused, dead, obsolete, abandoned or safe to delete because it has not changed');
    expect(s).toContain('For whether a part is changed mostly by one or a few people, use the `<dir>` shares query');
    // the answer step repeats the rule, where the answer is written
    expect(s.split('6. **Answer with the product\'s numbers.**')[1]).toContain('**A share is a count of commits**: say only that authors made a share of the commits; never say that one person or many own, know, maintain or are responsible for a part, together or alone.');
    expect(s).toContain('for which parts, use the directories query and show every row it prints after its first line');
    expect(s).toContain('Files have no shares: for a file, give its `authors` and `commits`.');
    expect(s).toContain('Give a directory\'s shares in these words: "The author with the most commits made <topAuthorShare as a percentage> of its <commitsByPeople> commits by people, and <authorsFor80Percent> authors made at least 80% of them." When asked whether one person makes most of the changes, answer from `topAuthorShare` alone: above 0.5 in the words "the author with the most commits made more than half of them", below 0.5 "less than half of them", and 0.5 "about half of them" (the share is rounded). Do not call the shares concentrated, spread, high or low, and do not say whether the other authors are few or many: the numbers are the answer. Say nothing else about the authors: not that one person or a group maintains, owns or knows the part, in any language (\u7ef4\u62a4, \u8d1f\u8d23, \u62e5\u6709, \u719f\u6089).');
    expect(s).toContain('The product holds no names: when asked who, say it has only shares and counts, and never look a name up with git or in any file.');
    expect(s).toContain('A share is a count of commits: never say that someone owns, knows, maintains or is responsible for a part, or that it is at risk, a silo or dependent on one person.');
    expect(s).toContain('For which features change most, or how much one feature changed, use the groups query, then the `<group>` query with a name from its rows.');
    expect(s).toContain('`featureGroups` `null` means the product has no counts by feature: say so, say that running `/excavator-domain` (after `/excavator`) and then `/excavator-hotspots` again, or writing `.excavator/feature-groups.json` (groups, each a name and the paths of its files), gives them, and never answer with directories in place of features.');
    expect(s).toContain('give in these words: "A group counts only the files its groups file lists, and a file in several groups counts in each." Then show the query\'s first line as it stands and every row it prints, in its order, each group under its name exactly as printed: do not shorten, merge or leave out a group (a translation may follow a name in brackets), and when `groupsListed` is more than the rows, say how many you show out of how many.');
    expect(s).toContain('When no group\'s name matches the feature asked about, say so and list the groups; never pick a directory or a group yourself.');
    expect(s.split('6. **Answer with the product\'s numbers.**')[1]).toContain('**A group is the files it lists**: show every group the query prints under its full name, never call a group\'s numbers the whole feature\'s changes, and do not explain why a feature changes often.');
  });

  it('the groups queries of the skill and of chat print the group counts first, then the groups by commits', () => {
    const p = product();
    expect(p.featureGroups).toEqual({
      groupsListed: 2, filesInAGroup: 2, filesInSeveralGroups: 1, pathsUnmatched: 1,
    });
    const byCommits = [...p.groups].sort((a, b) => b.commits - a.commits || (a.name < b.name ? -1 : 1));
    const noGroups = join(fixture.dir, '.excavator/no-groups.json');
    writeFileSync(noGroups, JSON.stringify({ ...p, featureGroups: null, groups: [] }));
    for (const [text, productPath] of [[rawStep(3), '"$HS"'], [section, '.excavator/hotspots.json']]) {
      const line = jqLines(bashBlocks(text)).find((recipe) => recipe.includes('"no feature groups"'));
      const run = (path) => {
        const result = spawnSync('sh', ['-c', line.replaceAll(productPath, JSON.stringify(path))], { encoding: 'utf-8' });
        expect(result.status, result.stderr).toBe(0);
        return result.stdout.trim().split('\n');
      };
      expect(run(fixture.product)).toEqual([
        `groups: 2; files in a group: 2 of ${p.files.length}; files in several groups: 1; listed paths that matched no file: 1`,
        ...byCommits.map((g) => [g.commits, g.authors, g.files, g.lines, g.unmatchedPaths.length, g.name].join('\t')),
      ]);
      expect(run(noGroups)).toEqual(['no feature groups']);
    }
    // a group with no history comes after every group with some
    const nulls = join(fixture.dir, '.excavator/null-group.json');
    writeFileSync(nulls, JSON.stringify({ ...p, groups: [{ ...p.groups[0], name: 'a', files: 0, commits: null, authors: null, lines: null, unmatchedPaths: ['x'] }, ...p.groups] }));
    const line = jqLines(bashBlocks(rawStep(3))).find((recipe) => recipe.includes('"no feature groups"'));
    const rows = spawnSync('sh', ['-c', line.replaceAll('"$HS"', JSON.stringify(nulls))], { encoding: 'utf-8' }).stdout.trim().split('\n');
    expect(rows.at(-1)).toBe('\t\t0\t\t1\ta');
  });

  it('the freshness helper and the product agree on the revision of an unchanged project', () => {
    const helper = spawnSync('node', [resolve(repoRoot, 'skills/excavator/consumer-freshness.mjs'), fixture.dir], { encoding: 'utf-8' });
    expect(JSON.parse(helper.stdout).currentSourceRevision).toBe(product().sourceRevision);
  });

  it('runs the lookup recipes on the product', () => {
    const recipes = jqLines(bashBlocks(section));
    expect(recipes.length).toBeGreaterThanOrEqual(11);
    for (const line of recipes) runRecipe(line, '.excavator/hotspots.json');
  });
});
