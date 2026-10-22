import { useEffect, useMemo, useState } from 'react';

import { useCounts } from '../hooks/use-signals';
import { useRowLink } from '../hooks/use-row-link';
import { ProductPage } from '../components/ProductPage';
import { RowActions, RowSource } from '../components/RowExtras';
import { BarList } from '../components/ui/BarList';
import { Card } from '../components/ui/Card';
import { CodeLink } from '../components/ui/CodeLink';
import { Collapsible } from '../components/ui/Collapsible';
import { LocateButton } from '../components/ui/LocateButton';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { ChipGroup, LinkButton, SearchInput, BulletList } from '../components/ui/Controls';
import { type Column, DataTable, SimpleTable } from '../components/ui/DataTable';
import { PrefixBar, RowMissing } from '../components/ui/RowLinkNotes';
import { RowFields, RowPanel, RowSection } from '../components/ui/RowPanel';
import { StatTile, StatTiles } from '../components/ui/StatTile';
import { Tile, Tiles } from '../components/ui/Tile';
import { rangeText } from '../lib/code';
import { filterByPrefix, normalizePrefix } from '../lib/detail-rows';
import { formatNumber, NOT_PROVIDED } from '../lib/format';
import { CONFIDENCES, distinct, filterRows, KEYS, languageOf, normalizeRow, queryHead, REASONS, signalsText, signalsTitle, type UnusedRow } from '../lib/unused';
import { confidenceBars, groupMates, languageBars, referrerList, type Bars } from '../lib/unused-related';

