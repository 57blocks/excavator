// artifact-view tasks 4.1-4.3: the page's pure derivations (routing, colors,
// coverage conservation, selection funnel, gap grouping, overview badges),
// tested in Node against the committed dev fixture and hand-built records.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeBundle } from '../../skills/excavator-view/bundle-codec.mjs';
import { toViewData } from '../../packages/view/src/data.ts';
import { parseHash, sectionHash, nodeHash } from '../../packages/view/src/routes.ts';
import { languageColors, languageOrder, OTHER_COLOR } from '../../packages/view/src/model/colors.ts';
import {
  conservationText, coverageRows, excludedEntries, groupGaps, selectionFunnel,
} from '../../packages/view/src/model/coverage.ts';
import {
  LANGUAGE_RING_CENTER, MEMBER_FILES_LABEL, MEMBER_SELECTED_LABEL, countRows, freshnessBanner, indexLiteralsStatus, inventoryRows,
  memberCards, semanticBadges,
} from '../../packages/view/src/model/overview.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sample = readFileSync(join(repoRoot, 'packages/view/fixtures/sample.bundle.txt'), 'utf-8');

async function sampleData() {
  return toViewData((await decodeBundle(sample)).segments, 'main');
}

describe('routes (4.1)', () => {
  it('parses every section, node ids and unknown hashes', () => {
    expect(parseHash('')).toMatchObject({ kind: 'section', section: 'overview' });
    expect(parseHash('#/')).toMatchObject({ kind: 'section', section: 'overview' });
    for (const s of ['overview', 'structure', 'graph', 'coverage', 'search', 'semantics']) {
      expect(parseHash(`#/${s}`)).toMatchObject({ kind: 'section', section: s });
    }
    const id = 'function:src/a b.ts:run#1';
    expect(parseHash(nodeHash(id))).toEqual({ kind: 'node', id });
    expect(parseHash('#/nowhere')).toEqual({ kind: 'unknown', hash: '#/nowhere' });
    expect(parseHash('#/node/%E0%A4%A')).toMatchObject({ kind: 'unknown' });
  });

  it('round-trips section query parameters', () => {
    const hash = sectionHash('coverage', { scope: 'type script' });
    const route = parseHash(hash);
    expect(route.kind).toBe('section');
    expect(route.params.get('scope')).toBe('type script');
    expect(sectionHash('coverage', { scope: null })).toBe('#/coverage');
  });
});

describe('language colors (4.2/4.3)', () => {
  it('orders languages by files then name and folds past the last slot into other', () => {
    const byLanguage = {};
    for (let i = 0; i < 10; i += 1) byLanguage[`lang${i}`] = { files: 10 - i };
    byLanguage.alpha = { files: 10 };
    const order = languageOrder({ byLanguage });
    expect(order.slice(0, 2)).toEqual(['alpha', 'lang0']);
    const colors = languageColors(order);
    expect(colors.get('alpha')).toBe('var(--series-1)');
    expect(colors.get(order[7])).toBe('var(--series-8)');
    expect(colors.get(order[8])).toBe(OTHER_COLOR);
    expect(new Set(order.slice(0, 8).map((l) => colors.get(l))).size).toBe(8);
  });
});

describe('coverage conservation (4.3)', () => {
  it('balances every language of the sample fixture', async () => {
    const { coverage } = await sampleData();
    const { rows } = coverageRows(coverage);
    expect(rows.map((r) => r.language)).toEqual(['typescript', 'json', 'markdown']);
    expect(rows.every((r) => r.balanced)).toBe(true);
    expect(conservationText(rows[0])).toBe('3 = 3 + 0');
  });

  it('flags an unbalanced language with an inequality (instrument check)', () => {
    const { rows, skipReasons } = coverageRows({
      byLanguage: {
        java: { files: 5, parsed: 3, zeroSymbol: 0, skipped: { 'too-large': 1 } },
        go: { files: 4, parsed: 2, zeroSymbol: 1, skipped: { 'no-extractor': 1 } },
        odd: { files: 2, parsed: 'two', zeroSymbol: 0, skipped: {} },
      },
    });
    const byName = Object.fromEntries(rows.map((r) => [r.language, r]));
    expect(byName.java.balanced).toBe(false);
    expect(conservationText(byName.java)).toBe('5 ≠ 3 + 0 + 1');
    expect(byName.go.balanced).toBe(true);
    expect(conservationText(byName.go)).toBe('4 = 2 + 1 + 1');
    expect(byName.odd.balanced).toBe(false);
    expect(conservationText(byName.odd)).toBe('2 ≠ ? + 0');
    expect(skipReasons.sort()).toEqual(['no-extractor', 'too-large']);
  });

  it('has no rows (not a fake balanced table) when the graph has no coverage record', () => {
    expect(coverageRows(null).rows).toEqual([]);
  });
});

