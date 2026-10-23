import { useMemo, useState, type ReactNode } from "react";
import { useDashboardStore } from "../../../store";
import type { BarRow } from "../../products/bar-row";
import { formatNumber, NOT_PROVIDED } from "../../products/format";
import { CONFIDENCES, distinct, filterRows, KEYS, languageOf, normalizeRow, queryHead, REASONS, signalsText, signalsTitle, type UnusedRow } from "../../products/unused";
import { confidenceBars, languageBars, type Bars } from "../../products/unused-related";
import { lineText, sourceRange } from "../codeAction";
import { BarList } from "../shared/BarList";
import { Collapsible } from "../shared/Collapsible";
import { BulletList, ChipGroup, LinkButton, SearchInput } from "../shared/Controls";
import { type Column, DataTable, SimpleTable } from "../shared/DataTable";
import { Note, Notice, Section } from "../shared/Section";
import { isTable, listOf, textsOf, type Table } from "../shared/shape";
import { CountTile, CountTiles, StatTile, StatTiles } from "../shared/Stats";
import type { ViewBodyProps, ViewModule } from "../types";
import { confidenceBadge } from "./confidence";
import UnusedRowPanel from "./UnusedRowPanel";

const CONFIDENCE_COLOUR: Record<string, string> = { high: "var(--color-diff-changed)", medium: "var(--color-diff-affected)", low: "var(--color-text-muted)" };

function locationText(row: UnusedRow): string | null {
  if (row.file === null) return null;
  const lines = lineText(sourceRange(row.lineRange));
  return row.file + (lines ? `:${lines}` : "");
}

const mono = (text: string | null) => (text === null ? null : <span className="font-mono text-[11px]">{text}</span>);

/** A chart card: the bars, and the bars the product has no count for named under them. */
function BarsCard({ title, bars, label, empty }: { title: string; bars: Bars; label: string; empty: string }) {
  return (
    <Section title={title}>
      {bars.rows.length === 0 && bars.missing.length === 0 ? <Note>{empty}</Note> : <BarList rows={bars.rows} label={label} />}
      {bars.missing.length > 0 ? <Note>{`${NOT_PROVIDED}: ${bars.missing.join(", ")}`}</Note> : null}
    </Section>
  );
}

/** The statistics and distribution bars above the table; every number is a field of the product's counts. */
function Overview({ product }: { product: Table }) {
  const counts: Table = isTable(product.counts) ? product.counts : {};
  const conservation: Table = isTable(product.conservation) ? product.conservation : {};
  const byConfidence = confidenceBars(counts);
  const coloured = { ...byConfidence, rows: byConfidence.rows.map((row): BarRow => ({ ...row, colour: CONFIDENCE_COLOUR[row.key] })) };
  return (
    <>
      <StatTiles>
        <StatTile label="Unused" value={counts.unused} note="functions listed as unused" />
        <StatTile label="Unreferenced" value={counts.unreferenced} note="nothing refers to them" />
        <StatTile label="Only reachable from unused" value={counts.onlyReachableFromUnused} note="referred to by unused code only" />
        <StatTile label="Test only" value={counts.testOnly} note="used only by tests" />
      </StatTiles>
      <p className="font-mono text-[11px] text-text-muted [overflow-wrap:anywhere]" data-excavator-conservation="">
        {`candidates (${formatNumber(conservation.candidates)}) = removed by decision (${formatNumber(conservation.removedByDecision)}) + test only (${formatNumber(conservation.testOnly)}) + unused (${formatNumber(conservation.unused)}): ${conservation.holds === true ? "holds" : "does not hold"}`}
      </p>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <BarsCard title="By confidence" bars={coloured} label="Unused functions by confidence" empty="The product counts no confidence." />
        <BarsCard title="By language" bars={languageBars(counts)} label="Unused functions by language" empty="The product counts no language." />
      </div>
    </>
  );
}

