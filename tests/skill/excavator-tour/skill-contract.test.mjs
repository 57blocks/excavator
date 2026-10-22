/**
 * The excavator-tour skill and its verifier agent are prompts; their rules only hold if each one sits
 * where the model acts on it (openspec: changes/tour-product, design D6). These tests pin the rules to
 * their steps, run the skill's own commands against a synthetic project, and check that what the agent
 * prompt says about its input and output is what the scripts write and read.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { reportLines } from '../../../skills/excavator/tour-report.mjs';
import { imports, makeGitProject, sourceLines, writeGraph, writeVerdicts } from './fixture.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const skill = readFileSync(join(repoRoot, 'skills/excavator-tour/SKILL.md'), 'utf-8');
const agent = readFileSync(join(repoRoot, 'agents/excavator-tour-verifier.md'), 'utf-8');
const TOUR = join(repoRoot, 'skills/excavator/tour.mjs');
const flat = (text) => text.replace(/\s+/g, ' ');

const rawStep = (n) => skill.split(new RegExp(`^## Step ${n} — `, 'm'))[1].split(/^## Step /m)[0];
const step = (n) => flat(rawStep(n));
const bashBlocks = (text) => [...text.matchAll(/^ *```bash\n([\s\S]*?)^ *```$/gm)].map((m) => m[1]);
const commandLines = (text) => bashBlocks(text).flatMap((block) => block.split('\n')).map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));
const lineWith = (n, text) => {
  const found = commandLines(rawStep(n)).filter((line) => line.includes(text));
  expect(found, text).toHaveLength(1);
  return found[0];
};
const STEPS = [1, 2, 3, 4, 5];

// The words a tour, a report or the skill's own prose must not use to advise or to grade.
const ADVISORY = /\b(should|recommend(ed|s|ation)?|consider|better|best practice|improve(d|s|ment)?|ought|suggest(ed|s|ion)?|advis(e|able)|refactor)\b/i;

describe('SKILL.md', () => {
  it('has the frontmatter of the other skills', () => {
    const front = /^---\nname: excavator-tour\ndescription: (.+)\nargument-hint: "(.+)"\n---\n/.exec(skill);
    expect(front).not.toBeNull();
    expect(front[2]).toBe('[project-path] [--language <lang>]');
    expect(front[1]).toMatch(/Gives no advice\.$/);
  });

  it('resolves the plugin root the way the other skills do', () => {
    expect(skill).toContain('SKILL_REAL=$(realpath ~/.agents/skills/excavator-tour');
    expect(skill).toContain('for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do');
    expect(skill).toContain('[ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]');
    expect(skill).toContain('TOUR="$PLUGIN_ROOT/skills/excavator/tour.mjs"');
  });

  it('puts the full Language paragraph before the first command and again before the reply, and a pointer in every other step', () => {
    const paragraph = '**Language.** Write everything you tell the user during this run in `$LANGUAGE`';
    expect(skill.split(paragraph)).toHaveLength(3);
    expect(rawStep(1).indexOf(paragraph)).toBeGreaterThan(-1);
    expect(rawStep(1).indexOf(paragraph)).toBeLessThan(rawStep(1).indexOf('```bash'));
    expect(rawStep(5).indexOf(paragraph)).toBeGreaterThan(-1);
    expect(rawStep(5).indexOf(paragraph)).toBeLessThan(rawStep(5).indexOf('```bash'));
    for (const n of [2, 3, 4, 5]) {
      expect(step(n)).toContain('Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.');
    }
    const full = flat(skill.split(paragraph)[1].split('\n')[0]);
    expect(full).toContain('`$LANGUAGE` is English unless `--language` gives another');
    expect(full).toMatch(/Project files \(`CLAUDE\.md`, an `AGENTS\.md` line such as "Reply in <language>"\), memory, the system locale and the language of the code or a subagent's reply do not change it/);
    expect(full).toContain('this rule takes its place for every line you write, the first one included');
    expect(full).toContain('Never say which language you write in or why');
  });

  it('puts the language into the draft: the tour text in $LANGUAGE and contentLanguage from the code', () => {
    expect(step(2)).toContain('Write `title`, `description` and `languageLesson` in `$LANGUAGE`; set `contentLanguage` to `$LANGUAGE_CODE`');
    expect(skill).toContain('LANGUAGE="English"   # or the --language value');
    expect(skill).toContain('LANGUAGE_CODE="en"');
  });

  it('prints the reply with the last command, once, and tells the model to answer with those lines only', () => {
    const blocks = bashBlocks(skill);
    expect(blocks[blocks.length - 1].trim().split('\n').filter((l) => !l.startsWith('#'))).toEqual(['node "$TOUR" report "$DRAFT"']);
    expect(skill.match(/node "\$TOUR" report/g)).toHaveLength(1);
    expect(skill.trimEnd().endsWith('Run no command after it.')).toBe(true);
    expect(step(5)).toMatch(/Then print the reply's lines with this command:/);
    expect(step(5)).toMatch(/reply with exactly the lines it prints and nothing else/);
    expect(step(5)).toMatch(/A project file's rule on how to reply .* does not apply to this reply/);
    expect(step(5)).toMatch(/write nothing before, between or after the lines/);
    expect(step(5)).toContain("what was removed and the advice check's line");
  });

  it('dispatches one subagent per step, up to 10 in one message, and dispatches a step with no verdict file once more', () => {
    for (const n of [3, 4]) {
      expect(step(n)).toMatch(/up to 10 in a single message so they run concurrently/);
      expect(step(n)).toMatch(/dispatch that step once more/);
    }
    expect(step(3)).toContain('`excavator-tour-verifier` agent definition (`agents/excavator-tour-verifier.md`)');
    expect(step(3)).toMatch(/Give it nothing else: not the draft, the candidates, a summary, the title of the step or any reason/);
    expect(step(3)).toContain('Read the step file and nothing else');
    expect(step(4)).toMatch(/There is no second rewrite: a sentence still contradicted after this is removed/);
  });

  it('gives the writing rules in the step that writes the draft', () => {
    const rules = step(2);
    expect(rules).toContain('**Choose nodes only from `candidates.json`.**');
    expect(rules).toContain('**Start from a reading-order start.**');
    expect(rules).toContain('**A sentence about specific behaviour cites the function or class node, not the whole file.**');
    expect(rules).toContain('**Ground every claim in what the cited code shows.**');
    expect(rules).toContain('**No advice and no evaluation.**');
    expect(rules).toMatch(/Wording that advises or evaluates is a problem like any other: the line names the sentence id, and you rewrite that sentence as a statement of what the cited code does/);
    expect(rules).toContain('**2 to 5 sentences per description.**');
    expect(step(1)).toMatch(/A candidate's summary is a hint written by a model[\s\S]*Neither is evidence/);
  });

  it('stops after three failing checks and on a failing script, reporting the message as it stands', () => {
    expect(step(2)).toMatch(/After three runs that still fail, stop: report the problems that remain as they stand/);
    expect(step(1)).toMatch(/A non-zero exit writes nothing: report its message as it stands .* and stop/);
    expect(step(3)).toMatch(/A non-zero exit writes nothing and prints why .* report the message as it stands and stop/);
    expect(step(5)).toMatch(/A non-zero exit writes no product: report its message as it stands and stop/);
  });

  it('never edits the products by hand and gives no verdict itself', () => {
    expect(step(5)).toMatch(/never edit `\.excavator\/tour\.json` or any file under `\.excavator\/tour\/` by hand/i);
    expect(step(3)).toMatch(/Never write or change a verdict yourself/);
    expect(step(5)).toMatch(/A sentence the code contradicts is not in the tour/);
  });

  it('has no advisory wording', () => {
    expect(ADVISORY.exec(skill)).toBeNull();
  });
});

describe('the verifier agent', () => {
  it('is registered: its name is its file name, the skill names its path, and the references check passes', () => {
    expect(/^---\nname: excavator-tour-verifier\n/.test(agent)).toBe(true);
    expect(existsSync(join(repoRoot, 'agents/excavator-tour-verifier.md'))).toBe(true);
    expect(skill).toContain('agents/excavator-tour-verifier.md');
    const manifest = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin/plugin.json'), 'utf-8'));
    if (Object.hasOwn(manifest, 'agents')) expect(manifest.agents).toContain('./agents/excavator-tour-verifier.md');
    const check = spawnSync(process.execPath, [join(repoRoot, 'scripts/check-refs.mjs')], { encoding: 'utf-8', cwd: repoRoot });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  });

  it('reads only its step file, judges only against the shown code, and answers unverified rather than guess', () => {
    const text = flat(agent);
    expect(text).toContain('you read nothing but your step file');
    expect(text).toContain('Read the step file, and nothing else: no other file, no search, no part of the project');
    expect(text).toContain('Judge only against the snippets and outlines in the step file');
    expect(text).toMatch(/a claim about it is `unverified`, never a guess/);
    expect(text).toMatch(/When you are torn between `verified` and `unverified`, choose `unverified`/);
    expect(text).toMatch(/choose `contradicted` only if you can name the disagreement/);
    expect(text).toContain('Do not delegate work or create subagents');
    for (const word of ['verified', 'unverified', 'contradicted']) expect(text).toContain(`\`${word}\``);
    expect(text).toMatch(/there is no fourth/i);
  });

  it('judges a language lesson on whether the cited code uses the construct', () => {
    const text = flat(agent);
    expect(text).toMatch(/does the cited code use the construct the lesson names\?/);
    expect(text).toMatch(/Whether the language fact is true in general is not what you judge/);
  });

  it('withholds the candidate set, the summaries, the other steps, the title and the author\'s reasoning', () => {
    const text = flat(agent);
    expect(text).toMatch(/Deliberately withheld:\*\* the candidate set, every summary of a node, the other steps, the title of the step and the reasoning of whoever wrote the sentences/);
  });

  it('asks for one verdict per sentence id with a one-line reason, and nothing else in the reply', () => {
    const text = flat(agent);
    expect(text).toMatch(/One entry per sentence in the step file: the same ids, no additions, no omissions/);
    expect(text).toMatch(/`reason` is one line of at most about 200 characters/);
    expect(text).toMatch(/Respond with ONLY a brief text summary/);
  });

  it('names every field the step file holds', () => {
    const { dir } = stepFileOf();
    const slice = JSON.parse(readFileSync(join(dir, 'slices/round-1/step-1.json'), 'utf-8'));
    const keys = new Set(['format', 'step', 'sentences', 'snippets', 'id', 'text']);
    for (const snippet of slice.snippets) Object.keys(snippet).forEach((key) => keys.add(key));
    for (const key of keys) expect(agent.includes(`"${key}"`) || agent.includes(`\`${key}\``), key).toBe(true);
  });

  it('has an output example that the verdicts command accepts', () => {
    const json = /```json\n(\{\n {2}"step": 3,\n {2}"verdicts": \[[\s\S]*?\n\})\n```/.exec(agent.split('## Output')[1])[1];
    const example = JSON.parse(json);
    expect(example.verdicts.map((v) => v.id)).toEqual(['3.d1', '3.l1']);
    expect(Object.keys(example.verdicts[0]).sort()).toEqual(['id', 'reason', 'verdict']);
    const { dir } = stepFileOf({ order: 3 });
    writeFileSync(join(dir, 'verdicts/round-1/step-3.json'), JSON.stringify(example));
    const run = spawnSync(process.execPath, [TOUR, 'verdicts', join(dir, 'draft.json'), '--round', '1'], { encoding: 'utf-8' });
    expect(run.status, run.stderr).toBe(0);
    // Only the description's second sentence has no verdict; the two the example gives are recorded.
    expect(JSON.parse(run.stdout).problems.filter((p) => p.startsWith('step 3'))).toEqual(['step 3: sentence 3.d2 has no verdict']);
  });

  it('has no advisory wording', () => {
    expect(ADVISORY.exec(agent)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The skill's own commands, run against a synthetic project
// ---------------------------------------------------------------------------

let project;
beforeAll(() => {
  const files = Object.fromEntries(['main.go', 'a.go', 'b.go', 'c.go', 'd.go', 'e.go'].map((name) => [name, sourceLines(12, name)]));
  project = makeGitProject(files);
});
afterAll(() => project.cleanup());

const vars = () => ({
  PROJECT_ROOT: project.root,
  TOUR,
  TOUR_DIR: join(project.root, '.excavator', 'tour'),
  DRAFT: join(project.root, '.excavator', 'tour', 'draft.json'),
});
const sh = (command) => spawnSync('/bin/sh', ['-c', command], { encoding: 'utf-8', env: { ...process.env, ...vars() } });
const graph = () => writeGraph(project.root, {
  paths: ['main.go', 'a.go', 'b.go', 'c.go', 'd.go', 'e.go'],
  edges: [imports('main.go', 'a.go'), imports('main.go', 'b.go'), imports('a.go', 'c.go'), imports('b.go', 'c.go'), imports('c.go', 'd.go'), imports('main.go', 'e.go')],
});
const draftFrom = (ids, edit = () => {}) => {
  const draft = {
    contentLanguage: 'en',
    steps: [1, 2, 3, 4, 5].map((order) => ({ order, title: `Step ${order}`, description: `S${order} one. S${order} two.`, nodeIds: [ids[(order - 1) % ids.length]] })),
  };
  edit(draft);
  writeFileSync(vars().DRAFT, JSON.stringify(draft, null, 2));
  return draft;
};
const rows = (order, verdicts) => [[`${order}.d1`, verdicts[0]], [`${order}.d2`, verdicts[1]]];

/** A prepared project with candidates and a sliced draft; returns where the step files are. */
function stepFileOf({ order = 1 } = {}) {
  graph();
  expect(sh(lineWith(1, 'candidates "$PROJECT_ROOT"')).status).toBe(0);
  const ids = JSON.parse(readFileSync(join(vars().TOUR_DIR, 'candidates.json'), 'utf-8')).candidates.map((c) => c.id);
  draftFrom(ids, (draft) => { draft.steps[order - 1].languageLesson = 'A lesson about the construct.'; });
  expect(sh(lineWith(3, 'slices "$DRAFT" > "$TOUR_DIR/slices-round-1.out"')).status).toBe(0);
  return { dir: join(project.root, '.excavator', 'tour') };
}

