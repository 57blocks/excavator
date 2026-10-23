import { useEffect, useMemo, useState } from 'react';

import { ProductPage } from '../components/ProductPage';
import { RowActions } from '../components/RowExtras';
import { SourcePreview } from '../components/SourcePreview';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { BarList, type BarRow } from '../components/ui/BarList';
import { Card } from '../components/ui/Card';
import { LocateButton } from '../components/ui/LocateButton';
import { CodeLink } from '../components/ui/CodeLink';
import { Collapsible } from '../components/ui/Collapsible';
import { BulletList, ChipGroup, Facts, SearchInput } from '../components/ui/Controls';
import { type Column, DataTable, SimpleTable } from '../components/ui/DataTable';
import { PrefixBar, RowMissing } from '../components/ui/RowLinkNotes';
import { RowPanel } from '../components/ui/RowPanel';
import { StatTile, StatTiles } from '../components/ui/StatTile';
import { Tile, Tiles } from '../components/ui/Tile';
import { useRowLink } from '../hooks/use-row-link';
import { useCounts } from '../hooks/use-signals';
import { normalizePrefix, underPrefix } from '../lib/detail-rows';
import { CODE_STATUSES, filterUnits, joinChecks, KEYS, unitList, VERDICTS, whereText, type DocMapCheck, type UnitRow } from '../lib/docmap';
import { lookupBars, unitFiles, verdictBars } from '../lib/docmap-charts';
import { EMPTY, formatNumber, NOT_PROVIDED } from '../lib/format';

interface DocMapProduct {
  docsRoot?: unknown;
  converters?: Record<string, unknown>;
  code?: { root?: unknown; revision?: unknown } | null;
  counts?: Record<string, number>;
  documents?: Record<string, unknown>[];
  units?: Record<string, unknown>[];
  coverage?: Record<string, any> | null;
  residualAssumptions?: unknown[];
}

interface Loaded {
  product: DocMapProduct;
  checks: DocMapCheck[] | null;
}

const num = (value: unknown) => (typeof value === 'number' ? value : null);

interface DocumentRow {
  path: string;
  format: string | null;
  status: string | null;
  reason: string | null;
  chars: number | null;
  lines: number | null;
  pages: number | null;
  units: number | null;
}

const toDocument = (raw: Record<string, unknown>): DocumentRow => ({
  path: String(raw.path),
  format: typeof raw.format === 'string' ? raw.format : null,
  status: typeof raw.status === 'string' ? raw.status : null,
  reason: typeof raw.reason === 'string' ? raw.reason : null,
  chars: num(raw.chars),
  lines: num(raw.lines),
  pages: num(raw.pages),
  units: num(raw.units),
});

const VERDICT_TONE: Record<string, BadgeTone> = { does: 'success', not: 'danger' };
const CODE_TONE: Record<string, BadgeTone> = { found: 'success', 'not-found': 'warning' };

const VerdictBadge = ({ verdict }: { verdict: string }) => <Badge tone={VERDICT_TONE[verdict] ?? 'neutral'}>{String(verdict)}</Badge>;
const CodeBadge = ({ status }: { status: string }) => <Badge tone={CODE_TONE[status] ?? 'neutral'}>{status}</Badge>;

const mono = (text: string) => <span className="font-mono text-[12.5px]">{text}</span>;
const orNone = (value: unknown, render: (text: string) => React.ReactNode) => (typeof value === 'string' ? render(value) : 'none recorded');

function Sources({ data }: { data: DocMapProduct }) {
  const names = Object.keys(data.converters ?? {}).sort();
  return (
    <Card title="Sources">
      <Facts
        items={[
          ['Documents folder', mono(String(data.docsRoot))],
          ['Converters', names.length === 0 ? EMPTY : names.map((n) => `${n}: ${(data.converters as Record<string, unknown>)[n]}`).join(', ')],
          ['Code root', orNone(data.code?.root, mono)],
          ['Code revision', orNone(data.code?.revision, mono)],
          ...(data.coverage ? [['Coverage facts revision', orNone(data.coverage.sourceRevision, mono)] as const] : []),
        ]}
      />
    </Card>
  );
}