describe('selection funnel and entries (4.3)', () => {
  it('reads the funnel from the bake meta', async () => {
    const { meta } = await sampleData();
    const funnel = selectionFunnel(meta.selection);
    expect(funnel.recorded).toBe(true);
    expect(funnel.candidates).toBe(5);
    expect(funnel.branches.map((b) => [b.key, b.value])).toEqual([
      ['selected', 5], ['filteredByDefaults', 0], ['filteredByIgnore', 0], ['sensitive', 0],
    ]);
    expect(selectionFunnel(null).recorded).toBe(false);
  });

  it('lists only non-selected entries', () => {
    const entries = excludedEntries({ entries: [{ path: 'a', kind: 'selected' }, { path: 'b', kind: 'sensitive' }] });
    expect(entries).toEqual([{ path: 'b', kind: 'sensitive' }]);
  });
});

describe('gap grouping (4.3)', () => {
  const gaps = [
    { kind: 'calls-unresolved', scope: 'java', count: 3, reason: 'r1', samples: ['a'] },
    { kind: 'methods-name-only', scope: 'go', count: 2, reason: 'r2', samples: [] },
    { kind: 'calls-unresolved', scope: 'go', count: 4, reason: 'r1', samples: ['b'] },
    { kind: 'no-scope', reason: 'r3' },
  ];

  it('groups by kind in first-seen order with totals', () => {
    const { scopes, groups } = groupGaps(gaps, null);
    expect(scopes).toEqual(['(no scope)', 'go', 'java']);
    expect(groups.map((g) => [g.kind, g.records.length, g.total])).toEqual([
      ['calls-unresolved', 2, 7], ['methods-name-only', 1, 2], ['no-scope', 1, 0],
    ]);
  });

  it('filters by scope', () => {
    const { groups } = groupGaps(gaps, 'go');
    expect(groups.map((g) => [g.kind, g.total])).toEqual([['methods-name-only', 2], ['calls-unresolved', 4]]);
  });
});