interface UnusedProduct {
  counts: Record<string, any>;
  conservation: Record<string, any>;
  decisions?: Record<string, any>[];
  unused?: Record<string, unknown>[];
  groups?: unknown;
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

const CONFIDENCE_COLOUR: Record<string, string> = { high: 'var(--color-unused-high)', medium: 'var(--color-unused-medium)', low: 'var(--color-unused-low)' };

/** A chart card: the bars, and the bars the product has no count for named under them. */
function BarsCard({ title, bars, label, empty }: { title: string; bars: Bars; label: string; empty: string }) {
  return (
    <Card title={title}>
      {bars.rows.length === 0 && bars.missing.length === 0 ? <p className="text-muted">{empty}</p> : <BarList rows={bars.rows} label={label} />}
      {bars.missing.length > 0 ? <p className="mt-2 text-xs text-muted">{`${NOT_PROVIDED}: ${bars.missing.join(', ')}`}</p> : null}
    </Card>
  );
}

/** The statistics and distribution charts above the table, every number a field of the product's counts. */
function Overview({ product }: { product: UnusedProduct }) {
  const { counts, conservation } = product;
  const byConfidence = confidenceBars(counts);
  const byConfidenceColoured = { ...byConfidence, rows: byConfidence.rows.map((row) => ({ ...row, colour: CONFIDENCE_COLOUR[row.key] })) };
  return (
    <>
      <StatTiles>
        <StatTile label="Unused" value={counts.unused} note="functions listed as unused" />
        <StatTile label="Unreferenced" value={counts.unreferenced} note="nothing refers to them" />
        <StatTile label="Only reachable from unused" value={counts.onlyReachableFromUnused} note="referred to by unused code only" />
        <StatTile label="Test only" value={counts.testOnly} note="used only by tests" />
      </StatTiles>
      <p className="m-0 font-mono text-[12.5px] text-muted">
        {`candidates (${formatNumber(conservation.candidates)}) = removed by decision (${formatNumber(conservation.removedByDecision)}) + test only (${formatNumber(conservation.testOnly)}) + unused (${formatNumber(conservation.unused)}): ${conservation.holds === true ? 'holds' : 'does not hold'}`}
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-5">
        <BarsCard title="By confidence" bars={byConfidenceColoured} label="Unused functions by confidence" empty="The product counts no confidence." />
        <BarsCard title="By language" bars={languageBars(counts)} label="Unused functions by language" empty="The product counts no language." />
      </div>
    </>
  );
}

/** Every count of the product, as it states them, folded. */
function FullCounts({ product }: { product: UnusedProduct }) {
  const { counts } = product;
  const languages: Record<string, Record<string, number>> = counts.byLanguage || {};
  const tiles: [string, unknown][] = [
    ['Candidates', counts.candidates], ['Removed by decision', counts.removedByDecision], ['Test only', counts.testOnly],
    ['Unused', counts.unused], ['Unreferenced', counts.unreferenced], ['Only reachable from unused', counts.onlyReachableFromUnused],
    ['Groups', counts.groups],
  ];
  return (
    <Collapsible title="All counts">
      <Tiles>{tiles.map(([label, value]) => <Tile key={label} label={label} value={value} />)}</Tiles>
      <div className="mt-4">
        <SimpleTable
          columns={[{ label: 'Language' }, { label: 'Candidates', num: true }, { label: 'Calls', num: true }, { label: 'Unused', num: true }, { label: 'High', num: true }, { label: 'Medium', num: true }, { label: 'Low', num: true }]}
          rows={Object.keys(languages).sort().map((language) => {
            const r = languages[language];
            return [language, formatNumber(r.candidates), formatNumber(r.calls), formatNumber(r.unused), formatNumber(r.high), formatNumber(r.medium), formatNumber(r.low)];
          })}
        />
      </div>
    </Collapsible>
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
    <Collapsible title="Decisions" count={formatNumber(decisions.length)}>
      {decisions.length === 0 ? (
        <p className="text-muted">The product records no decisions.</p>
      ) : (
        <SimpleTable
          columns={[{ label: 'Kind' }, { label: 'Reason', wrap: true }, { label: 'Query', wrap: true }, { label: 'Hits', num: true }]}
          rows={decisions.map((d) => [typeof d.kind === 'string' ? d.kind : null, typeof d.reason === 'string' ? d.reason : null, <QueryCell key="q" query={d.query} />, formatNumber(d.hits)])}
        />
      )}
    </Collapsible>
  );
}

type Filters = { confidence: string[]; reason: string[]; language: string[]; text: string; group: number | null };
const NO_FILTERS: Filters = { confidence: [], reason: [], language: [], text: '', group: null };

const signalDetail = (signal: Record<string, unknown>) => {
  const { signal: name, ...rest } = signal;
  const fields = Object.keys(rest);
  return fields.length === 0 ? String(name) : `${String(name)} ${JSON.stringify(rest)}`;
};

/** A function the panel names: a button that opens its own row when it is on the unused list, else its id as text. */
function RelatedId({ id, name, listed, note, onOpen }: { id: string; name: string | null; listed: boolean; note?: string; onOpen: (id: string) => void }) {
  const label = name === null ? id : `${name} (${id})`;
  return (
    <li className="[overflow-wrap:anywhere]">
      {listed ? <LinkButton title={`Open ${id}`} onClick={() => onOpen(id)}><span data-xv-related={id}>{label}</span></LinkButton> : <code>{id}</code>}
      {note ? <span className="text-muted">{` ${note}`}</span> : null}
    </li>
  );
}

/** The row panel of an unused function: its fields and signals, its group, its referrers and its source. */
function UnusedPanel({ row, groups, byId, onOpen }: { row: UnusedRow; groups: unknown; byId: ReadonlyMap<string, UnusedRow>; onOpen: (id: string) => void }) {
  const mates = groupMates(groups, row);
  const referrers = referrerList(row, new Set(byId.keys()));
  const nameOf = (id: string) => byId.get(id)?.name ?? null;
  return (
    <>
      <RowActions target={{ kind: 'node', nodeId: row.id }} overlay="unused" path={row.file} range={row.lineRange} />
      <RowFields
        fields={[
          { label: 'Name', value: row.name },
          { label: 'Id', value: <code>{row.id}</code> },
          { label: 'Owner', value: row.owner },
          { label: 'Language', value: row.language },
          { label: 'Location', value: location(row) },
          { label: 'Visibility', value: row.visibility },
          { label: 'Reason', value: row.reason },
          { label: 'Confidence', value: confidenceBadge(row.confidence) },
          { label: 'Group', value: row.group === null ? null : String(row.group) },
        ]}
      />
      <RowSection title="Signals">
        {row.signals.length === 0 ? <p className="text-muted">The product records no signal.</p> : <BulletList mono items={row.signals.map((sig) => signalDetail(sig as Record<string, unknown>))} />}
      </RowSection>
      <RowSection title="Group">
        {mates.state === 'no-group' ? <p className="text-muted">The row names no group.</p> : null}
        {mates.state === 'not-listed' ? <p className="text-muted">{`The product's groups list has no group ${mates.group}.`}</p> : null}
        {mates.state === 'listed' ? (
          <div data-xv-group={mates.group} data-xv-group-others={mates.others.length}>
            <p className="text-muted">{`Group ${mates.group}: ${formatNumber(mates.others.length + 1)} member(s), entries: ${mates.entries.length === 0 ? 'none listed' : mates.entries.join(', ')}.`}</p>
            {mates.others.length === 0 ? <p className="text-muted">No other member.</p> : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {mates.others.map((id) => <RelatedId key={id} id={id} name={nameOf(id)} listed={byId.has(id)} note={mates.entries.includes(id) ? '(entry)' : undefined} onOpen={onOpen} />)}
              </ul>
            )}
          </div>
        ) : null}
      </RowSection>
      <RowSection title="Referrers">
        {referrers.state === 'not-provided' ? <p className="text-muted">{NOT_PROVIDED}</p> : referrers.referrers.length === 0 ? <p className="text-muted">The product records no referrer.</p> : (
          <ul data-xv-referrers={referrers.referrers.length} className="m-0 flex list-none flex-col gap-1 p-0">
            {referrers.referrers.map((r) => <RelatedId key={`${r.id} ${r.edge}`} id={r.id} name={nameOf(r.id)} listed={r.listed} note={r.edge === null ? undefined : `(${r.edge}${r.reverse ? ', reverse' : ''})`} onOpen={onOpen} />)}
          </ul>
        )}
      </RowSection>
      <RowSource path={row.file} range={row.lineRange} />
    </>
  );
}