const VERDICT_COLOUR: Record<string, string> = { does: 'var(--color-success)', not: 'var(--color-danger)' };
const LOOKUP_COLOUR: Record<string, string> = { found: 'var(--color-success)', 'not-found': 'var(--color-warning)' };

/** The statistics and the two distribution charts above the tables: the product's counts, and the evidence counted by verdict. */
function Overview({ counts, units }: { counts: Record<string, number>; units: UnitRow[] }) {
  const lookup = lookupBars(counts);
  const verdicts: BarRow[] = verdictBars(units).map((bar) => ({ ...bar, colour: VERDICT_COLOUR[bar.key] ?? 'var(--color-muted)' }));
  return (
    <>
      <StatTiles>
        <StatTile label="Documents" value={counts.files} note="files in the documents folder" />
        <StatTile label="Units" value={counts.units} note="functions the documents describe" />
        <StatTile label="Code found" value={counts.found} note="units with evidence in code" />
        <StatTile label="No code found" value={counts.notFound} note="units whose searches found none" />
      </StatTiles>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-5">
        <Card title="Units by lookup status">
          <BarList rows={lookup.rows.map((bar) => ({ ...bar, colour: LOOKUP_COLOUR[bar.key] ?? 'var(--color-muted)' }))} label="Units by lookup status" />
          {lookup.missing.length > 0 ? <p className="mt-2 text-xs text-muted">{`${NOT_PROVIDED}: ${lookup.missing.join(', ')}`}</p> : null}
        </Card>
        <Card title="Evidence by verdict">
          <BarList rows={verdicts} label="Pieces of evidence by the verdict of their check" />
        </Card>
      </div>
    </>
  );
}

function CountsCard({ counts }: { counts: Record<string, number> }) {
  const tiles: [string, number][] = [
    ['Documents', counts.files], ['Read', counts.read], ['Empty', counts.empty], ['No converter', counts.noConverter],
    ['Unsupported', counts.unsupported], ['Failed', counts.failed], ['Units', counts.units],
    ['Code found', counts.found], ['No code found', counts.notFound], ['Not checked', counts.notChecked],
  ];
  return (
    <Collapsible title="All counts">
      <Tiles>{tiles.map(([label, value]) => <Tile key={label} label={label} value={value} />)}</Tiles>
    </Collapsible>
  );
}

const textColumn = (label: string, field: 'path' | 'format' | 'status' | 'reason', width?: Column<DocumentRow>['width']): Column<DocumentRow> => ({
  label, width, key: (d) => d[field], title: (d) => d[field], render: (d) => d[field],
});
const numberColumn = (label: string, field: 'chars' | 'lines' | 'pages' | 'units'): Column<DocumentRow> => ({
  label, num: true, key: (d) => d[field], render: (d) => (d[field] === null ? null : formatNumber(d[field])),
});

const DOCUMENT_COLUMNS: Column<DocumentRow>[] = [
  textColumn('Path', 'path', 'xl'), textColumn('Format', 'format'), textColumn('Status', 'status'), textColumn('Reason', 'reason', 'lg'),
  numberColumn('Chars', 'chars'), numberColumn('Lines', 'lines'), numberColumn('Pages', 'pages'), numberColumn('Units', 'units'),
];

/** The source of one place of evidence, read only when the reader unfolds it. */
function EvidenceSource({ path, line, open }: { path: string; line: number | null; open: boolean }) {
  const [shown, setShown] = useState(open);
  return (
    <details open={open} onToggle={(event) => setShown((event.currentTarget as HTMLDetailsElement).open)} className="mt-1.5">
      <summary className="cursor-pointer text-xs text-muted">Source</summary>
      {shown ? (
        <div data-xv-preview={path} className="xv-preview mt-1.5 overflow-hidden rounded-control border border-line">
          <SourcePreview path={path} lines={line === null ? null : String(line)} />
        </div>
      ) : null}
    </details>
  );
}

