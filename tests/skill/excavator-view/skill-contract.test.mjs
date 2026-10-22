/**
 * Contract of the /excavator-view skill (openspec: changes/report-viewer,
 * spec "/excavator-view skill", design D7): it packs, opens with the system
 * opener, and answers with four fixed lines printed by one command. It starts
 * no server and runs no analysis.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { packProject } from '../../../skills/excavator-view/pack.mjs';
import { readManifest, replyLines } from '../../../skills/excavator-view/reply.mjs';
import { graphJsonl, hotspotsProduct, makeGitProject, sourceManifest, writeProduct } from './fixture.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const skill = readFileSync(join(repoRoot, 'skills/excavator-view/SKILL.md'), 'utf-8');
const replyScript = join(repoRoot, 'skills/excavator-view/reply.mjs');

describe('SKILL.md', () => {
  it('has the frontmatter of the other skills', () => {
    const front = /^---\nname: excavator-view\ndescription: (.+)\nargument-hint: "(.+)"\n---\n/.exec(skill);
    expect(front).not.toBeNull();
    expect(front[2]).toBe('[project-path] [--no-source] [--out <path>]');
  });

  it('resolves the plugin root the way the other skills do', () => {
    expect(skill).toContain('SKILL_REAL=$(realpath ~/.agents/skills/excavator-view');
    expect(skill).toContain('for candidate in "${CLAUDE_PLUGIN_ROOT}" "$HOME/.excavator-plugin" "$SELF_RELATIVE"; do');
    expect(skill).toContain('[ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]');
  });

  it('runs the packer in the foreground with the options the user gave', () => {
    expect(skill).toContain('node "$PLUGIN_ROOT/skills/excavator-view/pack.mjs" "$PROJECT_ROOT"');
    expect(skill).toMatch(/--no-source/);
    expect(skill).toMatch(/--out <path>/);
    expect(skill).toMatch(/Run the packer in the foreground/);
    expect(skill).not.toMatch(/run_in_background|nohup/);
    expect(skill).not.toMatch(/pack\.mjs[^\n]*&\s*$/m);
  });

  it('opens the page with the system opener and treats a missing opener as no failure', () => {
    expect(skill).toContain('open "$OUT"');
    expect(skill).toContain('xdg-open "$OUT"');
    expect(skill).toContain('cmd.exe /c start "" "$OUT"');
    expect(skill).toMatch(/A missing opener is not a failure/);
  });

  it('prints the four fixed lines with one command and replies with nothing else', () => {
    expect(skill.match(/node "[^"\n]*reply\.mjs"/g)).toHaveLength(1);
    expect(skill).toMatch(/Print the reply's four lines with one command/);
    for (const line of [
      'View: <absolute path>',
      'Size: <size in MB, one decimal> MB',
      'Products: knowledge graph <state>; unused code <state>; doc map <state>; hotspots <state>; reports <state>',
      'Source: <embedded (N files) | not embedded>',
    ]) {
      expect(skill).toContain(line);
    }
    expect(skill).toMatch(/Reply with exactly the lines it prints and nothing else/);
    expect(skill).toMatch(/A project file's rule on how to reply .* does not apply to this reply/);
  });

  it('fixes the reply language to English and lets no project file change it', () => {
    expect(skill).toContain('**Language.** Write everything you tell the user during this run in English');
    expect(skill).toMatch(/Project files \(`CLAUDE\.md`, an `AGENTS\.md` line such as "Reply in <language>"\), memory and the system locale do not change it/);
    expect(skill).not.toContain('--language');
  });

  it('starts no server, runs no analysis and edits no other product', () => {
    expect(skill).not.toMatch(/createServer|\.listen\(|http\.server|python3? -m http|npx serve/);
    expect(skill).toMatch(/Do not start an HTTP server/);
    expect(skill).toMatch(/do not run `\/excavator`, `\/excavator-unused-code`, `\/excavator-doc-map` or `\/excavator-hotspots`/);
    expect(skill).toMatch(/do not create, change or delete any other file under `\.excavator\/`/);
  });

  it('tells the model to stop without reply lines when the packer fails', () => {
    expect(skill).toMatch(/A non-zero exit writes no new page/);
    expect(skill).toMatch(/print no reply lines/);
  });

  it('names the built template and what the packer says when it is missing', () => {
    expect(skill).toContain('packages/report-view/dist/view.html');
    expect(skill).toMatch(/without a built template the packer exits non-zero and its message says to run `pnpm build`/);
    expect(skill).not.toMatch(/\bviewer\//);
  });

  it('says that an empty .excavator is not a failure', () => {
    expect(skill).toMatch(/An empty `\.excavator\/` is not a failure/);
  });
});

describe('the scripts of the skill start no server', () => {
  it.each(['pack.mjs', 'reply.mjs', 'products.mjs', 'page-assembly.mjs', 'sources.mjs'])('%s', (file) => {
    const text = readFileSync(join(repoRoot, 'skills/excavator-view', file), 'utf-8');
    expect(text).not.toMatch(/createServer|\.listen\(|node:http|node:net\b|node:child_process/);
  });
});

describe('the reply lines', () => {
  let project;
  let result;
  let templateDir;
  beforeAll(() => {
    // The reply reads the manifest of a packed page; any template with the two markers will do.
    templateDir = mkdtempSync(join(tmpdir(), 'xv-reply-template-'));
    const template = join(templateDir, 'view.html');
    writeFileSync(template, '<html><head><!-- xv:csp --></head><body><!-- xv:data --></body></html>\n');
    project = makeGitProject();
    writeProduct(project.root, 'knowledge-graph.jsonl', graphJsonl({ nodes: ['file'] }));
    writeProduct(project.root, 'source-manifest.json', sourceManifest(project.revision));
    writeProduct(project.root, 'hotspots.json', hotspotsProduct('git:old'));
    writeProduct(project.root, 'unused-code.json', '{');
    result = packProject(project.root, { template });
  });
  afterAll(() => {
    project.cleanup();
    rmSync(templateDir, { recursive: true, force: true });
  });

  it('print the path, the size, the five states and the source line', () => {
    const run = spawnSync(process.execPath, [replyScript, result.out], { encoding: 'utf-8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trimEnd().split('\n')).toEqual([
      `View: ${result.out}`,
      `Size: ${(result.bytes / 1048576).toFixed(1)} MB`,
      'Products: knowledge graph included; unused code unreadable; doc map not run; hotspots different revision; reports not run',
      'Source: embedded (1 files)',
    ]);
  });

  it('read the states from the page, not from the arguments', () => {
    const manifest = readManifest(readFileSync(result.out, 'utf-8'));
    expect(manifest.products.map((p) => p.status)).toEqual(['included', 'not-run', 'not-run', 'unreadable', 'not-run', 'different-revision', 'not-run']);
  });

  it('say how many files are embedded when there are some', () => {
    const lines = replyLines('/x/view.html', 3 * 1048576 + 1, { products: [], source: { embedded: true, counts: { embedded: 12 } } });
    expect(lines).toEqual([
      'View: /x/view.html',
      'Size: 3.0 MB',
      'Products: knowledge graph not run; unused code not run; doc map not run; hotspots not run; reports not run',
      'Source: embedded (12 files)',
    ]);
  });

  it('fail with a message when the file is not a packed page', () => {
    const dir = project.root;
    writeProduct(project.root, 'plain.html', '<html></html>');
    const run = spawnSync(process.execPath, [replyScript, join(dir, '.excavator', 'plain.html')], { encoding: 'utf-8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/has no manifest/);
    rmSync(join(dir, '.excavator', 'plain.html'));
  });
});