/** Every count of the product, as it states them, folded. */
function FullCounts({ product }: { product: Table }) {
  const counts: Table = isTable(product.counts) ? product.counts : {};
  const languages: Record<string, Table> = isTable(counts.byLanguage) ? counts.byLanguage : {};
  const tiles: [string, unknown][] = [
    ["Candidates", counts.candidates], ["Removed by decision", counts.removedByDecision], ["Test only", counts.testOnly],
    ["Unused", counts.unused], ["Unreferenced", counts.unreferenced], ["Only reachable from unused", counts.onlyReachableFromUnused],
    ["Groups", counts.groups],
  ];
  return (
    <Collapsible title="All counts">
      <CountTiles>{tiles.map(([label, value]) => <CountTile key={label} label={label} value={value} />)}</CountTiles>
      <SimpleTable
        columns={[{ label: "Language" }, { label: "Candidates", num: true }, { label: "Calls", num: true }, { label: "Unused", num: true }, { label: "High", num: true }, { label: "Medium", num: true }, { label: "Low", num: true }]}
        rows={Object.keys(languages).sort().map((language) => {
          const r = languages[language] ?? {};
          return [language, formatNumber(r.candidates), formatNumber(r.calls), formatNumber(r.unused), formatNumber(r.high), formatNumber(r.medium), formatNumber(r.low)];
        })}
      />
    </Collapsible>
  );
}

function QueryCell({ query }: { query: unknown }) {
  if (typeof query !== "string" || query === "") return null;
  const parts = queryHead(query);
  if (!parts.rest) return <code className="font-mono text-[11px]">{query}</code>;
  return (
    <details>
      <summary className="max-w-[300px] cursor-pointer truncate font-mono text-[11px] text-text-secondary">{parts.head}</summary>
      <code className="mt-1.5 block whitespace-pre-wrap font-mono text-[11px] [overflow-wrap:anywhere]">{query}</code>
    </details>
  );
}

function Decisions({ decisions }: { decisions: Table[] }) {
  return (
    <Collapsible title="Decisions" count={formatNumber(decisions.length)}>
      {decisions.length === 0 ? (
        <Note>The product records no decisions.</Note>
      ) : (
        <SimpleTable
          columns={[{ label: "Kind" }, { label: "Reason", wrap: true }, { label: "Query", wrap: true }, { label: "Hits", num: true }]}
          rows={decisions.map((d) => [typeof d.kind === "string" ? d.kind : null, typeof d.reason === "string" ? d.reason : null, <QueryCell key="q" query={d.query} />, formatNumber(d.hits)])}
        />
      )}
    </Collapsible>
  );
}

type Filters = { confidence: string[]; reason: string[]; language: string[]; text: string; group: number | null };
const NO_FILTERS: Filters = { confidence: [], reason: [], language: [], text: "", group: null };

