import { useMemo, useState } from 'react';

import { useCounts } from '../hooks/use-signals';
import { ProductPage } from '../components/ProductPage';
import { Card } from '../components/ui/Card';
import { CodeLink } from '../components/ui/CodeLink';
import { LocateButton } from '../components/ui/LocateButton';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { ChipGroup, LinkButton, SearchInput, BulletList } from '../components/ui/Controls';
import { type Column, DataTable, SimpleTable } from '../components/ui/DataTable';
import { Tile, Tiles } from '../components/ui/Tile';
import { rangeText } from '../lib/code';
import { formatNumber } from '../lib/format';
import { CONFIDENCES, distinct, filterRows, KEYS, languageOf, normalizeRow, queryHead, REASONS, signalsText, signalsTitle, type UnusedRow } from '../lib/unused';

interface UnusedProduct {
  counts: Record<string, any>;
  conservation: Record<string, any>;
  decisions?: Record<string, any>[];
  unused?: Record<string, unknown>[];
  testOnly?: Record<string, unknown>[];
  residualAssumptions?: unknown[];
}

const CONFIDENCE_TONE: Record<string, BadgeTone> = { high: 'danger', medium: 'warning', low: 'neutral' };

const confidenceBadge = (confidence: string | null) => (confidence === null ? null : <Badge tone={CONFIDENCE_TONE[confidence] ?? 'neutral'}>{confidence}</Badge>);

function locationTitle(row: UnusedRow): string | null {
  if (row.file === null) return null;
  const lines = rangeText(row.lineRange);
  return row.file + (lines ? `:${lines}` : '');
}

const location = (row: UnusedRow) => (row.file === null ? null : <CodeLink path={row.file} range={row.lineRange} />);

function Summary({ product }: { product: UnusedProduct }) {
  const { counts, conservation } = product;
  const byConfidence = counts.byConfidence || {};
  const languages: Record<string, Record<string, number>> = counts.byLanguage || {};
  const tiles: [string, unknown][] = [
    ['Candidates', counts.candidates], ['Removed by decision', counts.removedByDecision], ['Test only', counts.testOnly],
    ['Unused', counts.unused], ['Unreferenced', counts.unreferenced], ['Only reachable from unused', counts.onlyReachableFromUnused],
    ['Groups', counts.groups],
  ];
  return (
    <>
      <Card title="Counts">
        <Tiles>{tiles.map(([label, value]) => <Tile key={label} label={label} value={value} />)}</Tiles>
        <p className="mt-3 font-mono text-[12.5px]">
          {`candidates (${formatNumber(conservation.candidates)}) = removed by decision (${formatNumber(conservation.removedByDecision)}) + test only (${formatNumber(conservation.testOnly)}) + unused (${formatNumber(conservation.unused)}): ${conservation.holds === true ? 'holds' : 'does not hold'}`}
        </p>
      </Card>
      <div className="grid grid-cols-[minmax(240px,320px)_minmax(0,1fr)] items-start gap-5 max-[900px]:grid-cols-1">
        <Card title="Unused by confidence">
          <SimpleTable columns={[{ label: 'Confidence' }, { label: 'Unused', num: true }]} rows={CONFIDENCES.map((c) => [confidenceBadge(c), formatNumber(byConfidence[c])])} />
        </Card>
        <Card title="By language">
          <SimpleTable
            columns={[{ label: 'Language' }, { label: 'Candidates', num: true }, { label: 'Calls', num: true }, { label: 'Unused', num: true }, { label: 'High', num: true }, { label: 'Medium', num: true }, { label: 'Low', num: true }]}
            rows={Object.keys(languages).sort().map((language) => {
              const r = languages[language];
              return [language, formatNumber(r.candidates), formatNumber(r.calls), formatNumber(r.unused), formatNumber(r.high), formatNumber(r.medium), formatNumber(r.low)];
            })}
          />
        </Card>
      </div>
    </>
  );
}

function QueryCell({ query }: { query: unknown }) {
  if (typeof query !== 'string' || query === '') return null;
  const parts = queryHead(query);
  if (!parts.rest) return <code>{query}</code>;
  return (
    <details>
      <summary className="max-w-[300px] cursor-pointer truncate font-mono text-[12.5px] text-ink-soft">{parts.head}</summary>
      <code className="mt-1.5 block whitespace-pre-wrap [overflow-wrap:anywhere]">{query}</code>
    </details>
  );
}

function Decisions({ decisions }: { decisions: Record<string, any>[] }) {
  return (
    <Card title="Decisions">
      {decisions.length === 0 ? (
        <p className="text-muted">The product records no decisions.</p>
      ) : (
        <SimpleTable
          columns={[{ label: 'Kind' }, { label: 'Reason', wrap: true }, { label: 'Query', wrap: true }, { label: 'Hits', num: true }]}
          rows={decisions.map((d) => [typeof d.kind === 'string' ? d.kind : null, typeof d.reason === 'string' ? d.reason : null, <QueryCell key="q" query={d.query} />, formatNumber(d.hits)])}
        />
      )}
    </Card>
  );
}