function EvidenceItem({ item, first }: { item: UnitRow['evidence'][number]; first: boolean }) {
  return (
    <li className="min-w-0 rounded-lg border border-line-2 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {item.file === null ? EMPTY : <CodeLink path={item.file} range={item.line === null ? null : [item.line]} />}
        {item.file === null ? null : <RowActions target={{ kind: 'file', path: item.file }} overlay="doc-map" path={item.file} range={item.line === null ? null : [item.line]} />}
      </div>
      {item.code === null ? null : <pre className="my-1.5 whitespace-pre-wrap rounded-md border-l-[3px] border-accent bg-paper px-3.5 py-2.5 font-mono text-[12.5px] [overflow-wrap:anywhere]">{item.code}</pre>}
      {item.check === null ? (
        <p className="mt-1 text-muted">Not checked: checks.json has no verdict for this place.</p>
      ) : (
        <p className="mt-1 [overflow-wrap:anywhere]">
          <VerdictBadge verdict={item.check.verdict} /> {item.check.reason === null ? <span className="text-muted">No reason recorded.</span> : item.check.reason}
        </p>
      )}
      {item.file === null ? null : <EvidenceSource path={item.file} line={item.line} open={first} />}
    </li>
  );
}

/** One unit: its quote verbatim, its code status, and each place with its code and verdict. */
export function UnitDetail({ row }: { row: UnitRow }) {
  const where = whereText(row);
  return (
    <div data-xv-unit={row.number} className="flex flex-col gap-3">
      <div>
        <h3 className="[overflow-wrap:anywhere]">{[row.document === null ? EMPTY : row.document, row.id === null ? '' : ` / ${row.id}`, row.title === null ? '' : ` ${row.title}`].join('')}</h3>
        <p className="text-muted">{[where, `unit ${row.number}`].filter(Boolean).join(', ')}</p>
      </div>
      <div>
        <h3 className="mb-1.5">Quote</h3>
        {row.quote === null ? <p className="text-muted">{EMPTY}</p> : <pre className="m-0 whitespace-pre-wrap rounded-md border-l-[3px] border-accent bg-paper px-3.5 py-2.5 font-mono text-[12.5px] [overflow-wrap:anywhere]">{row.quote}</pre>}
      </div>
      <div>
        <h3 className="mb-1.5">
          Code <CodeBadge status={row.codeStatus} />
        </h3>
        {row.codeStatus === 'found' ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">{row.evidence.map((item, i) => <EvidenceItem key={i} item={item} first={i === 0} />)}</ul>
        ) : row.codeStatus === 'not-found' ? (
          <>
            <p>No code was found. The searches that found none:</p>
            {row.searched.length === 0 ? (
              <p className="text-muted">The product lists no search.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {row.searched.map((search, i) => (
                  <li key={i} className="min-w-0 rounded-lg border border-line-2 px-3.5 py-2.5">
                    <div>
                      Pattern: <code>{String(search.pattern)}</code>
                    </div>
                    <div className="text-muted">{`Paths: ${Array.isArray(search.paths) && search.paths.length > 0 ? search.paths.join(', ') : EMPTY}`}</div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-muted">The code for this unit was not looked for.</p>
        )}
      </div>
    </div>
  );
}

function Units({ data, checks }: { data: DocMapProduct; checks: DocMapCheck[] | null }) {
  const joined = useMemo(() => joinChecks(data.units ?? [], checks), [data, checks]);
  const [filters, setFilters] = useState<{ codeStatus: string[]; verdict: string[]; text: string }>({ codeStatus: [], verdict: [], text: '' });
  const { row: linked, prefix, open, close, clearPrefix } = useRowLink();
  // A unit is under the path when any file of its evidence is.
  const prefixed = useMemo(() => {
    const wanted = normalizePrefix(prefix);
    return wanted === null ? joined.rows : joined.rows.filter((row) => unitFiles(row).some((file) => underPrefix(file, wanted)));
  }, [joined, prefix]);
  const matching = useMemo(() => filterUnits(prefixed, filters), [prefixed, filters]);
  const target = linked === null ? null : joined.rows.find((r) => String(r.number) === linked) ?? null;
  const inPrefix = target !== null && prefixed.includes(target);
  useEffect(() => {
    if (target !== null && inPrefix && !matching.includes(target)) setFilters({ codeStatus: [], verdict: [], text: '' });
  }, [linked]);
  const shown = target !== null && matching.includes(target) ? target : null;
  const missing = linked === null ? null : target === null ? `No unit of the doc map has the number "${linked}".` : !inPrefix ? `Unit ${linked} has no evidence under the path ${normalizePrefix(prefix)}.` : null;
  useCounts({ units: joined.rows.length, 'units-shown': matching.length, 'units-prefixed': prefixed.length, checks: joined.hasChecks ? (checks as DocMapCheck[]).length : 0 });

  const toggle = (field: 'codeStatus' | 'verdict') => (value: string) =>
    setFilters((f) => ({ ...f, [field]: f[field].includes(value) ? f[field].filter((v) => v !== value) : [...f[field], value] }));

  const columns = useMemo<Column<UnitRow>[]>(() => [
    { label: 'Document', width: 'md', key: KEYS.document, title: (r) => r.document, render: (r) => r.document },
    { label: 'Id', key: KEYS.id, render: (r) => r.id },
    { label: 'Title', width: 'md', key: KEYS.title, title: (r) => r.title, render: (r) => r.title },
    { label: 'Quote', width: 'lg', key: KEYS.quote, title: (r) => r.quote, render: (r) => r.quote },
    { label: 'Where', key: KEYS.where, render: whereText },
    { label: 'Code', key: KEYS.codeStatus, render: (r) => <CodeBadge status={r.codeStatus} /> },
    { label: 'Evidence', num: true, key: KEYS.evidence, render: (r) => String(r.evidence.length) },
    { label: 'Verdicts', key: KEYS.verdict, render: (r) => r.verdictText },
  ], []);

  const notes: string[] = [];
  if (!joined.hasChecks) notes.push('There is no doc-map/checks.json in this page: every piece of evidence shows as not checked.');
  if (joined.unmatched > 0) notes.push(`${formatNumber(joined.unmatched)} check(s) in checks.json name no evidence of a unit.`);
  if (joined.duplicates > 0) notes.push(`${formatNumber(joined.duplicates)} check(s) repeat the unit, file and line of an earlier check and are not used.`);

  return (
    <Card title="Units">
      <PrefixBar prefix={prefix} shown={prefixed.length} total={joined.rows.length} noun="units with evidence there" onClear={clearPrefix} />
      <RowMissing text={missing} />
      <SearchInput value={filters.text} onChange={(text) => setFilters((f) => ({ ...f, text }))} placeholder="Search document, id, title or quote" />
      <div className="mb-2 flex flex-col gap-2">
        <ChipGroup label="Code" values={CODE_STATUSES} selected={filters.codeStatus} onToggle={toggle('codeStatus')} />
        <ChipGroup label="Verdict" values={VERDICTS} selected={filters.verdict} onToggle={toggle('verdict')} />
      </div>
      <p className="text-muted">{`Showing ${formatNumber(matching.length)} of ${formatNumber(prefixed.length)} units`}</p>
      {notes.map((note) => <p key={note} className="text-muted">{note}</p>)}
      <DataTable rows={matching} columns={columns} onRowClick={(r) => open(String(r.number))} isSelected={(r) => r === shown} rowKey={(r) => String(r.number)} focusKey={shown === null ? null : String(shown.number)} />
      <p className="mt-2 text-muted">Click a unit to see its quote, its code and the verdict on each place.</p>
      <RowPanel open={shown !== null} rowKey={shown === null ? null : String(shown.number)} title={shown ? `Unit ${shown.number}` : 'Unit'} onClose={close}>
        {shown ? <UnitDetail row={shown} /> : null}
      </RowPanel>
    </Card>
  );
}

function Coverage({ coverage }: { coverage: Record<string, any> | null | undefined }) {
  const directories: Record<string, any>[] = Array.isArray(coverage?.directories) ? coverage.directories : [];
  const files: Record<string, any>[] = Array.isArray(coverage?.files) ? coverage.files : [];
  const [filter, setFilter] = useState<{ evidence: string[]; text: string }>({ evidence: [], text: '' });
  const withEvidence = (f: Record<string, any>) => Array.isArray(f.units) && f.units.length > 0;
  const matching = useMemo(() => {
    const text = filter.text.trim().toLowerCase();
    return files.filter((f) => (filter.evidence.length === 0 || filter.evidence.includes(withEvidence(f) ? 'with evidence' : 'without evidence')) && (text === '' || String(f.path).toLowerCase().includes(text)));
  }, [files, filter]);

  const directoryColumns = useMemo<Column<Record<string, any>>[]>(() => [
    { label: 'Directory', width: 'xl', key: (d) => d.path, title: (d) => d.path, render: (d) => d.path },
    { label: 'Code files', num: true, key: (d) => d.files, render: (d) => formatNumber(d.files) },
    { label: 'With evidence', num: true, key: (d) => d.withEvidence, render: (d) => formatNumber(d.withEvidence) },
    { label: 'Units', width: 'lg', key: (d) => (d.units ? d.units.length : null), title: (d) => unitList(d.units), render: (d) => unitList(d.units) },
    { label: 'Graph', key: () => null, render: (d) => <LocateButton target={{ kind: 'directory', path: String(d.path) }} overlay="doc-map" /> },
  ], []);
  const fileColumns = useMemo<Column<Record<string, any>>[]>(() => [
    { label: 'File', width: 'xl', key: (f) => f.path, title: (f) => f.path, render: (f) => <CodeLink path={f.path} /> },
    { label: 'Evidence', key: (f) => (withEvidence(f) ? 1 : 0), render: (f) => (withEvidence(f) ? 'with evidence' : 'without evidence') },
    { label: 'Units', width: 'lg', key: (f) => (f.units ? f.units.length : null), title: (f) => unitList(f.units), render: (f) => unitList(f.units) },
    { label: 'Graph', key: () => null, render: (f) => <LocateButton target={{ kind: 'file', path: String(f.path) }} overlay="doc-map" /> },
  ], []);

  if (!coverage || typeof coverage !== 'object') {
    return (
      <Card title="Coverage">
        <p className="text-muted">{"The product has no coverage yet: /excavator-doc-map has not counted the project's code files."}</p>
      </Card>
    );
  }
  const c = coverage.counts || {};
  const tiles: [string, number][] = [
    ['Files analysed', c.files], ['Documents', c.documents], ['Code files', c.code], ['With evidence', c.withEvidence],
    ['Without evidence', c.withoutEvidence], ['Pieces of evidence', c.evidence], ['Not in a code file', c.outside],
  ];
  const outside: Record<string, any>[] = Array.isArray(coverage.outside) ? coverage.outside : [];
  const documents: unknown[] = Array.isArray(coverage.documents) ? coverage.documents : [];
  return (
    <>
      <Card title="Coverage">
        <p className="text-muted">{"A code file without evidence means only that no unit's evidence is in it."}</p>
        <Tiles>{tiles.map(([label, value]) => <Tile key={label} label={label} value={value} />)}</Tiles>
      </Card>
      <Card title="Coverage by directory">
        <DataTable rows={directories} columns={directoryColumns} />
      </Card>
      <Card title="Coverage by file">
        <SearchInput value={filter.text} onChange={(text) => setFilter((f) => ({ ...f, text }))} placeholder="Search code file paths" />
        <div className="mb-2">
          <ChipGroup
            label="Evidence"
            values={['with evidence', 'without evidence']}
            selected={filter.evidence}
            onToggle={(v) => setFilter((f) => ({ ...f, evidence: f.evidence.includes(v) ? f.evidence.filter((x) => x !== v) : [...f.evidence, v] }))}
          />
        </div>
        <p className="text-muted">{`Showing ${formatNumber(matching.length)} of ${formatNumber(files.length)} code files`}</p>
        <DataTable rows={matching} columns={fileColumns} />
      </Card>
      <Card title="Evidence outside the code files">
        {outside.length === 0 ? (
          <p className="text-muted">Every piece of evidence is in a code file of the facts.</p>
        ) : (
          <SimpleTable
            columns={[{ label: 'Unit', num: true }, { label: 'File', wrap: true }, { label: 'Line', num: true }]}
            rows={outside.map((o) => [formatNumber(o.unit), typeof o.file === 'string' ? <CodeLink key="f" path={o.file} range={typeof o.line === 'number' ? [o.line] : null} /> : null, formatNumber(o.line)])}
          />
        )}
      </Card>
      <Card title="Documents among the facts">
        {documents.length === 0 ? <p className="text-muted">No fact file counts as a document.</p> : <BulletList mono items={documents.map(String)} />}
      </Card>
    </>
  );
}

function UnreadDocuments({ documents }: { documents: DocumentRow[] }) {
  const bad = documents.filter((d) => d.status !== 'read');
  return (
    <Card title="Documents that were not read">
      {bad.length === 0 ? (
        <p className="text-muted">Every document was read.</p>
      ) : (
        <SimpleTable columns={[{ label: 'Path', wrap: true }, { label: 'Status' }, { label: 'Reason', wrap: true }]} rows={bad.map((d) => [d.path, d.status, d.reason])} />
      )}
    </Card>
  );
}

function DocMapBody({ data, checks }: { data: DocMapProduct; checks: DocMapCheck[] | null }) {
  const documents = useMemo(() => (data.documents ?? []).map(toDocument), [data]);
  const joined = useMemo(() => joinChecks(data.units ?? [], checks).rows, [data, checks]);
  const assumptions = (data.residualAssumptions ?? []).map(String);
  return (
    <>
      <Overview counts={data.counts ?? {}} units={joined} />
      <Sources data={data} />
      <Card title="Documents">
        <DataTable rows={documents} columns={DOCUMENT_COLUMNS} />
      </Card>
      <Units data={data} checks={checks} />
      <Coverage coverage={data.coverage} />
      <UnreadDocuments documents={documents} />
      <Collapsible title="Residual assumptions" count={formatNumber(assumptions.length)}>
        <BulletList items={assumptions} />
      </Collapsible>
      <CountsCard counts={data.counts ?? {}} />
    </>
  );
}

export function DocMapPage() {
  return (
    <ProductPage<Loaded>
      product="doc-map"
      title="Doc map"
      subtitle="The functions the documents describe, each with its quote and the code the product ties to it."
      load={async (payloads, product) => {
        const [doc, checks] = await Promise.all([
          payloads.parsed<DocMapProduct>('doc-map'),
          product.payloads.includes('doc-map-checks') ? payloads.parsed<{ checks: DocMapCheck[] }>('doc-map-checks') : Promise.resolve(null),
        ]);
        return { product: doc, checks: checks ? checks.checks : null };
      }}
    >
      {({ product, checks }) => <DocMapBody data={product} checks={checks} />}
    </ProductPage>
  );
}
