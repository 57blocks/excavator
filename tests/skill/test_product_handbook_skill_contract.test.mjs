/**
 * The excavator-product-handbook skill is a prompt; its rules only hold if each
 * one sits in the phase where the model acts on it. These tests pin the target
 * state of the openspec change product-handbook-map: the phases, the options,
 * the language of everything the skill writes to the user, the commands it
 * names against the commands handbook.mjs has, the lane prompt's rules and its
 * JSON shape against the shape the scripts check, the `select` step for
 * --features, the fixed-text phase, and a closing reply printed by a command.
 * The skill's own jq and shell recipes are run on a real run directory.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { entryShapeProblems, ENTRY_FORMAT } from '../../skills/excavator-product-handbook/lib/entry-shape.mjs';
import { mapShapeProblems } from '../../skills/excavator-product-handbook/lib/map-shape.mjs';
import { nextLine } from '../../skills/excavator-product-handbook/lib/state.mjs';
import { SELECT_NEXT } from '../../skills/excavator-product-handbook/lib/select.mjs';
import { UI_FORMAT } from '../../skills/excavator-product-handbook/lib/ui.mjs';
import { HANDBOOK_SCRIPT, makeCheckedMapRun, runHandbook } from './excavator-product-handbook/helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const skill = readFileSync(resolve(repoRoot, 'skills/excavator-product-handbook/SKILL.md'), 'utf-8');
const flat = (text) => text.replace(/\s+/g, ' ');

/** Split the skill into its `## Phase N: Title` sections, keyed by N, each without its title line. */
function rawPhases(text) {
  const out = new Map();
  const parts = text.split(/^## Phase (\d+): /m);
  for (let i = 1; i < parts.length; i += 2) out.set(Number(parts[i]), parts[i + 1].slice(parts[i + 1].indexOf('\n') + 1));
  return out;
}
const raw = rawPhases(skill);
const phase = (n) => flat(raw.get(n) ?? '').trim();
const before = flat(skill.split(/^## Phase 0: /m)[0]);
/** The text blocks of four backticks (they hold three-backtick examples), in order: the lane prompt, then the translation prompt. */
const promptBlocks = (text) => [...text.matchAll(/^````text\n([\s\S]*?)\n````$/gm)].map((match) => match[1]);
const lanePrompt = promptBlocks(raw.get(4) ?? '')[0] ?? '';
const translationPrompt = promptBlocks(raw.get(2) ?? '')[0] ?? '';
/** The fenced blocks of a language (three backticks), in order. */
const blocks = (text, language) => [...text.matchAll(new RegExp(`^\\s*\`\`\`${language}\\n([\\s\\S]*?)\\n\\s*\`\`\`$`, 'gm'))].map((match) => match[1]);
const allBash = blocks(skill, 'bash');

const LANGUAGE_RULE = '**Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file\'s rule to reply in another language is for work on the project\'s code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product\'s values stay as they are.';
const PHASE_LANGUAGE = 'Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.';
const RETRY_HEADING = 'Your previous attempt failed these checks; fix them and write the file again:';
const HANDBOOK = '"$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs"';

describe('excavator-product-handbook skill: structure', () => {
  it('names the skill after its directory and lists the options in the argument hint', () => {
    expect(skill.startsWith('---\nname: excavator-product-handbook\n')).toBe(true);
    expect(skill).toContain('argument-hint: "[path] [--language <lang>] [--out <dir>] [--features <list>] [--concurrency <n>] [--fresh]"');
  });

  it('has the description in plain words: what it produces, and that it gives no advice', () => {
    const description = skill.match(/^description: (.+)$/m)[1];
    expect(description).toMatch(/product handbook/);
    expect(description).toMatch(/handbook\.md/);
    expect(description).toMatch(/gives no advice/);
    expect(description).not.toMatch(/: /);
  });

  it('has the six phases in order', () => {
    expect([...raw.keys()]).toEqual([0, 1, 2, 3, 4, 5]);
    const titles = [...skill.matchAll(/^## Phase \d+: (.+)$/gm)].map((match) => match[1]);
    expect(titles).toEqual(['Setup', 'Candidates', 'Fixed text', 'The map', 'Entries', 'Assemble, page and reply']);
  });

  it('describes every option of the argument hint in the Options section', () => {
    const options = flat(skill.split(/^## Options$/m)[1].split(/^## Sources$/m)[0]);
    for (const option of ['--language <lang>', '--out <dir>', '--features <list>', '--concurrency <n>', '--fresh']) expect(options, option).toContain(`\`${option}\``);
    expect(options).toContain('(default: `<project>/.excavator/product-handbook`)');
    expect(options).toContain('(default: 3)');
    expect(options).toContain('English when it is not given');
  });

  it('holds only ASCII', () => {
    expect(skill).toMatch(/^[\x00-\x7f]*$/);
  });

  it('states the no-advice rule and the sources rule', () => {
    expect(before).toContain('**As-Is only, no advice.**');
    expect(before).toContain('Never write what the product should do');
    const sources = flat(skill.split(/^## Sources$/m)[1].split(/^---$/m)[0]);
    expect(sources).toContain('Never read anything under `.excavator/`');
    expect(sources).toContain('never read a document that an Excavator skill generated');
    expect(sources).toContain('Never run, build or change anything in the project');
    expect(sources).toContain('Write only under `$OUT`');
  });
});

describe('excavator-product-handbook skill: language', () => {
  it('has the Language paragraph in Phase 0 and again before the closing reply', () => {
    expect(phase(0)).toContain(LANGUAGE_RULE);
    expect(phase(5)).toContain(LANGUAGE_RULE);
    const closing = phase(5);
    expect(closing.indexOf(LANGUAGE_RULE)).toBeLessThan(closing.indexOf('Then print the reply'));
  });

  it('repeats the one-line reminder at the top of every later phase', () => {
    for (const n of [1, 2, 3, 4, 5]) expect(phase(n).startsWith(PHASE_LANGUAGE), `phase ${n}`).toBe(true);
  });

  it('writes the run language as English however the user spelled it, because the script only knows the name English', () => {
    expect(phase(0)).toContain('`$RUN_LANGUAGE`');
    expect(phase(0)).toContain('the script treats only the name `English` as English');
    expect(phase(3)).toContain('"language": "<$RUN_LANGUAGE>"');
  });
});

describe('excavator-product-handbook skill: setup', () => {
  it('resolves PLUGIN_ROOT in one block that echoes the resolved paths, and no later block resolves it again', () => {
    const resolveBlocks = allBash.filter((block) => block.includes('PLUGIN_ROOT=""'));
    expect(resolveBlocks).toHaveLength(1);
    const [resolveBlock] = resolveBlocks;
    expect(resolveBlock).toContain('~/.agents/skills/excavator-product-handbook');
    expect(resolveBlock).toContain('"${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"');
    expect(resolveBlock).toContain('echo "PROJECT_ROOT=$PROJECT_ROOT"; echo "OUT=$OUT"; echo "PLUGIN_ROOT=$PLUGIN_ROOT"');
    expect(resolveBlock).toContain('OUT="$PROJECT_ROOT/.excavator/product-handbook"');
    expect(phase(0)).toContain('Each bash call starts a new shell: in every later command, write `$PROJECT_ROOT`, `$OUT` and `$PLUGIN_ROOT` as the values this block printed.');
    for (const block of allBash.filter((b) => b !== resolveBlock)) expect(block).not.toMatch(/^PLUGIN_ROOT=/m);
  });

  it('passes --project to every handbook.mjs command that reads the project, and the project itself to candidates', () => {
    const lines = allBash.flatMap((block) => block.split('\n')).filter((line) => line.trim().startsWith(`node ${HANDBOOK}`));
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      if (line.includes(`${HANDBOOK} candidates`)) expect(line).toContain('candidates "$PROJECT_ROOT"');
      else if (line.includes(`${HANDBOOK} check-ui`)) expect(line).not.toContain('--project');
      else expect(line, line).toContain('--project "$PROJECT_ROOT"');
    }
  });

  it('refuses to continue when the script was not found, and handles a stale lock', () => {
    expect(phase(0)).toContain('When `SCRIPT=missing`, tell the user the plugin root was not found, and stop.');
    expect(phase(0)).toContain('delete that lock file and run the command again; never delete it while a command runs');
  });

  it('--fresh deletes only an empty or absent directory or one holding this skill\'s files (the block is run)', () => {
    const block = blocks(raw.get(0), 'bash').find((b) => b.includes('fresh: deleted'));
    expect(block).toBeDefined();
    const cases = [];
    const base = mkdtempSync(join(tmpdir(), 'xhb-fresh-'));
    try {
      const run = (name, setup) => {
        const dir = join(base, name);
        setup(dir);
        const script = block.replace('OUT="<the value Phase 0 printed>"', `OUT="${dir}"`);
        const result = spawnSync('bash', ['-c', script], { encoding: 'utf-8' });
        cases.push({ name, out: result.stdout.trim(), exists: existsSync(dir) });
      };
      run('absent', () => {});
      run('empty', (dir) => mkdirSync(dir));
      run('state', (dir) => { mkdirSync(dir); writeFileSync(join(dir, 'state.json'), '{"format": "excavator-product-handbook-state/1", "features": {}}'); });
      run('candidates', (dir) => { mkdirSync(dir); writeFileSync(join(dir, 'candidates.json'), '{"format": "excavator-product-handbook-candidates/1"}'); });
      run('other', (dir) => { mkdirSync(dir); writeFileSync(join(dir, 'notes.txt'), 'mine'); });
      run('prdIndex', (dir) => { mkdirSync(dir); writeFileSync(join(dir, 'index.json'), '{"format": "excavator-prd-report/2"}'); });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    expect(cases).toEqual([
      { name: 'absent', out: 'fresh: nothing to delete', exists: false },
      { name: 'empty', out: 'fresh: nothing to delete', exists: true },
      { name: 'state', out: 'fresh: deleted', exists: false },
      { name: 'candidates', out: 'fresh: deleted', exists: false },
      { name: 'other', out: 'fresh: refused, the directory holds other files', exists: true },
      { name: 'prdIndex', out: 'fresh: refused, the directory holds other files', exists: true },
    ]);
    expect(phase(0)).toContain('tell the user `$OUT` holds other files, and stop');
  });

  it('resumes by default and stops on a language that differs from the earlier run\'s', () => {
    expect(phase(0)).toContain('is resumed');
    expect(phase(0)).toContain('jq -r .language "$OUT/map.json"');
    expect(phase(0)).toContain('tell the user to run again with `--fresh`, and stop');
  });
});

describe('excavator-product-handbook skill: commands', () => {
  const usage = runHandbook(['--help']).stdout;
  const usageCommands = [...new Set([...usage.matchAll(/^ {2}([a-z][a-z-]*) </gm)].map((match) => match[1]))];
  const skillCommands = [...new Set([...skill.matchAll(/handbook\.mjs" ([a-z][a-z-]*)/g)].map((match) => match[1]))];

  it('names every command handbook.mjs has, and only those', () => {
    expect(usageCommands.length).toBeGreaterThanOrEqual(9);
    expect(usageCommands).toEqual(expect.arrayContaining(['candidates', 'check-map', 'select', 'check-entry', 'mark', 'check-ui', 'assemble', 'page', 'reply']));
    expect([...skillCommands].sort()).toEqual([...usageCommands].sort());
  });

  it('uses each command in the phase that needs it', () => {
    expect(raw.get(1)).toContain(`${HANDBOOK} candidates`);
    expect(raw.get(2)).toContain(`${HANDBOOK} check-ui`);
    expect(raw.get(3)).toContain(`${HANDBOOK} check-map`);
    expect(raw.get(3)).toContain(`${HANDBOOK} select`);
    expect(raw.get(4)).toContain(`${HANDBOOK} mark`);
    expect(raw.get(4)).toContain(`${HANDBOOK} check-entry`);
    expect(raw.get(5)).toContain(`${HANDBOOK} assemble`);
    expect(raw.get(5)).toContain(`${HANDBOOK} page`);
    expect(raw.get(5)).toContain(`${HANDBOOK} reply`);
  });

  it('runs every handbook.mjs command from the script path the resolve block builds', () => {
    expect(HANDBOOK_SCRIPT).toBe(resolve(repoRoot, 'skills/excavator-product-handbook/handbook.mjs'));
    expect(existsSync(HANDBOOK_SCRIPT)).toBe(true);
  });
});

describe('excavator-product-handbook skill: candidates and map', () => {
  it('saves the candidate listing to $OUT/candidates.json, skips it on a resume and tells the user about uncovered frameworks', () => {
    expect(phase(1)).toContain('When `$OUT/candidates.json` exists, skip the listing');
    expect(phase(1)).toContain(`${HANDBOOK} candidates "$PROJECT_ROOT" > "$OUT/candidates.json"`);
    expect(phase(1)).toContain('which frameworks are `uncovered`');
    expect(phase(1)).toContain('Do not add candidates yourself');
  });

  it('shows a map.json example that passes the map shape check', () => {
    const example = blocks(raw.get(3), 'json')[0];
    expect(mapShapeProblems(JSON.parse(example))).toEqual([]);
  });

  it('is a writing guide: areas, one feature per thing a reader does, the five reach values, labels, roles, names, conservation, seed files', () => {
    const p = phase(3);
    for (const word of ['**Areas, as the reader sees them.**', '**Features, one per thing a reader does.**', '**Reach: how a reader gets to the feature.**', '**Labels, quoted from the source.**', '**Roles.**', '**Names.**', '**Conservation.**', '**Seed files.**']) {
      expect(p, word).toContain(word);
    }
    for (const reach of ['menu', 'link', 'automated', 'interface', 'operator']) expect(p, reach).toContain(`\`${reach}\` -`);
    expect(p).toContain('navigation and menu configuration');
    expect(p).toContain('page and tab titles');
    expect(p).toContain('public link');
    expect(p).toContain('a link inside an email or message the product sends');
    expect(p).toContain('a jump from another page');
    expect(p).toContain('a menu entry that is commented out or hidden while its route is still registered');
    expect(p).toContain('A `menu` or `link` feature needs `label` and `evidence`, and the label must occur in the quoted passage.');
    expect(p).toContain('Every candidate id in `candidates.json` appears in exactly one feature\'s `candidates` or in `unassigned` with a reason');
    expect(p).toContain('`names` lists the external products');
  });

  it('lists the reader-text rules, naming every banned class, Arabic numerals and source-language labels', () => {
    const p = phase(3);
    for (const word of ['identifiers with an underscore', 'camel-case and mixed-case words', 'paths that start with `/`', '`.go`, `.ts`, `.tsx`, `.js`, `.jsx`, `.java`, `.py`, `.sql`, `.json`, `.yaml`, `.yml`', 'a name followed by `(`', 'the names of the project\'s member repositories']) {
      expect(p, word).toContain(word);
    }
    expect(p).toContain('Numbers are Arabic numerals, always');
    expect(p).toContain('Labels stay in the source\'s language');
    expect(p).toContain('are written in `$LANGUAGE`');
  });

  it('checks the map with check-map and fixes it before any lane is dispatched', () => {
    const p = phase(3);
    expect(p).toContain(`${HANDBOOK} check-map "$OUT" --project "$PROJECT_ROOT"`);
    expect(p).toContain('dispatch no lane until it exits 0');
    expect(p).toContain('creates `state.json` with every feature planned');
    expect(p).toContain('never drop a candidate into `unassigned` with a reason that is not true');
  });
});

describe('excavator-product-handbook skill: --features', () => {
  const p = phase(3);

  it('runs select after check-map passes, with the list as one single-quoted argument', () => {
    expect(p).toContain(`${HANDBOOK} select "$OUT" --features '<the --features value>' --project "$PROJECT_ROOT"`);
    expect(p.indexOf('check-map "$OUT"')).toBeLessThan(p.indexOf('select "$OUT"'));
    expect(p).toContain('run this once `check-map` passes');
    expect(p).toContain('Without `--features`, every feature gets an entry.');
  });

  it('stops the run and reports the printed list when select exits 1, dispatching nothing', () => {
    expect(p).toContain('Exit 1: an item matched no feature or several');
    expect(p).toContain('Stop the run here: tell the user the lines it printed, as printed, dispatch no lane and run no further command.');
    expect(SELECT_NEXT).toBe('Next: stop the run; report the lines above to the user and dispatch no lane');
  });

  it('dispatches lanes only for the selected ids and leaves the others planned', () => {
    expect(p).toContain('Only those get lanes in Phase 4');
    expect(p).toContain('Every other feature stays planned and is listed in the handbook as not written.');
    expect(phase(4)).toContain('`<ids>` is `$SELECTED` space-separated, or empty without `--features`');
  });

  it('names the feature-name matching rule in Options', () => {
    const options = flat(skill.split(/^## Options$/m)[1]);
    expect(options).toContain('a name is matched ignoring case, as a whole name');
    expect(options).toContain('Phase 3 resolves the list with `select`');
  });
});

describe('excavator-product-handbook skill: the lane prompt', () => {
  const prompt = flat(lanePrompt);

  it('exists as one four-backtick text block in Phase 4', () => {
    expect(lanePrompt.length).toBeGreaterThan(2000);
    expect(promptBlocks(raw.get(4))).toHaveLength(1);
  });

  it('has an entry shape that the entry shape check accepts, with every key present', () => {
    const json = blocks(lanePrompt, 'json')[0];
    const entry = JSON.parse(json.replace(/(:\s*)E(\s*[,}])/g, '$1[{"file": "f", "passage": "p"}]$2'));
    expect(entryShapeProblems(entry)).toEqual([]);
    expect(entry.format).toBe(ENTRY_FORMAT);
    expect(Object.keys(entry)).toEqual(['format', 'id', 'purpose', 'who', 'where', 'screens', 'operations', 'states', 'notifications', 'automatic', 'unknowns']);
    expect(entry.screens[0].fields[0].rules.map((rule) => rule.side)).toEqual(['frontend', 'backend']);
    expect(prompt).toContain('`E` stands for an evidence list, a non-empty array of `{"file": "<path from the project root>", "passage": "<text copied from that file>"}`');
  });

  it('requires empty lists for parts that do not apply, never an omitted key or an extra key', () => {
    expect(prompt).toContain('Every key is always there: when a part does not apply to your feature, write an empty list (`"notifications": []`), never leave the key out and never add a key.');
    expect(prompt).toContain('`unknowns` has no evidence.');
  });

  it('requires every passage to occur exactly once in its file, and says what to do when it does not', () => {
    expect(prompt).toContain('it must occur **exactly once** in that file');
    expect(prompt).toContain('quote a longer one (the whole line, or the lines around it)');
    expect(prompt).toContain('Every item carries its own evidence.');
    expect(prompt).toContain('never under `.excavator`, `.git`, `node_modules`, `vendor`, `dist` or `build`');
  });

  it('requires labels and numbers to be in the item\'s own passages, numbers as Arabic numerals', () => {
    expect(prompt).toContain('**Labels and numbers must be in the item\'s own passages.**');
    expect(prompt).toContain('must occur in that item\'s own passages, exactly as the source writes it, in the source\'s language: never translate a label');
    expect(prompt).toContain('Every number in your text must occur as a number in that item\'s own passages');
    expect(prompt).toContain('Write numbers as Arabic numerals ("2 levels", never "two levels")');
  });

  it('takes roles only from the map', () => {
    expect(prompt).toContain('The roles an entry may name, and no others: <roles, one label per line>.');
    expect(prompt).toContain('`who.role` is one of the roles listed above, spelled the same.');
    expect(prompt).toContain('The names of external products and systems that the map lists');
  });

  it('forbids reading anything under .excavator/ or generated documents, and builds no project', () => {
    expect(prompt).toContain('Never read anything under `.excavator/` and never read a document that an Excavator skill generated');
    expect(prompt).toContain('Read code only; never run, build or change anything in the project.');
    expect(prompt).toContain('--exclude-dir=.excavator');
    expect(prompt).toContain('Read only these files: <seedFiles, one per line>');
  });

  it('forbids code-shaped words in reader text, naming each class', () => {
    for (const word of ['no identifier with an underscore', 'no camel-case or mixed-case word', 'no path that starts with `/`', '.go .ts .tsx .js .jsx .java .py .sql .json .yaml .yml', 'no name followed by `(`', 'no name of a member directory of the project']) {
      expect(prompt, word).toContain(word);
    }
    expect(prompt).toContain('Never print a raw code, flag or `field=value`');
  });

  it('searches the whole project before a negative or absolute statement, and writes an unknown when it cannot settle it', () => {
    expect(prompt).toContain('**Negative and absolute statements.**');
    expect(prompt).toContain('search the whole project');
    expect(prompt).toContain('write it in `unknowns` with `item` and what you `searched`');
  });

  it('keeps frontend and backend rules apart and gives no advice', () => {
    expect(prompt).toContain('A field\'s `rules` keeps the frontend and the backend apart');
    expect(prompt).toContain('Give no advice, no opinion and no defect report');
  });

  it('writes only the lane\'s own entry file and replies with one line', () => {
    expect(prompt).toContain('Write only `$OUT/entries/<id>.json`, and nothing else anywhere.');
    expect(prompt).toContain('Reply with one line: `<id>: written`, and nothing else.');
  });
});

describe('excavator-product-handbook skill: dispatch and retry', () => {
  const p = phase(4);

  it('records each batch of dispatches with mark before the message that dispatches it', () => {
    expect(p).toContain('Put the `mark` calls of one batch in one Bash command, one after another, before the message that dispatches the batch');
    expect(p).toContain(`${HANDBOOK} mark "$OUT" <id> dispatched --project "$PROJECT_ROOT"`);
  });

  it('dispatches foreground subagents, at most $CONCURRENCY in one message', () => {
    expect(p).toContain('Dispatch at most `$CONCURRENCY` lanes in one message');
    expect(p).toContain('each a subagent in the foreground');
    expect(p).toContain('never in the background');
    expect(p).toContain('Wait for every lane of the message to return before you send the next');
  });

  it('checks each lane with check-entry as it returns, one at a time', () => {
    expect(p).toContain('Run `check-entry` for one lane at a time, as each returns, never two at once');
    expect(p).toContain(`${HANDBOOK} check-entry "$OUT" <id> --project "$PROJECT_ROOT"`);
  });

  it('follows the Next lines check-entry prints, quoted exactly, with a retry once and never a third attempt', () => {
    expect(p).toContain(`\`${nextLine('<id>', 1)}\``);
    expect(p).toContain(`\`${nextLine('<id>', 2)}\``);
    expect(p).toContain(`\`${RETRY_HEADING}\``);
    expect(p).toContain('re-dispatch the lane once');
    expect(p).toContain('Never make a third attempt.');
  });

  it('never edits a lane\'s file or state.json itself', () => {
    expect(p).toContain('Never edit `entries/<id>.json` or `state.json` yourself');
    expect(p).toContain('never widen a passage or reword an entry to make it pass');
    expect(p).toContain('Statuses and attempts change only through these commands.');
  });

  it('skips a feature that is already checked, and resumes one that was dispatched and wrote', () => {
    expect(p).toContain('A feature that is `checked` is not written again.');
    expect(p).toContain('`dispatched` and has an entry file');
    expect(p).toContain('rm -f "$OUT/entries/<id>.json"');
  });

  it('reports each lane to the user in $LANGUAGE', () => {
    expect(p).toContain('`Lane <id> <n>/<N>: <status>`');
    expect(p).toContain('in `$LANGUAGE`');
  });
});

describe('excavator-product-handbook skill: the lane listing recipe (run on a real state.json)', () => {
  const recipe = () => allBash.flatMap((block) => block.split('\n')).map((line) => line.trim()).find((line) => line.startsWith('jq -r --arg ids'));
  const list = (ids) => {
    const run = makeCheckedMapRun();
    try {
      expect(run.run('mark', 'F1', 'dispatched').status).toBe(0);
      expect(run.run('mark', 'F2', 'failed', 'lane', 'wrote-nothing').status).toBe(0);
      const line = recipe().replace('<ids>', ids).replace('"$OUT/state.json"', `"${join(run.out, 'state.json')}"`);
      const result = spawnSync('bash', ['-c', line], { encoding: 'utf-8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim().split('\n').filter((row) => row !== '');
    } finally {
      run.cleanup();
    }
  };

  it('lists every feature with its status and attempts when no ids are selected', () => {
    expect(list('')).toEqual(['F1\tdispatched\t1', 'F2\tfailed\t0', 'F3\tplanned\t0', 'F4\tplanned\t0', 'F5\tplanned\t0']);
  });

  it('lists only the selected ids', () => {
    expect(list('F2 F5')).toEqual(['F2\tfailed\t0', 'F5\tplanned\t0']);
  });

  it('lists nothing for an id the map does not have', () => {
    expect(list('F9')).toEqual([]);
  });
});

describe('excavator-product-handbook skill: the language of the narrative is checked by the scripts', () => {
  it('writes the fixed text before the map, because the scripts read it to know the language\'s script', () => {
    const titles = [...skill.matchAll(/^## Phase \d+: (.+)$/gm)].map((match) => match[1]);
    expect(titles.indexOf('Fixed text')).toBe(titles.indexOf('The map') - 1);
    expect(phase(2)).toContain('This phase runs before the map on purpose');
    expect(phase(2)).toContain('`check-map` and `check-entry` refuse a non-English run that has no checked `ui.json`');
    expect(phase(2)).toContain('there is no `map.json` yet to read the language from');
    expect(phase(2)).toContain('the run fails: tell the user the lines it printed, as printed, and stop; run no further phase');
  });

  it('keeps the resume rule: a ui.json of another language than the run\'s stops the run', () => {
    expect(phase(0)).toContain('jq -r .language "$OUT/ui.json"');
    expect(phase(0)).toContain('differs from `$RUN_LANGUAGE`, do the same');
  });

  it('refers to a phase by the number it has now', () => {
    expect(before).toContain('**Reader text** in Phase 3');
    expect(flat(skill.split(/^## Options$/m)[1].split(/^## Sources$/m)[0])).toContain('Phase 3 resolves the list with `select`');
    expect(phase(3)).toContain('Only those get lanes in Phase 4');
    expect(phase(5)).toContain('follow its `Next:` line as in Phase 4');
    for (const [, n] of skill.matchAll(/\bPhase (\d)\b/g)) expect(raw.has(Number(n)), `Phase ${n}`).toBe(true);
  });

  it('tells the map writer that the scripts refuse names and reasons written only in ASCII letters, for a language with its own script', () => {
    const p = phase(3);
    expect(p).toContain('**Language of the narrative.**');
    expect(p).toContain('an area name without `evidence`, a feature name without a `label`, every reason in `unassigned`');
    expect(p).toContain('they refuse any such text that holds no letter outside ASCII, and say which field');
    expect(p).toContain('a language written in Latin letters (French, Spanish) is not checked');
    expect(p).toContain('A text made only of numbers and labels quoted from the source is not refused.');
    expect(p).toContain('for a language with its own script, every name or reason of yours written only in ASCII letters');
    expect(p).toContain('go back to Phase 2, then run it again');
  });

  it('prefers the role name the product shows, quoted, and the code key only when the product shows none', () => {
    const p = phase(3);
    expect(p).toContain('Prefer the role name the product shows to its users');
    expect(p).toContain('Quote that line, so the label is the name a reader knows.');
    expect(p).toContain('Use the key the code uses (an enum value, often with an underscore) only when the product shows no name for that role');
    expect(p).toContain('"label": "<role name as the product shows it>"');
  });

  it('puts the language instruction in the lane prompt right before the JSON shape, and keeps the Write in line', () => {
    const prompt = flat(lanePrompt);
    const writeIn = prompt.indexOf('Write in `$LANGUAGE`, in plain words');
    const instruction = prompt.indexOf('Every narrative value of the JSON file below is written in $LANGUAGE');
    const shape = prompt.indexOf('Write one JSON file with exactly these keys');
    expect(writeIn).toBeGreaterThan(-1);
    expect(instruction).toBeGreaterThan(writeIn);
    expect(shape).toBeGreaterThan(instruction);
    // Nothing sits between the instruction paragraph and the shape paragraph.
    expect(prompt.slice(instruction, shape).length).toBeLessThan(500);
    expect(prompt.slice(instruction, shape)).toContain('Labels, screen names, `where` labels and the roles stay exactly as the source and the list above write them.');
    expect(prompt).toContain('when $LANGUAGE has its own script, it also refuses a narrative value that is written only in ASCII letters');
  });

  it('names the Next line check-entry prints when the fixed text is not ready, and keeps the two attempt lines', () => {
    const p = phase(4);
    expect(p).toContain('A `Next:` line that starts `Next: write ui.json first`');
    expect(p).toContain('this is not an attempt');
    expect(p).toContain('go back to Phase 2');
  });
});

describe('excavator-product-handbook skill: fixed text', () => {
  const p = phase(2);

  it('does nothing for English, where the script uses the shipped table', () => {
    expect(p).toContain('When `$RUN_LANGUAGE` is `English`, there is nothing to do: the script uses the shipped table.');
  });

  it('dispatches one subagent for another language, then runs check-ui', () => {
    expect(p).toContain('dispatch one subagent in the foreground');
    expect(p).toContain(`${HANDBOOK} check-ui "$OUT" --language "$RUN_LANGUAGE"`);
    expect(p).toContain('run `check-ui` first; when it exits 0 skip the translation');
  });

  it('re-dispatches once with the printed reasons, and fails the run when it still fails', () => {
    expect(p).toContain(`dispatch the subagent once more with its prompt followed by this line and then each line printed: \`${RETRY_HEADING}\``);
    expect(p).toContain('the run fails: tell the user the lines it printed, as printed, and stop; run no further phase');
  });

  it('has a translation prompt that reads only the shipped table, keeps keys and placeholders, and explains the page title pattern', () => {
    const prompt = flat(translationPrompt);
    expect(prompt).toContain('Read only `$PLUGIN_ROOT/skills/excavator-product-handbook/ui-strings.json`');
    expect(prompt).toContain('Keep every `{placeholder}` of a value exactly as written');
    expect(prompt).toContain('Never translate a key. Add no key and leave none out.');
    expect(prompt).toContain('`page.documentTitle` is a pattern whose `{page}` receives the text of `page.nav.overview` or of `page.notFound.heading`');
    expect(prompt).toContain(`"format": "${UI_FORMAT}"`);
    expect(prompt).toContain('Write only `$OUT/ui.json`, and nothing else anywhere');
  });

  it('names a shipped table that exists with the keys the prompt mentions', () => {
    const table = JSON.parse(readFileSync(resolve(repoRoot, 'skills/excavator-product-handbook/ui-strings.json'), 'utf-8'));
    expect(table.format).toBe(UI_FORMAT);
    for (const key of ['page.documentTitle', 'page.nav.overview', 'page.notFound.heading']) expect(Object.keys(table.strings)).toContain(key);
    expect(table.strings['page.documentTitle']).toContain('{page}');
  });
});

describe('excavator-product-handbook skill: assemble, page and the closing reply', () => {
  const p = phase(5);

  it('assembles and writes the page with the two commands, in that order', () => {
    expect(p.indexOf(`${HANDBOOK} assemble`)).toBeGreaterThan(-1);
    expect(p.indexOf(`${HANDBOOK} assemble`)).toBeLessThan(p.indexOf(`${HANDBOOK} page`));
  });

  it('tells the user to run pnpm -r build when the page template is missing, and still replies', () => {
    expect(p).toContain('When `page` exits 2 because the page template does not exist, tell the user to run `pnpm -r build` at `$PLUGIN_ROOT`');
    expect(p).toContain('it prints `Page: not written`');
  });

  it('prints the final reply with the last command of the skill, not composed by the model', () => {
    const last = allBash.at(-1);
    expect(last.trim()).toBe(`node ${HANDBOOK} reply "$OUT" --project "$PROJECT_ROOT"`);
    expect(skill.lastIndexOf(`${HANDBOOK} reply`)).toBeGreaterThan(skill.lastIndexOf(`${HANDBOOK} assemble`));
    const after = flat(skill.slice(skill.lastIndexOf(`${HANDBOOK} reply`)));
    expect(after).toContain('Reply with exactly the lines it prints and nothing else');
    expect(after).toContain('none added and none left out');
    expect(after).toContain('no summary or notes');
    expect(after).toContain('the paths, the numbers and the ids stay as they are');
  });

  it('lists the lines the reply holds: the paths, the counts by status and the conservation line', () => {
    expect(p).toContain('`Handbook:` and the path of `handbook.md`');
    expect(p).toContain('`Page:` and the path of `handbook.html`, or `Page: not written`');
    expect(p).toContain('`Features:` and the count of each status');
    expect(p).toContain('`Candidates:` and the conservation line');
  });

  it('keeps the handbook in $OUT and writes nothing into the project unless the user says so', () => {
    expect(p).toContain('The handbook stays in `$OUT`: write it into the project only when the user says so.');
  });
});