function UnusedFunctions({ rows }: { rows: UnusedRow[] }) {
  const [filters, setFilters] = useState<{ confidence: string[]; reason: string[]; language: string[]; text: string; group: number | null }>({ confidence: [], reason: [], language: [], text: '', group: null });
  const languages = useMemo(() => distinct(rows, languageOf), [rows]);
  const matching = useMemo(() => filterRows(rows, filters), [rows, filters]);
  useCounts({ unused: rows.length, 'unused-shown': matching.length });

  const toggle = (field: 'confidence' | 'reason' | 'language') => (value: string) =>
    setFilters((f) => ({ ...f, [field]: f[field].includes(value) ? f[field].filter((v) => v !== value) : [...f[field], value] }));

  const columns = useMemo<Column<UnusedRow>[]>(() => [
    { label: 'Name', key: KEYS.name, width: 'md', title: (r) => r.name, render: (r) => r.name },
    { label: 'Location', key: KEYS.location, width: 'xl', title: locationTitle, render: location },
    { label: 'Confidence', key: KEYS.confidence, render: (r) => confidenceBadge(r.confidence) },
    { label: 'Reason', key: KEYS.reason, render: (r) => r.reason },
    { label: 'Language', key: KEYS.language, render: (r) => r.language },
    {
      label: 'Group', key: KEYS.group, num: true,
      render: (r) => (r.group === null ? null : (
        <LinkButton title={`Show only the functions of group ${r.group}`} onClick={() => setFilters((f) => ({ ...f, group: r.group }))}>{String(r.group)}</LinkButton>
      )),
    },
    { label: 'Owner', key: KEYS.owner, width: 'md', title: (r) => r.owner, render: (r) => r.owner },
    { label: 'Visibility', key: KEYS.visibility, render: (r) => r.visibility },
    { label: 'Signals', key: KEYS.signals, width: 'md', title: (r) => signalsTitle(r.signals), render: (r) => signalsText(r.signals) },
    { label: 'Graph', key: () => null, render: (r) => <LocateButton target={{ kind: 'node', nodeId: r.id }} overlay="unused" /> },
  ], []);

  return (
    <Card title="Unused functions">
      <SearchInput value={filters.text} onChange={(text) => setFilters((f) => ({ ...f, text }))} placeholder="Search name, owner or file" />
      <div className="mb-2 flex flex-col gap-2">
        <ChipGroup label="Confidence" values={CONFIDENCES} selected={filters.confidence} onToggle={toggle('confidence')} />
        <ChipGroup label="Reason" values={REASONS} selected={filters.reason} onToggle={toggle('reason')} />
        <ChipGroup label="Language" values={languages} selected={filters.language} onToggle={toggle('language')} />
        {filters.group === null ? null : (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="min-w-[84px] text-xs text-muted">Group</span>
            <button type="button" onClick={() => setFilters((f) => ({ ...f, group: null }))} className="cursor-pointer rounded-full border border-accent bg-accent px-3 py-0.5 text-xs text-white">{`Group ${filters.group} (clear)`}</button>
          </div>
        )}
      </div>
      <p className="text-muted" data-xv-shown="">{`Showing ${formatNumber(matching.length)} of ${formatNumber(rows.length)} unused functions`}</p>
      <DataTable rows={matching} columns={columns} />
    </Card>
  );
}

function TestOnly({ rows }: { rows: UnusedRow[] }) {
  const columns = useMemo<Column<UnusedRow>[]>(() => [
    { label: 'Name', key: KEYS.name, width: 'md', title: (r) => r.name, render: (r) => r.name },
    { label: 'Language', key: KEYS.language, render: (r) => r.language },
    { label: 'Location', key: KEYS.location, width: 'xl', title: locationTitle, render: location },
    // These functions are not on the unused overlay's list, so nothing turns on with them.
    { label: 'Graph', key: () => null, render: (r) => <LocateButton target={{ kind: 'node', nodeId: r.id }} overlay={null} /> },
  ], []);
  return (
    <Card title="Used only by tests">
      {rows.length === 0 ? <p className="text-muted">The product lists no function used only by tests.</p> : <DataTable rows={rows} columns={columns} />}
    </Card>
  );
}

function UnusedBody({ data }: { data: UnusedProduct }) {
  const unused = useMemo(() => (data.unused ?? []).map(normalizeRow), [data]);
  const testOnly = useMemo(() => (data.testOnly ?? []).map(normalizeRow), [data]);
  return (
    <>
      <Summary product={data} />
      <Decisions decisions={Array.isArray(data.decisions) ? data.decisions : []} />
      <UnusedFunctions rows={unused} />
      <TestOnly rows={testOnly} />
      <Card title="Residual assumptions">
        <BulletList items={(data.residualAssumptions ?? []).map(String)} />
      </Card>
    </>
  );
}

export function UnusedPage() {
  return (
    <ProductPage<UnusedProduct>
      product="unused-code"
      title="Unused code"
      subtitle="Functions no route reaches, as the unused-code product lists them."
      load={(payloads, product) => payloads.parsed<UnusedProduct>(product.payloads[0])}
    >
      {(data) => <UnusedBody data={data} />}
    </ProductPage>
  );
}