function UnusedFunctions({ rows, detail }: { rows: UnusedRow[]; detail: ReactNode }) {
  const productRow = useDashboardStore((s) => s.productRow) as UnusedRow | null;
  const setProductRow = useDashboardStore((s) => s.setProductRow);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const languages = useMemo(() => distinct(rows, languageOf), [rows]);
  const matching = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const toggle = (field: "confidence" | "reason" | "language") => (value: string) =>
    setFilters((f) => ({ ...f, [field]: f[field].includes(value) ? f[field].filter((v) => v !== value) : [...f[field], value] }));

  const columns = useMemo<Column<UnusedRow>[]>(() => [
    { label: "Name", key: KEYS.name, width: "md", title: (r) => r.name, render: (r) => r.name },
    { label: "Location", key: KEYS.location, width: "xl", title: locationText, render: (r) => mono(locationText(r)) },
    { label: "Confidence", key: KEYS.confidence, render: (r) => confidenceBadge(r.confidence) },
    { label: "Reason", key: KEYS.reason, render: (r) => r.reason },
    { label: "Language", key: KEYS.language, render: (r) => r.language },
    {
      label: "Group", key: KEYS.group, num: true,
      render: (r) => (r.group === null ? null : (
        <LinkButton title={`Show only the functions of group ${r.group}`} onClick={() => setFilters((f) => ({ ...f, group: r.group }))}>{String(r.group)}</LinkButton>
      )),
    },
    { label: "Owner", key: KEYS.owner, width: "md", title: (r) => r.owner, render: (r) => r.owner },
    { label: "Visibility", key: KEYS.visibility, render: (r) => r.visibility },
    { label: "Signals", key: KEYS.signals, width: "md", title: (r) => signalsTitle(r.signals), render: (r) => signalsText(r.signals) },
  ], []);

  return (
    <>
      {detail}
      <Section title="Unused functions" count={`${formatNumber(matching.length)} of ${formatNumber(rows.length)}`}>
        <SearchInput value={filters.text} onChange={(text) => setFilters((f) => ({ ...f, text }))} placeholder="Search name, owner or file" />
        <div className="flex flex-col gap-2">
          <ChipGroup label="Confidence" values={CONFIDENCES} selected={filters.confidence} onToggle={toggle("confidence")} />
          <ChipGroup label="Reason" values={REASONS} selected={filters.reason} onToggle={toggle("reason")} />
          <ChipGroup label="Language" values={languages} selected={filters.language} onToggle={toggle("language")} />
          {filters.group === null ? null : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="min-w-[72px] text-[10px] uppercase tracking-wider text-text-muted">Group</span>
              <button type="button" onClick={() => setFilters((f) => ({ ...f, group: null }))} className="rounded-full border border-accent/40 bg-accent/20 px-3 py-0.5 text-xs text-accent">{`Group ${filters.group} (clear)`}</button>
            </div>
          )}
        </div>
        <p className="text-xs text-text-muted" data-excavator-shown="unused">{`Showing ${formatNumber(matching.length)} of ${formatNumber(rows.length)} unused functions`}</p>
        <DataTable name="unused" rows={matching} columns={columns} onRowClick={(r) => setProductRow(r)} isSelected={(r) => productRow !== null && productRow.id === r.id} rowKey={(r) => r.id} />
        <Note>Click a function to see its fields, its group, its referrers and where it is.</Note>
      </Section>
    </>
  );
}

/** Functions used only by tests are not unused, so their rows open no unused-function details. */
function TestOnly({ rows }: { rows: UnusedRow[] }) {
  const columns = useMemo<Column<UnusedRow>[]>(() => [
    { label: "Name", key: KEYS.name, width: "md", title: (r) => r.name, render: (r) => r.name },
    { label: "Language", key: KEYS.language, render: (r) => r.language },
    { label: "Location", key: KEYS.location, width: "xl", title: locationText, render: (r) => mono(locationText(r)) },
  ], []);
  return (
    <Section title="Used only by tests" count={formatNumber(rows.length)}>
      {rows.length === 0 ? (
        <Note>The product lists no function used only by tests.</Note>
      ) : (
        <DataTable name="test-only" rows={rows} columns={columns} rowKey={(r) => r.id} />
      )}
    </Section>
  );
}

function UnusedBody({ primary, detail }: ViewBodyProps) {
  const data = isTable(primary) ? primary : null;
  const unused = useMemo(() => listOf(data?.unused).map(normalizeRow), [data]);
  const testOnly = useMemo(() => listOf(data?.testOnly).map(normalizeRow), [data]);
  if (data === null) return <Notice tone="error" title="This product could not be drawn" data-excavator-notice="error">The file is not in the expected shape.</Notice>;
  return (
    <>
      <Overview product={data} />
      <UnusedFunctions rows={unused} detail={detail} />
      <TestOnly rows={testOnly} />
      <Decisions decisions={listOf(data.decisions)} />
      <Collapsible title="Residual assumptions" count={formatNumber(textsOf(data.residualAssumptions).length)}>
        <BulletList items={textsOf(data.residualAssumptions)} />
      </Collapsible>
      <FullCounts product={data} />
    </>
  );
}

export const unusedView: ViewModule = { files: ["unused-code.json"], Body: UnusedBody, Detail: UnusedRowPanel as ViewModule["Detail"] };