function UnusedFunctions({ rows, groups }: { rows: UnusedRow[]; groups: unknown }) {
  const { row: linked, prefix, open, close, clearPrefix } = useRowLink();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const prefixed = useMemo(() => filterByPrefix(rows, (r) => r.file, prefix), [rows, prefix]);
  const languages = useMemo(() => distinct(prefixed, languageOf), [prefixed]);
  const matching = useMemo(() => filterRows(prefixed, filters), [prefixed, filters]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const target = linked === null ? null : byId.get(linked) ?? null;
  const underPrefix = target !== null && prefixed.includes(target);
  // A row a link names that the chips or the search hide: they are taken off, so the row can be shown.
  useEffect(() => {
    if (target !== null && underPrefix && !matching.includes(target)) setFilters(NO_FILTERS);
  }, [linked]);
  const shown = target !== null && matching.includes(target) ? target : null;
  const missing = linked === null ? null : target === null ? `No function of the unused list has the id "${linked}".` : !underPrefix ? `"${linked}" is not under the path ${normalizePrefix(prefix)}.` : null;
  useCounts({ unused: rows.length, 'unused-shown': matching.length, 'unused-prefixed': prefixed.length });

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
      <PrefixBar prefix={prefix} shown={prefixed.length} total={rows.length} noun="unused functions" onClear={clearPrefix} />
      <RowMissing text={missing} />
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
      <p className="text-muted" data-xv-shown="">{`Showing ${formatNumber(matching.length)} of ${formatNumber(prefixed.length)} unused functions`}</p>
      <DataTable rows={matching} columns={columns} onRowClick={(r) => open(r.id)} isSelected={(r) => r === shown} rowKey={(r) => r.id} focusKey={shown === null ? null : shown.id} />
      <p className="mt-2 text-muted">Click a function to see its fields, its group, its referrers and its source.</p>
      <RowPanel open={shown !== null} rowKey={shown?.id ?? null} title={shown ? shown.name ?? shown.id : 'Unused function'} onClose={close}>
        {shown ? <UnusedPanel row={shown} groups={groups} byId={byId} onOpen={(id) => open(id)} /> : null}
      </RowPanel>
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
  const assumptions = (data.residualAssumptions ?? []).map(String);
  return (
    <>
      <Overview product={data} />
      <UnusedFunctions rows={unused} groups={data.groups} />
      <TestOnly rows={testOnly} />
      <Decisions decisions={Array.isArray(data.decisions) ? data.decisions : []} />
      <Collapsible title="Residual assumptions" count={formatNumber(assumptions.length)}>
        <BulletList items={assumptions} />
      </Collapsible>
      <FullCounts product={data} />
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