describe('overview (4.2)', () => {
  it('pairs header and decoded counts', async () => {
    const data = await sampleData();
    const rows = countRows(data.meta, data.counts);
    expect(rows.map((r) => [r.key, r.header, r.decoded, r.match])).toEqual([
      ['nodes', 9, 9, true], ['edges', 11, 11, true], ['gaps', 2, 2, true], ['evidence', 11, 11, true],
    ]);
    const broken = countRows(data.meta, { ...data.counts, nodes: 8 });
    expect(broken[0].match).toBe(false);
  });

  it('shows "Not generated" with its command for all three semantic products of a Lazy-only bundle', async () => {
    const { meta } = await sampleData();
    const badges = semanticBadges(meta);
    expect(badges.map((b) => [b.artifact, b.state])).toEqual([
      ['semantic-cache.json', 'not-generated'], ['semantic-graph.json', 'not-generated'], ['domain-graph.json', 'not-generated'],
    ]);
    expect(badges[0].command).toMatch(/\/excavator --mode=full/);
    expect(badges[1].command).toMatch(/\/excavator --mode=full/);
    expect(badges[2].command).toMatch(/\/excavator-domain/);
  });

  it('maps present, stale and invalid semantic products', () => {
    const meta = {
      inventory: [
        { name: 'semantic-cache.json', required: false, status: 'present' },
        { name: 'semantic-graph.json', required: false, status: 'present' },
        { name: 'domain-graph.json', required: false, status: 'invalid', reason: 'not valid JSON' },
      ],
      freshness: {
        semanticCache: { entries: 4, nodesInGraph: 9, fresh: 3, stale: 1, missing: 0, 'noncanonical-language': 0, notInGraph: 0 },
        semanticGraph: { freshness: 'fresh', layers: 2 },
      },
    };
    expect(semanticBadges(meta).map((b) => b.state)).toEqual(['stale', 'present', 'invalid']);
    expect(semanticBadges(meta)[0].detail).toMatch(/4 summaries for 9 nodes/);
    expect(semanticBadges(meta)[2].detail).toBe('not valid JSON');
  });

  it('renders each fact-layer freshness state', async () => {
    const { meta } = await sampleData();
    expect(freshnessBanner(meta).state).toBe('fresh');
    const stale = freshnessBanner({ freshness: { factLayer: { status: 'stale', reason: 'changed' } } });
    expect(stale.state).toBe('stale');
    expect(stale.command).toMatch(/run \/excavator/);
    expect(freshnessBanner({ freshness: { factLayer: { status: 'missing' } } }).state).toBe('missing');
    expect(freshnessBanner({ freshness: { factLayer: { status: 'weird' } } }).title).toMatch(/weird/);
    expect(freshnessBanner({}).state).toBe('unknown');
  });

  it('lists every inventory item with its state and note', async () => {
    const { meta } = await sampleData();
    const rows = inventoryRows(meta);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.name === 'domain-graph.json')).toMatchObject({ state: 'missing', note: expect.stringMatching(/excavator-domain/) });
    expect(inventoryRows({ inventory: [{ name: 'x', required: true, status: 'missing', missing: 'run' }] })[0].state).toBe('missing-required');
  });
});

describe('slice A acceptance fixes (4A.1, 4A.3)', () => {
  it('labels member cards with manifest files and shows the selected count beside it, from their own sources', () => {
    const meta = { members: [{ name: 'alpha', files: 12, selected: 13 }, { name: 'beta', files: 4, selected: null }, { name: 'gamma', files: 2 }] };
    const cards = memberCards(meta);
    expect(MEMBER_FILES_LABEL).toBe('files in manifest');
    expect(MEMBER_SELECTED_LABEL).toBe('selected');
    // The two numbers are reported as recorded, never reconciled.
    expect(cards).toEqual([
      { name: 'alpha', manifestFiles: 12, selectedFiles: 13 },
      { name: 'beta', manifestFiles: 4, selectedFiles: null },
      { name: 'gamma', manifestFiles: 2, selectedFiles: null },
    ]);
    expect(memberCards({})).toEqual([]);
  });

  it('names the ring center "candidate files"', () => {
    expect(LANGUAGE_RING_CENTER).toBe('candidate files');
  });

  it('reports the index literal state, including "literals trimmed" over budget', async () => {
    const { meta } = await sampleData();
    expect(indexLiteralsStatus(meta)).toEqual({ state: 'embedded', label: 'literals embedded' });
    const index = { literals: 'trimmed' };
    const trimmed = {
      index, embeds: [{ segment: 'indexLiterals', status: 'dropped', reason: 'budget' }],
    };
    expect(indexLiteralsStatus(trimmed)).toEqual({ state: 'trimmed', label: 'literals trimmed' });
    const omitted = { index: { literals: 'omitted' }, embeds: [{ segment: 'indexLiterals', status: 'dropped', reason: 'no-source' }] };
    expect(indexLiteralsStatus(omitted)).toEqual({ state: 'omitted', label: 'literals not embedded (baked with --no-source)' });
    expect(indexLiteralsStatus({ index: null })).toEqual({ state: 'unavailable', label: 'no source index' });
    expect(indexLiteralsStatus({ index: { literals: 'weird' } })).toEqual({ state: 'weird', label: 'literals: weird' });
  });
});
