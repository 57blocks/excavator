import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostname, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { mergeBatches, prepareBatch, prepareReconciliation, publishReconciliation, reconciliationStatus, saveBatch } from '../../skills/excavator-flow-reconcile/reconcile.mjs';
import { MAX_BATCH_FILES, planBatches } from '../../skills/excavator-flow-reconcile/batch-plan.mjs';

const view = 'settings.xhtml';
const handler = 'Settings.java';
const cli = fileURLToPath(new URL('../../skills/excavator-flow-reconcile/reconcile.mjs', import.meta.url));
const entry = (line, quote) => ({ path: view, line, quote });
const rule = (description) => ({
  kind: 'backend-rule',
  text: description,
  evidence: [{ path: handler, line: 2, quote: 'if (active) return false;' }],
});

describe('whole-project flow reconciliation', () => {
  it('assigns each path to a single stable, bounded module batch', () => {
    const files = ['README.md', 'api/routes/settings.js', 'workers/main.js',
      ...Array.from({ length: MAX_BATCH_FILES * 2 + 1 }, (_, i) => `web/templates/view-${i}.xhtml`)];
    const batches = planBatches(files);
    expect(planBatches([...files].reverse())).toEqual(batches);
    expect(batches.flatMap((batch) => batch.files).sort()).toEqual([...files].sort());
    expect(batches.map((batch) => batch.module)).toEqual(['.', 'api', 'web/templates', 'web/templates', 'web/templates', 'workers']);
    expect(batches.every(({ files }) => files.length <= MAX_BATCH_FILES)).toBe(true);
  });

  it('resumes local partial work, rejects stale, forged and foreign candidates, then merges once', async () => {
    const project = mkdtempSync(join(tmpdir(), 'flow-batch-'));
    const api = 'api/Settings.java';
    const form = 'web/archive.xhtml';
    const details = 'web/details.xhtml';
    const obsolete = 'web/old.xhtml';
    const entry = { path: form, line: 1, quote: '<form id="archive">' };
    const claim = { kind: 'backend-rule', text: 'Rejects archive while active.',
      evidence: [{ path: api, line: 1, quote: 'if(active)return false;' }] };
    const archive = { id: 'archive-legacy', title: 'Archive settings', entry, claims: [claim] };
    const create = { ...archive, title: 'Create settings', id: `entry:${encodeURIComponent(form)}#create`,
      entry: { ...entry, line: 2, quote: '<form id="create">' } };
    const draftOnly = { ...create, id: `entry:${encodeURIComponent(form)}#reopen`, title: 'Reopen settings' };
    const openGap = { path: form, reason: 'The purpose of the create action has not been checked.' };
    const draft = ({ run, batch, basis, checkpointDigest }) => ({
      run, batch, basis, checkpointDigest, flows: [], reviewedPaths: [], gaps: [], removed: [], deferred: [],
    });
    const call = (command, ...args) => JSON.parse(execFileSync(process.execPath, [cli, '--', command, project, ...args]));
    try {
      mkdirSync(join(project, 'api'));
      mkdirSync(join(project, 'web'));
      writeFileSync(join(project, api), 'class Settings { boolean archive(boolean active) {if(active)return false; return true;} }\n');
      writeFileSync(join(project, form), '<form id="archive"></form>\n<form id="create"></form>\n');
      writeFileSync(join(project, obsolete), '<form id="old"></form>\n');
      writeFileSync(join(project, details), '<div id="details"></div>\n');
      await runLazyAnalysis({ projectRoot: project, argv: [] });
      const facts = join(project, '.excavator', 'knowledge-graph.jsonl');
      const former = { ...archive, id: 'old', entry: { path: obsolete, line: 1, quote: 'id="old"' } };
      const previous = publishReconciliation(project, {
        basis: prepareReconciliation(project).basis, reviewedPaths: [form, obsolete],
        flows: [{ ...archive, claims: [{ ...claim, text: 'Active settings can be archived.' }] }, former], gaps: [], removed: [],
      });
      const original = readFileSync(previous.path);
      rmSync(join(project, obsolete));
      await runLazyAnalysis({ projectRoot: project, argv: [] });
      const plan = reconciliationStatus(project);
      const apiBatch = plan.batches.find(({ module }) => module === 'api').id;
      const webBatch = plan.batches.find(({ module }) => module === 'web').id;
      const first = { ...draft(prepareBatch(project, webBatch)), reviewedPaths: [form], flows: [archive, create, draftOnly], gaps: [openGap] };
      expect(() => saveBatch(project, webBatch, { ...first, flows: [{ ...archive, entry: { ...entry, quote: '<form id="forged">' } }] }))
        .toThrow(/Evidence quote does not match/);
      expect(() => saveBatch(project, webBatch, { ...first, reviewedPaths: [form, api] })).toThrow(/outside the scope/);
      expect(() => saveBatch(project, webBatch, { ...first, flows: [archive, { ...create, id: 'create' }] }))
        .toThrow(/New batch flow ids/);
      expect(call('status').batches.find(({ id }) => id === webBatch)).toMatchObject({ pending: 2, reviewed: 0 });
      expect(saveBatch(project, webBatch, first)).toMatchObject({ pending: 1, reviewed: 1 });
      expect(() => mergeBatches(project)).toThrow(/Finish pending/);
      expect(readFileSync(previous.path)).toEqual(original);
      expect(() => saveBatch(project, webBatch, first)).toThrow(/Checkpoint changed/);

      await runLazyAnalysis({ projectRoot: project, argv: [] });
      const expectedFacts = readFileSync(facts);
      const resumed = call('prepare-batch', webBatch);
      expect(resumed.run).toBe(plan.run);
      expect(resumed.checkpoint).toEqual(first);
      const partial = { ...first, checkpointDigest: resumed.checkpointDigest };
      const deferred = { path: details, reason: 'A fixture provider needed to resolve the view is unavailable.' };
      expect(() => saveBatch(project, webBatch, { ...partial, reviewedPaths: [], flows: [], deferred: [deferred] }))
        .toThrow(/previously reviewed/);
      expect(() => saveBatch(project, webBatch, { ...partial, flows: [archive, create], deferred: [deferred] }))
        .toThrow(/Missing disposition for saved finding.*flow/);
      expect(() => saveBatch(project, webBatch, { ...partial, gaps: [], deferred: [deferred] }))
        .toThrow(/Missing disposition for saved finding.*gap/);
      const revisions = [
        { kind: 'flow', id: draftOnly.id, reason: 'This is the existing create action with a different label.' },
        { kind: 'gap', path: form, previousReason: openGap.reason, reason: 'The create action is now identified.' },
      ];
      expect(saveBatch(project, webBatch, { ...partial, flows: [archive, create], gaps: [], revisions, deferred: [deferred] }))
        .toMatchObject({ pending: 0, deferred: 1 });
      expect(saveBatch(project, apiBatch, { ...draft(prepareBatch(project, apiBatch)), reviewedPaths: [api] })).toMatchObject({ pending: 0 });
      expect(call('merge')).toMatchObject({ reviewed: 2, unchecked: 1, flows: 2, removed: 1, gaps: 1 });
      const result = JSON.parse(readFileSync(previous.path));
      expect(result).toMatchObject({ flows: [archive, create], reviewedPaths: [api, form], uncheckedPaths: [details],
        gaps: [deferred], removed: [{ id: 'old', reason: 'The former entry path is no longer in the Lazy selection.' }],
        batchRun: { revisions: revisions.map((item) => ({ ...item, batch: webBatch })) } });
      expect(call('status')).toMatchObject({ state: 'merged', run: plan.run, reviewed: 2, deferred: 1 });
      expect(call('merge')).toMatchObject({ state: 'merged', run: plan.run });
      expect(readFileSync(facts)).toEqual(expectedFacts);
      const refresh = call('refresh');
      expect(refresh).toMatchObject({ state: 'in-progress' });
      expect(refresh.run).not.toBe(plan.run);
      expect(call('refresh').run).toBe(refresh.run);
      expect(call('prepare-batch', webBatch)).toMatchObject({ checkpoint: null, previousFlows: [archive, create] });
      expect(JSON.parse(readFileSync(previous.path))).toEqual(result);

      writeFileSync(join(project, details), '<div id="changed"></div>\n');
      mkdirSync(join(project, 'frontend'));
      const movedPath = 'frontend/archive.xhtml';
      renameSync(join(project, form), join(project, movedPath));
      await runLazyAnalysis({ projectRoot: project, argv: [] });
      const relocated = reconciliationStatus(project);
      expect(relocated).toMatchObject({ state: 'in-progress' });
      expect(relocated.run).not.toBe(refresh.run);
      const frontend = relocated.batches.find(({ module }) => module === 'frontend').id;
      expect(prepareBatch(project, frontend)).toMatchObject({ checkpoint: null, previousFlows: [] });
      expect(() => saveBatch(project, frontend, partial)).toThrow(/baseline changed/);
      const newArchive = {
        ...archive, id: `entry:${encodeURIComponent(movedPath)}#archive`, entry: { ...entry, path: movedPath },
      };
      for (const { id } of relocated.batches) {
        const batch = prepareBatch(project, id);
        saveBatch(project, id, { ...draft(batch), reviewedPaths: batch.files, flows: id === frontend ? [newArchive] : [] });
      }
      const moves = [{ fromId: archive.id, toId: newArchive.id }];
      expect(() => mergeBatches(project, {}, { run: relocated.run, moves: [{ ...moves[0], toId: 'unknown' }] }))
        .toThrow(/Relocation requires/);
      expect(mergeBatches(project, {}, { run: relocated.run, moves })).toMatchObject({ flows: 1, reviewed: 3, removed: 1 });
      expect(JSON.parse(readFileSync(previous.path))).toMatchObject({
        flows: [{ ...newArchive, id: archive.id }], batchRun: { relocations: moves },
      });
      expect(mergeBatches(project, {}, { run: relocated.run, moves })).toMatchObject({ state: 'merged' });
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }, 20000);
});

describe('flow reconciliation publication', () => {
  let root;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'flow-reconcile-'));
    writeFileSync(join(root, view), [
      '<html xmlns:h="http://java.sun.com/jsf/html">',
      '<h:form id="save"><h:commandButton action="#{settings.save}" /></h:form>',
      '<h:form id="archive"><h:commandButton action="#{settings.archive}" /></h:form>',
      '</html>',
    ].join('\n'));
    writeFileSync(join(root, handler), 'class Settings { boolean archive(boolean active) {\n if (active) return false;\n return true;\n} }\n');
    const result = await runLazyAnalysis({ projectRoot: root, argv: [] });
    expect(result.validation.ok).toBe(true);
  }, 20000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('updates an incorrect flow and adds a missing form without mutating facts', () => {
    const base = prepareReconciliation(root, view);
    const factsPath = join(root, '.excavator', 'knowledge-graph.jsonl');
    const factBytes = readFileSync(factsPath);
    const wrong = {
      id: 'archive', title: 'Archive settings', entry: entry(3, 'id="archive"'),
      claims: [rule('Active settings may be archived.')],
    };
    const draft = {
      basis: base.basis, reviewedPaths: [view], flows: [wrong], gaps: [], removed: [],
    };
    const first = publishReconciliation(root, draft);
    const secondBasis = prepareReconciliation(root, view);
    expect(secondBasis.previous.flows).toEqual([wrong]);
    const corrected = { ...wrong, claims: [rule('Rejects archiving active settings.')] };
    const added = {
      id: 'save', title: 'Save settings', entry: entry(2, 'id="save"'),
      claims: [{ kind: 'step', text: 'Calls settings.save.', evidence: [entry(2, 'action="#{settings.save}"')] }],
    };
    const repairedDraft = { ...draft, basis: secondBasis.basis, flows: [corrected, added] };

    expect(() => publishReconciliation(root, { ...repairedDraft, flows: [added] })).toThrow(/Missing disposition/);
    const forged = structuredClone(repairedDraft);
    forged.flows[0].claims[0].evidence[0].quote = 'if (active) return true;';
    expect(() => publishReconciliation(root, forged)).toThrow(/Evidence quote does not match/);
    expect(JSON.parse(readFileSync(first.path)).flows).toEqual([wrong]);

    const host = createHash('sha256').update(hostname()).digest('hex').slice(0, 16);
    const liveLock = `${first.path}.lock-${host}-${process.pid}-${randomUUID()}`;
    const abandonedLock = `${first.path}.lock-${host}-2147483647-${randomUUID()}`;
    writeFileSync(liveLock, '');
    expect(() => publishReconciliation(root, repairedDraft)).toThrow(/Another flow reconciliation/);
    rmSync(liveLock);
    writeFileSync(abandonedLock, '');
    expect(publishReconciliation(root, repairedDraft)).toMatchObject({ flows: 2, reviewed: 1, unchecked: 0 });
    expect(existsSync(abandonedLock)).toBe(false);
    expect(JSON.parse(readFileSync(first.path)).flows).toEqual([corrected, added]);
    expect(() => publishReconciliation(root, draft)).toThrow(/baseline changed/);
    expect(readFileSync(factsPath)).toEqual(factBytes);
  });

  it('accounts for unchecked files and rejects a moved or mixed source snapshot', async () => {
    const whole = prepareReconciliation(root);
    const draft = { basis: whole.basis, reviewedPaths: [view], flows: [], gaps: [], removed: [] };
    const result = publishReconciliation(root, draft);
    expect(JSON.parse(readFileSync(result.path)).uncheckedPaths).toEqual([handler]);
    const graphPath = join(root, '.excavator', 'knowledge-graph.jsonl');
    const oldGraph = readFileSync(graphPath);
    writeFileSync(join(root, handler), 'class Settings {}\n');
    expect(() => publishReconciliation(root, draft)).toThrow(/Refresh the Lazy fact graph/);
    await runLazyAnalysis({ projectRoot: root, argv: [] });
    expect(() => prepareReconciliation(root)).not.toThrow();
    writeFileSync(graphPath, oldGraph);
    expect(() => prepareReconciliation(root)).toThrow(/Refresh the Lazy fact graph/);
  });

  it('runs through an installation-style symlink with exact file paths and Lazy exclusions', async () => {
    const project = mkdtempSync(join(tmpdir(), 'flow-selection-'));
    const source = ' view.xhtml';
    const extraExcludePatterns = ['-draft.js', 'skip.js'];
    try {
      writeFileSync(join(project, source), '  <form id="settings"></form>\n');
      writeFileSync(join(project, '-settings.xhtml'), '<form id="another"></form>\n');
      writeFileSync(join(project, 'skip.js'), 'export const skipped = true;\n');
      writeFileSync(join(project, '-draft.js'), 'export const draft = true;\n');
      await runLazyAnalysis({ projectRoot: project, argv: ['--exclude', '-draft.js,skip.js'] });
      expect(() => prepareReconciliation(project, source)).toThrow(/same --exclude/);
      const installed = join(project, '.excavator', 'reconcile-link.mjs');
      symlinkSync(cli, installed);
      const { basis, files } = JSON.parse(execFileSync(process.execPath, [
        installed, '--exclude', '-draft.js,skip.js', '--', 'prepare', project, source,
      ]));
      expect(files).toEqual([source]);
      const dashPath = JSON.parse(execFileSync(process.execPath, [
        installed, '--exclude', '-draft.js,skip.js', '--', 'read', project, '-settings.xhtml',
      ]));
      expect(dashPath[0].text).toBe('<form id="another"></form>');
      const entry = { path: source, line: 1, quote: '  <form id="settings">' };
      const result = publishReconciliation(project, {
        basis, reviewedPaths: [source], gaps: [], removed: [],
        flows: [{ id: 'settings', title: 'Settings', entry, claims: [{ kind: 'step', text: 'Shows the form.', evidence: [entry] }] }],
      }, { extraExcludePatterns });
      expect(JSON.parse(readFileSync(result.path)).flows[0].entry).toEqual(entry);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('keeps selected unreadable files visible even when they are the only scoped input', async () => {
    const project = mkdtempSync(join(tmpdir(), 'flow-skip-'));
    try {
      writeFileSync(join(project, 'actual.ts'), 'export const actual = true;\n');
      symlinkSync('actual.ts', join(project, 'unreadable.ts'));
      const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', project, ...args], { stdio: 'ignore' });
      git('init', '-q');
      git('add', 'actual.ts', 'unreadable.ts');
      git('-c', 'user.name=Tester', '-c', 'user.email=tester@example.test', 'commit', '-qm', 'Fixture');
      await runLazyAnalysis({ projectRoot: project, argv: [] });
      const { basis, files, unavailablePaths } = prepareReconciliation(project, 'unreadable.ts');
      expect(files).toEqual([]);
      expect(unavailablePaths).toEqual(['unreadable.ts']);
      const draft = { basis, reviewedPaths: [], flows: [], gaps: [], removed: [] };
      expect(() => publishReconciliation(project, { ...draft, reviewedPaths: ['unreadable.ts'] })).toThrow(/unavailable or outside/);
      const product = publishReconciliation(project, draft);
      expect(product).toMatchObject({ reviewed: 0, unchecked: 0, unavailable: 1 });

      const graphPath = join(project, '.excavator', 'knowledge-graph.jsonl');
      const oldGraph = readFileSync(graphPath);
      git('-c', 'user.name=Tester', '-c', 'user.email=tester@example.test', 'commit', '--allow-empty', '-qm', 'New revision');
      await runLazyAnalysis({ projectRoot: project, argv: [] });
      const next = prepareReconciliation(project, 'unreadable.ts');
      expect(next.basis.factsDigest).toBe(basis.factsDigest);
      expect(next.basis.sourceRevision).not.toBe(basis.sourceRevision);
      writeFileSync(graphPath, oldGraph);
      expect(() => prepareReconciliation(project, 'unreadable.ts')).toThrow(/Refresh the Lazy fact graph/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('rejects a data-root symlink before a standalone Lazy fallback', () => {
    const project = mkdtempSync(join(tmpdir(), 'flow-boundary-'));
    try {
      const valid = execFileSync(process.execPath, [cli, '--exclude', '--', '--', 'check-root', project]);
      expect(JSON.parse(valid).dataDir).toMatch(/\.excavator$/);
      symlinkSync(tmpdir(), join(project, '.excavator'));
      expect(() => execFileSync(process.execPath, [cli, 'check-root', project], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })).toThrow(/must be a real directory inside the project/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