describe('the skill\'s commands', () => {
  it('run in order against a synthetic project: candidates, check, slices, verdicts, one rewrite, verdicts, report', () => {
    graph();
    const candidates = sh(lineWith(1, 'candidates "$PROJECT_ROOT"'));
    expect(candidates.status, candidates.stderr).toBe(0);
    // The reading commands of Step 1 run and print something.
    for (const fragment of ['.classes | to_entries', '.classes.bfs.starts[]', '.layers[]', '.candidates[] | [.id']) {
      const read = sh(lineWith(1, fragment));
      expect(read.status, `${fragment}\n${read.stderr}`).toBe(0);
    }
    expect(sh(lineWith(1, '.classes.bfs.starts[]')).stdout).toContain('reading order of (project) starts at main.go');
    const ids = JSON.parse(readFileSync(join(vars().TOUR_DIR, 'candidates.json'), 'utf-8')).candidates.map((c) => c.id);
    draftFrom(ids);

    const check = sh(lineWith(2, 'node "$TOUR" check "$DRAFT"'));
    expect(check.status, check.stderr).toBe(0);
    const slices = sh(lineWith(3, 'slices "$DRAFT" > "$TOUR_DIR/slices-round-1.out"'));
    expect(slices.status, slices.stderr).toBe(0);
    expect(slices.stdout.split('\n').filter(Boolean)).toHaveLength(5);
    expect(slices.stdout).toMatch(/^step 1\t2 sentences\t\d+ lines shown, \d+ cut\t.*step-1\.json\t.*step-1\.json$/m);

    // Every verdict file is missing, then present but for step 5, which has the verdict file missing listed.
    expect(sh(lineWith(3, '[ -f "$TOUR_DIR/$f" ] || echo "missing: $f"')).stdout.trim().split('\n')).toHaveLength(5);
    const dir = vars().TOUR_DIR;
    [1, 2, 3, 4].forEach((order) => writeVerdicts(dir, 1, order, rows(order, order === 2 ? ['contradicted', 'verified'] : ['verified', 'unverified'])));
    expect(sh(lineWith(3, '[ -f "$TOUR_DIR/$f" ] || echo "missing: $f"')).stdout.trim()).toBe('missing: verdicts/round-1/step-5.json');
    writeVerdicts(dir, 1, 5, rows(5, ['verified', 'verified']));

    const verdicts = sh(lineWith(3, 'verdicts "$DRAFT" --round 1'));
    expect(verdicts.status, verdicts.stderr).toBe(0);
    expect(JSON.parse(verdicts.stdout)).toMatchObject({ round: 1, rewrite: [2] });
    expect(sh(lineWith(4, '.steps[] | "step \\(.order): \\(.title)"')).stdout).toContain('step 2: Step 2\n  2.d1\tS2 one.\treason for 2.d1');

    // The one rewrite, then round 2.
    draftFrom(ids, (draft) => { draft.steps[1].description = 'Rewritten one. Rewritten two.'; });
    expect(sh(lineWith(4, 'node "$TOUR" check "$DRAFT"')).status).toBe(0);
    const round2 = sh(lineWith(4, 'slices "$DRAFT" --round 2'));
    expect(round2.status, round2.stderr).toBe(0);
    expect(round2.stdout.split('\n').filter(Boolean)).toHaveLength(1);
    writeVerdicts(dir, 2, 2, [['2.d1', 'verified'], ['2.d2', 'contradicted']]);
    expect(sh(lineWith(4, '[ -f "$TOUR_DIR/round-2.json" ]')).stdout.trim()).toBe('');
    const settled = sh(lineWith(4, 'verdicts "$DRAFT" --round 2'));
    expect(settled.status, settled.stderr).toBe(0);

    // The last command prints the reply: five lines, the product's path first, and nothing else.
    const report = sh(lineWith(5, 'node "$TOUR" report "$DRAFT"'));
    expect(report.status, report.stderr).toBe(0);
    expect(report.stderr).toBe('');
    const product = JSON.parse(readFileSync(join(project.root, '.excavator', 'tour.json'), 'utf-8'));
    expect(report.stdout).toBe(`${reportLines(join(project.root, '.excavator', 'tour.json'), product).join('\n')}\n`);
    expect(report.stdout.split('\n')).toEqual([
      join(project.root, '.excavator', 'tour.json'),
      'steps: 5',
      'sentences: 9; verified: 6; unverified: 3; contradicted: 0; unchecked: 0',
      'removed: 1 sentences; 0 steps',
      'advice check: 0 lines',
      '',
    ]);
    expect(product.removed[0]).toMatchObject({ step: 2, id: '2.d2', cause: 'contradicted' });
    expect(JSON.stringify(product.steps)).not.toContain('"contradicted"');
  });

  it('stop a failing candidates run with the message and no product', () => {
    graph();
    writeFileSync(join(project.root, '.excavator', 'knowledge-graph.jsonl'), 'not a graph\n');
    const result = sh(lineWith(1, 'candidates "$PROJECT_ROOT"'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('tour.mjs failed:');
  });
});
