import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { assemblePage, CONTENT_SECURITY_POLICY, jsonForScript } from '../../../skills/excavator-view/page-assembly.mjs';
import { packProject } from '../../../skills/excavator-view/pack.mjs';
import {
  docMapProduct, graphJsonl, hotspotsProduct, makeGitProject, sourceManifest, unusedProduct, writeProduct,
} from './fixture.mjs';
import { manifestOf, payloadGzip, payloadIds, payloadText } from './page.mjs';
import { FIXTURE_TEMPLATE, makePluginRoot, repoRoot, writeTemplate } from './plugin-fixture.mjs';


const EXACT_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; worker-src blob:";

let project;
let templateDir;
let templatePath;
let pluginRoot;
let packScript;
beforeAll(() => {
  project = makeGitProject();
  ({ dir: templateDir, path: templatePath } = writeTemplate());
  pluginRoot = makePluginRoot(FIXTURE_TEMPLATE);
  packScript = join(pluginRoot, 'skills/excavator-view/pack.mjs');
});
afterAll(() => {
  project.cleanup();
  rmSync(templateDir, { recursive: true, force: true });
  rmSync(pluginRoot, { recursive: true, force: true });
});
beforeEach(() => rmSync(join(project.root, '.excavator'), { recursive: true, force: true }));

const pack = (options) => {
  const result = packProject(project.root, { template: templatePath, ...options });
  const html = readFileSync(result.out, 'utf-8');
  return { result, html, manifest: manifestOf(html) };
};
const productOf = (packed, name) => packed.result.products.find((p) => p.name === name);

