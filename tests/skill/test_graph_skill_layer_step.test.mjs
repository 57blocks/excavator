/**
 * The skills that read knowledge-graph.jsonl find the architecture layers as
 * their Reading Layers section says. The layers live in two places: a Full
 * run writes them to semantic-graph.json with the factDigest of the facts
 * they were made from, and an incremental update writes them to the graph as
 * `{"record":"layer","layer":{...}}` lines and sets the header's
 * `project.layersFrom` to "incremental". The digests alone cannot tell which
 * place was written last: an incremental update keeps the previous
 * factsDigest, and Lazy carries old layer lines through a later Full run. The
 * only graph line with a `"layers"` key is the header, whose `counts.layers`
 * is a number, so a step that greps `"layers"` gets no layer. These tests pin
 * every graph skill to one Reading Layers section and run its commands
 * against products written by the store and semantic-graph.mjs, and by a real
 * Full, incremental, Full sequence of the pipeline's own scripts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readKnowledgeGraph, writeKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { buildSemanticGraph, writeSemanticGraph } from '../../skills/excavator/semantic-graph.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LAYER_RECORD = '"record":"layer"';
const LAYERS_KEY = '"layers"';
const SECTION_LINK = '**Reading Layers**';
const NO_LAYERS = 'never group files into layers yourself';
const LAYERS_FROM = '`layersFrom`';
const RULES_INTRO = 'Use the first that applies:';
const REBUILD = '`/excavator --full`';

const skillPath = (name) => resolve(repoRoot, 'skills', name, 'SKILL.md');
const read = (name) => readFileSync(skillPath(name), 'utf-8');

/** The skills whose Graph Structure Reference documents the layer line. */
const GRAPH_SKILLS = readdirSync(resolve(repoRoot, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(skillPath(entry.name)))
  .map((entry) => entry.name)
  .filter((name) => read(name).includes('{"record":"layer","layer":'))
  .sort();

/** The `## Reading Layers` section, up to the next `##` heading; null when there is none. */
const readingLayers = (text) => text.split(/^## Reading Layers$/m)[1]?.split(/^## /m)[0] ?? null;

/**
 * The numbered steps under `## Instructions`, up to the next `##` or `###`
 * heading, whose bold title names a layer. A step is its numbered line and
 * the blank or indented lines after it.
 */
function layerSteps(text) {
  const instructions = text.split(/^## Instructions$/m)[1]?.split(/^##+ /m)[0] ?? '';
  const steps = [];
  let current = null;
  for (const line of instructions.split('\n')) {
    if (/^\d+\. /.test(line)) {
      current = [line];
      steps.push(current);
    } else if (current && (line === '' || /^\s/.test(line))) {
      current.push(line);
    } else {
      current = null;
    }
  }
  return steps.map((lines) => lines.join('\n')).filter((step) => /^\d+\. \*\*[^*]*\blayers?\b/i.test(step));
}

/** The numbered rules after "Use the first that applies:" in a Reading Layers section. */
const sectionRules = (section) => (section.split(RULES_INTRO)[1] ?? '')
  .split('\n\n').find((part) => part.trim() !== '')?.split('\n').filter((line) => /^\d+\. /.test(line)) ?? [];

/**
 * What each rule has to name, in order: the source a rule picks is decided
 * by the first rule that applies, so the write-order check must come before
 * the digest comparison.
 */
const RULE_ORDER = [LAYERS_FROM, '`factDigest`', 'layer lines', NO_LAYERS];

/** What is wrong with how a graph skill reads its layers; empty when nothing is. */
function layerProblems(text) {
  const problems = [];
  const section = readingLayers(text);
  if (section === null) problems.push('has no ## Reading Layers section');
  else {
    for (const needed of ['semantic-graph.json', 'factDigest', LAYER_RECORD, NO_LAYERS, LAYERS_FROM, REBUILD]) {
      if (!section.includes(needed)) problems.push(`its Reading Layers section does not name ${needed}`);
    }
    const rules = sectionRules(section);
    if (rules.length !== RULE_ORDER.length) problems.push(`expected ${RULE_ORDER.length} rules after "${RULES_INTRO}", found ${rules.length}`);
    RULE_ORDER.forEach((needed, index) => {
      if (rules[index] && !rules[index].includes(needed)) problems.push(`rule ${index + 1} does not name ${needed}: ${rules[index]}`);
    });
    if (section.includes('--mode=full')) problems.push('suggests --mode=full, which does not rebuild semantic-graph.json on a project that has a graph');
  }
  const steps = layerSteps(text);
  if (steps.length !== 1) problems.push(`expected one layer step under ## Instructions, found ${steps.length}`);
  for (const step of steps) {
    if (!step.includes(SECTION_LINK)) problems.push(`the layer step does not point to ${SECTION_LINK}: ${step.split('\n')[0]}`);
  }
  if (text.includes(LAYERS_KEY)) problems.push(`names ${LAYERS_KEY}, which only the header line has`);
  return problems;
}

describe('graph skills read the layers as one Reading Layers section says', () => {
  it('finds the skills that read knowledge-graph.jsonl', () => {
    expect(GRAPH_SKILLS).toEqual(expect.arrayContaining(['excavator-chat', 'excavator-diff', 'excavator-explain', 'excavator-onboard']));
  });

  it.each(GRAPH_SKILLS)('%s reads its layers as its Reading Layers section says', (name) => {
    expect(layerProblems(read(name))).toEqual([]);
  });

  it('every graph skill has the same Reading Layers section', () => {
    const sections = new Set(GRAPH_SKILLS.map((name) => readingLayers(read(name))));
    expect(sections.has(null)).toBe(false);
    expect(sections.size).toBe(1);
  });

  const mutations = {
    'greps "layers" in its layer step': (text) => text.replaceAll(SECTION_LINK, `\`${LAYERS_KEY}\``),
    'drops the rule for no layers': (text) => text.replaceAll(NO_LAYERS, 'group the files'),
    'drops the semantic graph': (text) => text.replaceAll('semantic-graph.json', 'knowledge-graph.jsonl'),
    'checks layersFrom after the digests': (text) => {
      const rules = sectionRules(readingLayers(text) ?? '');
      if (rules.length < 2) return text;
      const swap = (rule, n) => rule.replace(/^\d+\./, `${n}.`);
      return text.replace(`${rules[0]}\n${rules[1]}`, `${swap(rules[1], 1)}\n${swap(rules[0], 2)}`);
    },
    'suggests --mode=full again': (text) => text.replaceAll(REBUILD, '`/excavator --mode=full`'),
  };
  for (const [what, mutate] of Object.entries(mutations)) {
    it.each(GRAPH_SKILLS)(`%s fails the check when it ${what}`, (name) => {
      const text = read(name);
      const mutated = mutate(text);
      expect(mutated).not.toBe(text);
      expect(layerProblems(mutated).length).toBeGreaterThan(0);
    });
  }
});

const section = readingLayers(read('excavator-onboard')) ?? '';
const block = section.match(/^```bash\n([\s\S]*?)^```$/m)?.[1] ?? '';
const commands = block.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
const dir = mkdtempSync(join(tmpdir(), 'graph-skill-layers-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Every command's exit status and output lines in `root`, with `<node id>` filled in. */
function runCommands(root, id) {
  return commands.map((command) => {
    const result = spawnSync('sh', ['-c', command.replaceAll('<node id>', id)], { cwd: root, encoding: 'utf-8' });
    return { command, status: result.status, lines: result.stdout.split('\n').filter(Boolean) };
  });
}
const pick = (runs, ...parts) => {
  const found = runs.filter((r) => parts.every((part) => r.command.includes(part)));
  expect(found, parts.join(' ')).toHaveLength(1);
  return found[0];
};
const allLayerLines = (runs) => {
  const found = runs.filter((r) => r.command.startsWith('grep') && !r.command.includes('grep -F'));
  expect(found).toHaveLength(1);
  return found[0];
};
const layerIds = (lines) => lines.map((line) => JSON.parse(line)).map((value) => (value.record === 'layer' ? value.layer : value).id);

/**
 * The source the section's rules pick from the commands' output, read as
 * RULE_ORDER says: 'lines' (the knowledge graph's layer lines), 'semantic'
 * (semantic-graph.json) or 'none'.
 */
function pickSource(runs) {
  if (pick(runs, '.layersFrom').lines[0] === 'incremental') return 'lines';
  const semantic = pick(runs, '.factDigest');
  const facts = pick(runs, '.factsDigest').lines[0];
  if (semantic.status === 0 && semantic.lines[0] === facts) return 'semantic';
  if (allLayerLines(runs).lines.length > 0) return 'lines';
  return 'none';
}

describe('the Reading Layers commands give what the rule reads, on real products', () => {
  const NODE = 'file:src/a.ts';
  const BRACKETED = 'file:app/[id]/page.tsx';
  const node = (id, filePath, type = 'file') => ({ id, type, name: filePath, filePath, summary: '', tags: [], complexity: 'simple' });
  const nodes = [
    node(NODE, 'src/a.ts'),
    { ...node('function:src/a.ts:run', 'src/a.ts', 'function'), name: 'run' },
    node('file:src/a.tsx', 'src/a.tsx'),
    node(BRACKETED, 'app/[id]/page.tsx'),
  ];
  const layers = [
    { id: 'layer:service', name: 'Service', description: 'Business logic', nodeIds: [NODE] },
    { id: 'layer:ui', name: 'UI', description: 'Views', nodeIds: ['file:src/a.tsx', BRACKETED] },
  ];

  /** A project whose graph has `factsDigest` and `graphLayers`, and a semantic graph made from `semanticDigest` when given. */
  function project(name, { factsDigest, graphLayers, semanticDigest }) {
    const root = join(dir, name);
    const dataDir = join(root, '.excavator');
    mkdirSync(dataDir, { recursive: true });
    writeKnowledgeGraph(join(dataDir, 'knowledge-graph.jsonl'), {
      version: '1.0.0',
      project: { name, languages: ['typescript'], frameworks: [], description: '', analyzedAt: '', gitCommitHash: '', factsDigest },
      nodes,
      edges: [{ source: NODE, target: 'function:src/a.ts:run', type: 'contains', direction: 'forward', weight: 1 }],
      layers: graphLayers,
      tour: [],
    });
    if (semanticDigest) {
      const { semanticGraph } = buildSemanticGraph({ factDigest: semanticDigest, factNodeIds: nodes.map((n) => n.id), layers });
      writeSemanticGraph(dataDir, semanticGraph);
    }
    return root;
  }

  it('the section has the seven commands the rule reads', () => {
    expect(commands).toHaveLength(7);
  });

  it('with a current semantic graph: the digests match and jq lists the semantic graph\'s layers', () => {
    const root = project('full', { factsDigest: 'digest-a', graphLayers: [], semanticDigest: 'digest-a' });
    for (const [id, own] of [[NODE, 'layer:service'], [BRACKETED, 'layer:ui']]) {
      const runs = runCommands(root, id);
      expect(pick(runs, '.layersFrom').lines).toEqual([]);
      const digests = [pick(runs, '.factDigest'), pick(runs, '.factsDigest')].map((r) => r.lines);
      expect(digests).toEqual([['digest-a'], ['digest-a']]);
      expect(layerIds(pick(runs, 'jq -c \'.layers[]\'').lines)).toEqual(['layer:service', 'layer:ui']);
      expect(layerIds(pick(runs, 'jq -c --arg id').lines)).toEqual([own]);
      expect(pick(runs, 'grep', 'grep -F').lines).toEqual([]);
      expect(pickSource(runs)).toBe('semantic');
    }
  });

  it('with a semantic graph made from other facts: the digests differ and grep lists the layer lines', () => {
    const root = project('other-facts', { factsDigest: 'digest-b', graphLayers: layers, semanticDigest: 'digest-a' });
    for (const [id, own] of [[NODE, 'layer:service'], [BRACKETED, 'layer:ui']]) {
      const runs = runCommands(root, id);
      const digests = [pick(runs, '.factDigest'), pick(runs, '.factsDigest')].map((r) => r.lines);
      expect(digests).toEqual([['digest-a'], ['digest-b']]);
      expect(layerIds(allLayerLines(runs).lines)).toEqual(['layer:service', 'layer:ui']);
      // the quoted ID does not match file:src/a.tsx, and the brackets are not a pattern
      expect(layerIds(pick(runs, 'grep -F').lines)).toEqual([own]);
      expect(pickSource(runs)).toBe('lines');
    }
  });

  it('with no layers: there is no semantic graph and grep finds no layer line', () => {
    const root = project('lazy', { factsDigest: 'digest-c', graphLayers: [] });
    const runs = runCommands(root, NODE);
    expect(pick(runs, '.factDigest').status).not.toBe(0);
    expect(pick(runs, '.factsDigest').lines).toEqual(['digest-c']);
    expect(runs.filter((r) => r.command.startsWith('grep')).flatMap((r) => r.lines)).toEqual([]);
    expect(pickSource(runs)).toBe('none');
  });
});

/**
 * The pipeline's own scripts, in the order a project goes through them: a
 * Full run (lazy-analyze.mjs for F1, semantic-graph.mjs write for F3), a
 * commit that adds src/c.ts and an incremental update (prepare-incremental.mjs,
 * then finalize-incremental.mjs on the assembled graph the file analyzer would
 * leave), then a second Full run. After each step the rule has to pick the
 * place that was written last.
 */
describe('the Reading Layers rule picks the layers written last, through Full, incremental and Full', { timeout: 180_000 }, () => {
  const skillDir = resolve(repoRoot, 'skills', 'excavator');
  const root = join(dir, 'pipeline');
  const dataDir = join(root, '.excavator');
  const NEW_FILE = 'file:src/c.ts';
  const OLD_FILE = 'file:src/a.ts';
  const after = {};

  const script = (name, ...args) => execFileSync(process.execPath, [join(skillDir, name), root, ...args], {
    cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim();
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  /** Phase F: F1 rebuilds the facts, F3 writes the layers to semantic-graph.json. */
  const fullRun = (layers) => {
    script('lazy-analyze.mjs');
    const layersPath = join(dataDir, 'intermediate', 'layers.json');
    writeFileSync(layersPath, JSON.stringify({ layers }));
    script('semantic-graph.mjs', 'write', '--layers', layersPath);
  };
  const outputs = () => Object.fromEntries([OLD_FILE, NEW_FILE].map((id) => [id, runCommands(root, id)]));

  beforeAll(() => {
    mkdirSync(root, { recursive: true });
    git('init', '-q', '-b', 'main');
    git('config', 'user.useConfigOnly', 'true');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    write('.gitignore', '.excavator/\n');
    write('package.json', '{"name":"layers-fixture"}\n');
    write('src/a.ts', 'export function run(): number { return 1; }\n');
    write('src/b.ts', 'import { run } from "./a";\nexport const b = run();\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'first');
    const first = git('rev-parse', 'HEAD');

    fullRun([
      { id: 'layer:service', name: 'Service', description: 'Logic', nodeIds: ['file:src/a.ts', 'file:src/b.ts'] },
      { id: 'layer:config', name: 'Config', description: 'Settings', nodeIds: ['file:package.json'] },
    ]);
    after.full = outputs();

    write('src/c.ts', 'export const c = 3;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'second');
    script('prepare-incremental.mjs', first);
    const intermediate = join(dataDir, 'intermediate');
    after.plan = JSON.parse(readFileSync(join(intermediate, 'incremental-plan.json'), 'utf-8'));
    const previous = readKnowledgeGraph(join(dataDir, 'knowledge-graph.jsonl'));
    const added = { id: NEW_FILE, type: 'file', name: 'c.ts', filePath: 'src/c.ts', summary: '', tags: [], complexity: 'simple' };
    writeFileSync(join(intermediate, 'assembled-graph.json'), JSON.stringify({ nodes: [...previous.nodes, added], edges: previous.edges }));
    script('finalize-incremental.mjs');
    after.incremental = outputs();

    fullRun([
      { id: 'layer:service', name: 'Service', description: 'Logic', nodeIds: ['file:src/a.ts', 'file:src/b.ts', 'file:src/c.ts'] },
      { id: 'layer:config', name: 'Config', description: 'Settings', nodeIds: ['file:package.json'] },
    ]);
    after.secondFull = outputs();
  }, 180_000);

  it('after the Full run: no layersFrom, no layer lines, the digests match, the semantic graph', () => {
    const runs = after.full[OLD_FILE];
    expect(pick(runs, '.layersFrom').lines).toEqual([]);
    expect(allLayerLines(runs).lines).toEqual([]);
    expect(pick(runs, '.factDigest').lines).toEqual(pick(runs, '.factsDigest').lines);
    expect(pickSource(runs)).toBe('semantic');
    expect(layerIds(pick(runs, 'jq -c --arg id').lines)).toEqual(['layer:service']);
  });

  it('after the incremental update: the digests still match, but layersFrom picks the layer lines that list the new file', () => {
    expect(after.plan.action).toBe('PARTIAL_UPDATE');
    const runs = after.incremental[NEW_FILE];
    // what finalize-incremental.mjs writes: the previous factsDigest, so the digests alone pick the older semantic graph
    expect(pick(runs, '.factDigest').lines).toEqual(pick(runs, '.factsDigest').lines);
    expect(pick(runs, '.factsDigest').lines).toEqual(pick(after.full[OLD_FILE], '.factsDigest').lines);
    expect(pick(runs, 'jq -c --arg id').lines).toEqual([]);
    expect(pick(runs, '.layersFrom').lines).toEqual(['incremental']);
    expect(pickSource(runs)).toBe('lines');
    expect(layerIds(pick(runs, 'grep -F').lines)).toHaveLength(1);
  });

  it('after the second Full run: layersFrom is gone, the old layer lines are carried, the semantic graph is newer', () => {
    const runs = after.secondFull[NEW_FILE];
    expect(pick(runs, '.layersFrom').lines).toEqual([]);
    expect(layerIds(allLayerLines(runs).lines)).toEqual(layerIds(allLayerLines(after.incremental[NEW_FILE]).lines));
    expect(pick(runs, '.factDigest').lines).toEqual(pick(runs, '.factsDigest').lines);
    expect(pick(runs, '.factsDigest').lines).not.toEqual(pick(after.full[OLD_FILE], '.factsDigest').lines);
    expect(pickSource(runs)).toBe('semantic');
    expect(layerIds(pick(runs, 'jq -c --arg id').lines)).toEqual(['layer:service']);
  });
});