describe('product states', () => {
  it('shows every product as not run when .excavator is empty, and still writes the page', () => {
    const packed = pack();
    expect(packed.result.products.map((p) => [p.name, p.status])).toEqual([
      ['knowledge-graph', 'not-run'], ['semantics', 'not-run'], ['domain-graph', 'not-run'], ['unused-code', 'not-run'],
      ['doc-map', 'not-run'], ['hotspots', 'not-run'], ['reports', 'not-run'],
    ]);
    expect(packed.result.out).toBe(join(project.root, '.excavator', 'view.html'));
    expect(payloadIds(packed.html)).toEqual([]);
    expect(packed.manifest.products.find((p) => p.name === 'hotspots').command).toBe('/excavator-hotspots');
    expect(packed.manifest.products.find((p) => p.name === 'knowledge-graph').command).toBe('/excavator');
    expect(packed.manifest.products.find((p) => p.name === 'unused-code').command).toBe('/excavator-unused-code');
    expect(packed.manifest.products.find((p) => p.name === 'doc-map').command).toBe('/excavator-doc-map');
    expect(packed.manifest.products.find((p) => p.name === 'semantics').command).toBe('/excavator --full');
    expect(packed.manifest.products.find((p) => p.name === 'domain-graph').command).toBe('/excavator-domain');
  });

  it('shows the semantic and domain files as unreadable with a reason while the packer does not read them', () => {
    writeProduct(project.root, 'semantic-cache.json', '{}');
    writeProduct(project.root, 'domain-graph.json', '{}');
    const packed = pack();
    for (const name of ['semantics', 'domain-graph']) {
      expect(productOf(packed, name)).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/is present; this version of the packer does not read it yet/) });
    }
    expect(payloadIds(packed.html)).toEqual([]);
  });

  it('includes every product whose revision matches the snapshot', () => {
    writeProduct(project.root, 'knowledge-graph.jsonl', graphJsonl({ nodes: ['file'] }));
    writeProduct(project.root, 'source-manifest.json', sourceManifest(project.revision));
    writeProduct(project.root, 'unused-code.json', unusedProduct(project.revision));
    writeProduct(project.root, 'doc-map.json', docMapProduct(project.revision));
    writeProduct(project.root, 'hotspots.json', hotspotsProduct(project.revision));
    writeProduct(project.root, 'hotspots-report.md', '# Hotspots\n');
    writeProduct(project.root, 'doc-map-report.md', '# Doc map\n');
    const packed = pack();
    for (const name of ['knowledge-graph', 'unused-code', 'doc-map', 'hotspots', 'reports']) {
      expect(productOf(packed, name).status, name).toBe('included');
    }
    expect(productOf(packed, 'hotspots').revision).toBe(project.revision);
    expect(packed.result.snapshotRevision).toBe(project.revision);
    expect(payloadIds(packed.html)).toEqual(['knowledge-graph', 'unused-code', 'doc-map', 'hotspots', 'report-hotspots', 'report-doc-map', 'sources']);
    expect(payloadText(packed.html, 'unused-code')).toBe(JSON.stringify(unusedProduct(project.revision)));
    expect(payloadText(packed.html, 'report-hotspots')).toBe('# Hotspots\n');
  });

  it('marks a product that is not JSON as unreadable with its reason, and embeds none of it', () => {
    writeProduct(project.root, 'unused-code.json', '{"format": "excavator-unused-code/1", "unused": [');
    const packed = pack();
    const row = productOf(packed, 'unused-code');
    expect(row.status).toBe('unreadable');
    expect(row.reason).toMatch(/unused-code\.json is not valid JSON/);
    expect(payloadIds(packed.html)).not.toContain('unused-code');
  });

  it('marks an unknown format as unreadable and names both formats', () => {
    writeProduct(project.root, 'hotspots.json', { ...hotspotsProduct(project.revision), format: 'excavator-hotspots/2' });
    const row = productOf(pack(), 'hotspots');
    expect(row.status).toBe('unreadable');
    expect(row.reason).toContain('"excavator-hotspots/2"');
    expect(row.reason).toContain('excavator-hotspots/1');
  });

  it('marks a product with no format field as unreadable', () => {
    const { format, ...rest } = unusedProduct(project.revision);
    writeProduct(project.root, 'unused-code.json', rest);
    expect(productOf(pack(), 'unused-code').reason).toContain('format none');
  });

  it('names the missing top-level keys', () => {
    const { groups, testOnly, ...rest } = unusedProduct(project.revision);
    writeProduct(project.root, 'unused-code.json', rest);
    const row = productOf(pack(), 'unused-code');
    expect(row.status).toBe('unreadable');
    expect(row.reason).toContain('groups, testOnly');
  });

  it('marks a top-level array as unreadable', () => {
    writeProduct(project.root, 'doc-map.json', '[]');
    expect(productOf(pack(), 'doc-map').reason).toMatch(/not a JSON object/);
  });

  it('shows a product made at another revision as different revision, with its content embedded', () => {
    writeProduct(project.root, 'hotspots.json', hotspotsProduct('git:0000000000000000000000000000000000000000'));
    const packed = pack();
    const row = productOf(packed, 'hotspots');
    expect(row.status).toBe('different-revision');
    expect(row.revision).toBe('git:0000000000000000000000000000000000000000');
    expect(payloadIds(packed.html)).toContain('hotspots');
    expect(packed.manifest.snapshot.revision).toBe(project.revision);
  });

  it('notes a missing revision instead of treating it as equal', () => {
    const { sourceRevision, ...rest } = hotspotsProduct(project.revision);
    writeProduct(project.root, 'hotspots.json', rest);
    writeProduct(project.root, 'doc-map.json', docMapProduct(undefined));
    const packed = pack();
    for (const name of ['hotspots', 'doc-map']) {
      expect(productOf(packed, name)).toMatchObject({ status: 'included', note: 'no revision recorded' });
    }
  });

  it('reads the doc-map revision from code.revision', () => {
    writeProduct(project.root, 'doc-map.json', docMapProduct('git:aaaa'));
    expect(productOf(pack(), 'doc-map')).toMatchObject({ status: 'different-revision', revision: 'git:aaaa' });
  });

  describe('doc-map/checks.json', () => {
    it('keeps the doc map included when checks.json is absent', () => {
      writeProduct(project.root, 'doc-map.json', docMapProduct(project.revision));
      const packed = pack();
      expect(productOf(packed, 'doc-map').status).toBe('included');
      expect(payloadIds(packed.html)).toEqual(['doc-map']);
    });

    it('embeds checks.json beside the doc map when it is readable', () => {
      writeProduct(project.root, 'doc-map.json', docMapProduct(project.revision));
      writeProduct(project.root, 'doc-map/checks.json', { checks: [] });
      const packed = pack();
      expect(productOf(packed, 'doc-map').status).toBe('included');
      expect(payloadIds(packed.html)).toEqual(['doc-map', 'doc-map-checks']);
    });

    it('makes the whole doc map unreadable when checks.json is corrupt', () => {
      writeProduct(project.root, 'doc-map.json', docMapProduct(project.revision));
      writeProduct(project.root, 'doc-map/checks.json', '{"checks": [');
      const packed = pack();
      const row = productOf(packed, 'doc-map');
      expect(row.status).toBe('unreadable');
      expect(row.reason).toMatch(/doc-map\/checks\.json is not valid JSON/);
      expect(payloadIds(packed.html)).toEqual([]);
    });

    it('makes the whole doc map unreadable when checks.json has no checks array', () => {
      writeProduct(project.root, 'doc-map.json', docMapProduct(project.revision));
      writeProduct(project.root, 'doc-map/checks.json', { verdicts: [] });
      expect(productOf(pack(), 'doc-map').reason).toContain('checks');
    });
  });

  describe('knowledge graph', () => {
    it('is unreadable when the header line is not JSON', () => {
      writeProduct(project.root, 'knowledge-graph.jsonl', 'not json\n{"record":"node"}\n');
      expect(productOf(pack(), 'knowledge-graph')).toMatchObject({ status: 'unreadable' });
    });

    it('is unreadable when the first record is not a header', () => {
      writeProduct(project.root, 'knowledge-graph.jsonl', '{"record":"node","node":{}}\n');
      expect(productOf(pack(), 'knowledge-graph').reason).toMatch(/not a header record/);
    });

    it('is unreadable with an unknown format', () => {
      writeProduct(project.root, 'knowledge-graph.jsonl', `${JSON.stringify({ record: 'header', format: 'excavator-knowledge-graph-lines/9', keys: [], fields: {}, counts: {} })}\n`);
      expect(productOf(pack(), 'knowledge-graph').reason).toContain('excavator-knowledge-graph-lines/9');
    });

    it('is unreadable when the file is empty', () => {
      writeProduct(project.root, 'knowledge-graph.jsonl', '');
      expect(productOf(pack(), 'knowledge-graph').reason).toMatch(/is empty/);
    });

    it('is unreadable when source-manifest.json is corrupt', () => {
      writeProduct(project.root, 'knowledge-graph.jsonl', graphJsonl({}));
      writeProduct(project.root, 'source-manifest.json', '{');
      expect(productOf(pack(), 'knowledge-graph').reason).toMatch(/source-manifest\.json is not valid JSON/);
    });

    it('notes a missing revision when there is no source-manifest.json', () => {
      writeProduct(project.root, 'knowledge-graph.jsonl', graphJsonl({}));
      expect(productOf(pack(), 'knowledge-graph')).toMatchObject({ status: 'included', note: 'no revision recorded' });
    });

    it('compares the sourceRevision of source-manifest.json with the snapshot', () => {
      writeProduct(project.root, 'knowledge-graph.jsonl', graphJsonl({}));
      writeProduct(project.root, 'source-manifest.json', sourceManifest('git:old'));
      expect(productOf(pack(), 'knowledge-graph')).toMatchObject({ status: 'different-revision', revision: 'git:old' });
    });

    it('names the project after its directory, not the name the graph header recorded', () => {
      writeProduct(project.root, 'knowledge-graph.jsonl', graphJsonl({ name: 'named-in-header' }));
      expect(pack().manifest.project.name).toBe(project.root.split('/').pop());
    });

    it('names the project after its directory when there is no graph', () => {
      expect(pack().manifest.project.name).toBe(project.root.split('/').pop());
    });
  });

  it('reports a report as included or not run, never a revision', () => {
    writeProduct(project.root, 'doc-map-report.md', '# only this one\n');
    const packed = pack();
    const reports = packed.manifest.products.find((p) => p.name === 'reports');
    expect(reports.status).toBe('included');
    expect(reports.items.map((i) => [i.file, i.status])).toEqual([['hotspots-report.md', 'not-run'], ['doc-map-report.md', 'included']]);
    expect(packed.result.products.at(-1).revision).toBeUndefined();
    expect(payloadIds(packed.html)).toEqual(['report-doc-map']);
  });

  it('does not follow a symlinked product', () => {
    const outside = mkdtempSync(join(tmpdir(), 'xv-outside-'));
    try {
      writeFileSync(join(outside, 'unused-code.json'), JSON.stringify(unusedProduct(project.revision)));
      mkdirSync(join(project.root, '.excavator'), { recursive: true });
      symlinkSync(join(outside, 'unused-code.json'), join(project.root, '.excavator', 'unused-code.json'));
      const row = productOf(pack(), 'unused-code');
      expect(row.status).toBe('unreadable');
      expect(row.reason).toMatch(/not a regular file/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('the page', () => {
  function fullProject() {
    writeProduct(project.root, 'knowledge-graph.jsonl', graphJsonl({ nodes: ['file', 'function'], edges: ['calls'] }));
    writeProduct(project.root, 'source-manifest.json', sourceManifest(project.revision));
    writeProduct(project.root, 'unused-code.json', unusedProduct(project.revision));
    writeProduct(project.root, 'doc-map.json', docMapProduct(project.revision));
    writeProduct(project.root, 'hotspots.json', hotspotsProduct(project.revision));
    writeProduct(project.root, 'hotspots-report.md', '# Hotspots\n');
  }

  it('is byte-identical when packed twice from the same inputs', () => {
    fullProject();
    const first = readFileSync(pack().result.out);
    const second = readFileSync(pack().result.out);
    expect(second.equals(first)).toBe(true);
  });

  it('is byte-identical in a plain directory, whose revision comes from its content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xv-plain-'));
    try {
      writeFileSync(join(dir, 'a.txt'), 'hello\n');
      const first = packProject(dir, { template: templatePath });
      const firstBytes = readFileSync(first.out);
      const second = packProject(dir, { template: templatePath });
      expect(second.snapshotRevision).toBe(first.snapshotRevision);
      expect(readFileSync(second.out).equals(firstBytes)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has a zero mtime in every gzip header and no pack time anywhere', () => {
    fullProject();
    const { html } = pack();
    for (const id of payloadIds(html)) {
      const zipped = payloadGzip(html, id);
      expect(zipped.readUInt32LE(4), id).toBe(0);
    }
    expect(html).not.toMatch(/generatedAt|packedAt|"timestamp"/);
  });

  it('carries the Content-Security-Policy exactly, before any script or style', () => {
    fullProject();
    const { html } = pack();
    expect(CONTENT_SECURITY_POLICY).toBe(EXACT_CSP);
    const metas = html.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/g);
    expect(metas).toEqual([`<meta http-equiv="Content-Security-Policy" content="${EXACT_CSP}">`]);
    expect(html.indexOf(metas[0])).toBeLessThan(html.indexOf('<style'));
    expect(html.indexOf(metas[0])).toBeLessThan(html.indexOf('<script'));
    expect(html).toContain('<meta name="color-scheme" content="light">');
  });

  it('lets a worker run from a blob: URL and nothing else beyond the page itself', () => {
    expect(CONTENT_SECURITY_POLICY).toContain('worker-src blob:');
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-eval|child-src|frame-src/);
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
  });

  it('loads nothing: no link, no external script, no marker left behind', () => {
    fullProject();
    const { html } = pack();
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(html).not.toMatch(/<(img|iframe|object|embed|video|audio|source)\b/i);
    expect(html).not.toContain('xv:csp');
    expect(html).not.toContain('xv:data');
  });

  it('changes nothing of the template but its two markers, whatever the template holds', () => {
    fullProject();
    const { html } = pack();
    const [head, rest] = FIXTURE_TEMPLATE.split('<!-- xv:csp -->');
    const [middle, tail] = rest.split('<!-- xv:data -->');
    const csp = `<meta http-equiv="Content-Security-Policy" content="${EXACT_CSP}">`;
    expect(html.startsWith(head + csp + middle)).toBe(true);
    expect(html.endsWith(tail)).toBe(true);
    // The template's own text keeps its replacement-pattern characters as written.
    expect(html).toContain('window.__fixture = "$& $1 $`";');
    expect(html).not.toContain('xv:csp');
    expect(html).not.toContain('xv:data');
  });

  it('cannot be ended early by a product string that holds closing tags', () => {
    const hostile = ['</script><script>alert(1)</script>', '<img src=x onerror=x>', '</SCRIPT >', '<!-- <script>'];
    writeProduct(project.root, 'knowledge-graph.jsonl', graphJsonl({ name: hostile[0], nodes: [hostile[1]], edges: [hostile[2]], gaps: [{ kind: hostile[3], scope: hostile[0], reason: hostile[1], count: 1 }] }));
    writeProduct(project.root, 'source-manifest.json', sourceManifest(project.revision));
    writeProduct(project.root, 'unused-code.json', unusedProduct(project.revision, {
      unused: [{ id: 'u', name: hostile[0], language: hostile[1], file: hostile[2], lineRange: [1, 1], reason: hostile[3], confidence: 'high' }],
    }));
    writeProduct(project.root, 'hotspots.json', hotspotsProduct(`git:${hostile[0]}`));
    writeProduct(project.root, 'doc-map.json', { ...docMapProduct(hostile[0]), units: [{ document: hostile[1], id: 'x', title: hostile[0], quote: hostile[3], line: 1, page: null, code: null }] });
    writeProduct(project.root, 'hotspots-report.md', `# ${hostile[0]}\n\n${hostile[1]}\n`);
    const { html, manifest } = pack();

    const opened = html.match(/<script\b/gi).length;
    const closed = html.match(/<\/script>/gi).length;
    const payloadCount = payloadIds(html).length;
    const templateScripts = FIXTURE_TEMPLATE.match(/<script\b/g).length;
    expect(opened).toBe(templateScripts + 1 + payloadCount);
    expect(closed).toBe(opened);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('</SCRIPT');
    expect(JSON.parse(payloadText(html, 'knowledge-graph').split('\n')[0]).fields.project.name).toBe(hostile[0]);
    expect(manifest.products.find((p) => p.name === 'hotspots').revision).toBe(`git:${hostile[0]}`);
    expect(payloadText(html, 'unused-code')).toContain(hostile[0].replace(/</g, '<'));
    expect(JSON.parse(payloadText(html, 'unused-code')).unused[0].name).toBe(hostile[0]);
  });

  it('keeps non-ASCII text intact through the payload', () => {
    const text = String.fromCharCode(0x4e2d, 0x6587, 0x20, 0xe9, 0x20, 0xd83d, 0xde00);
    writeProduct(project.root, 'hotspots-report.md', `# ${text}\n`);
    expect(payloadText(pack().html, 'report-hotspots')).toBe(`# ${text}\n`);
  });

  it('writes nothing under .excavator except the page', () => {
    fullProject();
    const before = readdirSync(join(project.root, '.excavator')).sort();
    pack();
    expect(readdirSync(join(project.root, '.excavator')).sort()).toEqual([...before, 'view.html'].sort());
  });

  it('writes to --out and records that no source was embedded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xv-out-'));
    try {
      const out = join(dir, 'nested', 'page.html');
      const result = packProject(project.root, { out, noSource: true, template: templatePath });
      expect(result.out).toBe(out);
      expect(existsSync(out)).toBe(true);
      expect(existsSync(join(project.root, '.excavator', 'view.html'))).toBe(false);
      const none = { embedded: 0, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 0 };
      expect(result.source).toEqual({ embedded: false, requested: false, limitBytes: 1048576, counts: none });
      expect(manifestOf(readFileSync(out, 'utf-8')).source).toEqual({ ...result.source, files: {} });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('assemblePage and the view template', () => {
  const input = (path) => ({ templatePath: path, manifest: { a: 1 }, payloads: [] });
  const withTemplate = (text, run) => {
    const dir = mkdtempSync(join(tmpdir(), 'xv-tpl-'));
    try {
      const path = join(dir, 'view.html');
      writeFileSync(path, text);
      return run(path);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  it('fills the two markers of a template that has them once', () => {
    withTemplate(FIXTURE_TEMPLATE, (path) => {
      const html = assemblePage(input(path)).toString('utf-8');
      expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
      expect(html).toContain('id="xv-manifest">{"a":1}</script>');
    });
  });

  it('refuses a template that does not exist and says to run pnpm build', () => {
    expect(() => assemblePage(input(join(tmpdir(), 'xv-no-such-template', 'view.html')))).toThrow(/does not exist: run `pnpm build`/);
  });

  it.each([
    ['a missing data marker', FIXTURE_TEMPLATE.replace('<!-- xv:data -->', ''), /xv:data/],
    ['a missing csp marker', FIXTURE_TEMPLATE.replace('<!-- xv:csp -->', ''), /xv:csp/],
    ['a second data marker', FIXTURE_TEMPLATE.replace('</body>', '<!-- xv:data --></body>'), /xv:data/],
    ['a second csp marker', FIXTURE_TEMPLATE.replace('<title>', '<!-- xv:csp --><title>'), /xv:csp/],
  ])('refuses %s', (_name, text, pattern) => {
    withTemplate(text, (path) => {
      expect(() => assemblePage(input(path))).toThrow(pattern);
      expect(() => assemblePage(input(path))).toThrow(/pnpm build/);
    });
  });

  it('writes every < of the manifest as an escape', () => {
    const text = jsonForScript({ k: '</script><b>' });
    expect(text).not.toContain('<');
    expect(JSON.parse(text)).toEqual({ k: '</script><b>' });
  });

  it('reports a missing template through the command line, with a non-zero exit, and writes nothing', () => {
    const unbuilt = makePluginRoot(null);
    try {
      const out = join(project.root, '.excavator', 'view.html');
      const run = spawnSync(process.execPath, [join(unbuilt, 'skills/excavator-view/pack.mjs'), project.root], { encoding: 'utf-8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/excavator-view pack failed: the view template .* does not exist: run `pnpm build`/);
      expect(run.stdout).toBe('');
      expect(existsSync(out)).toBe(false);
      expect(existsSync(join(project.root, '.excavator'))).toBe(false);
    } finally { rmSync(unbuilt, { recursive: true, force: true }); }
  });

  it('leaves an existing page as it was when the template is missing', () => {
    const unbuilt = makePluginRoot(null);
    const dir = mkdtempSync(join(tmpdir(), 'xv-keep-'));
    try {
      const out = join(dir, 'view.html');
      writeFileSync(out, '<html>old page</html>');
      const run = spawnSync(process.execPath, [join(unbuilt, 'skills/excavator-view/pack.mjs'), project.root, '--out', out], { encoding: 'utf-8' });
      expect(run.status).toBe(1);
      expect(readFileSync(out, 'utf-8')).toBe('<html>old page</html>');
      expect(readdirSync(dir)).toEqual(['view.html']);
    } finally {
      rmSync(unbuilt, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('writing the page', () => {
  const OLD = '<html>old page</html>';

  it('keeps an existing page when the new one cannot be written', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;
    const dir = mkdtempSync(join(tmpdir(), 'xv-ro-'));
    try {
      const out = join(dir, 'view.html');
      writeFileSync(out, OLD);
      chmodSync(dir, 0o555);
      expect(() => packProject(project.root, { out, template: templatePath })).toThrow();
      chmodSync(dir, 0o755);
      expect(readFileSync(out, 'utf-8')).toBe(OLD);
      expect(readdirSync(dir)).toEqual(['view.html']);
    } finally {
      chmodSync(dir, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves no temporary file when the final rename fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xv-rename-'));
    try {
      const out = join(dir, 'view.html');
      mkdirSync(join(out, 'inside'), { recursive: true });
      expect(() => packProject(project.root, { out, template: templatePath })).toThrow();
      expect(readdirSync(dir)).toEqual(['view.html']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits non-zero with a message and keeps the old page when the command fails', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;
    const dir = mkdtempSync(join(tmpdir(), 'xv-cli-'));
    try {
      const out = join(dir, 'view.html');
      writeFileSync(out, OLD);
      chmodSync(dir, 0o555);
      const run = spawnSync(process.execPath, [packScript, project.root, '--out', out], { encoding: 'utf-8' });
      chmodSync(dir, 0o755);
      expect(run.status).not.toBe(0);
      expect(run.stderr).toMatch(/excavator-view pack failed: /);
      expect(run.stdout).toBe('');
      expect(readFileSync(out, 'utf-8')).toBe(OLD);
    } finally {
      chmodSync(dir, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the command line', () => {
  it('prints exactly one JSON result on stdout', () => {
    writeProduct(project.root, 'hotspots.json', hotspotsProduct(project.revision));
    const run = spawnSync(process.execPath, [packScript, project.root], { encoding: 'utf-8' });
    expect(run.status, run.stderr).toBe(0);
    const lines = run.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    const result = JSON.parse(lines[0]);
    expect(Object.keys(result)).toEqual(['out', 'bytes', 'snapshotRevision', 'products', 'source']);
    expect(result.bytes).toBe(readFileSync(result.out).length);
    expect(result.products.find((p) => p.name === 'hotspots')).toEqual({ name: 'hotspots', status: 'included', revision: project.revision });
    expect(result.products.find((p) => p.name === 'unused-code')).toEqual({ name: 'unused-code', status: 'not-run' });
  });

  it.each([
    [[], /Usage/],
    [['--bogus', 'x'], /unknown option/],
    [['a', 'b'], /unexpected argument/],
  ])('refuses the arguments %j', (args, pattern) => {
    const run = spawnSync(process.execPath, [packScript, ...args], { encoding: 'utf-8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(pattern);
  });

  it('fails with a message on a repository with no commits and writes no page', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xv-unborn-'));
    try {
      spawnSync('git', ['init', '-q'], { cwd: dir });
      const run = spawnSync(process.execPath, [packScript, dir], { encoding: 'utf-8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/no commits/);
      expect(existsSync(join(dir, '.excavator', 'view.html'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a project whose .excavator is a symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xv-link-'));
    const elsewhere = mkdtempSync(join(tmpdir(), 'xv-elsewhere-'));
    try {
      writeFileSync(join(dir, 'a.txt'), 'x\n');
      symlinkSync(elsewhere, join(dir, '.excavator'));
      const run = spawnSync(process.execPath, [packScript, dir], { encoding: 'utf-8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/\.excavator must be a real directory/);
      expect(readdirSync(elsewhere)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
