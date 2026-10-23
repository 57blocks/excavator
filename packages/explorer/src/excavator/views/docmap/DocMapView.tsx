import { useMemo, useState } from "react";
import { useDashboardStore } from "../../../store";
import { CODE_STATUSES, filterUnits, joinChecks, KEYS, VERDICTS, whereText, type DocMapCheck, type UnitRow } from "../../products/docmap";
import { lookupBars, verdictBars } from "../../products/docmap-charts";
import type { BarRow } from "../../products/bar-row";
import { EMPTY, formatNumber, NOT_PROVIDED } from "../../products/format";
import { BarList } from "../shared/BarList";
import { Collapsible } from "../shared/Collapsible";
import { BulletList, ChipGroup, Facts, SearchInput } from "../shared/Controls";
import { type Column, DataTable, SimpleTable } from "../shared/DataTable";
import { Note, Notice, Section } from "../shared/Section";
import { isTable, listOf, textsOf, type Table } from "../shared/shape";
import { CountTile, CountTiles, StatTile, StatTiles } from "../shared/Stats";
import type { ViewBodyProps, ViewModule } from "../types";
import { Coverage } from "./Coverage";
import UnitRowPanel, { CodeBadge } from "./UnitRowPanel";

const num = (value: unknown) => (typeof value === "number" ? value : null);

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

const toDocument = (raw: Table): DocumentRow => ({
  path: String(raw.path),
  format: typeof raw.format === "string" ? raw.format : null,
  status: typeof raw.status === "string" ? raw.status : null,
  reason: typeof raw.reason === "string" ? raw.reason : null,
  chars: num(raw.chars),
  lines: num(raw.lines),
  pages: num(raw.pages),
  units: num(raw.units),
});

const mono = (text: unknown) => <span className="font-mono text-[11px]">{String(text)}</span>;
const orNone = (value: unknown) => (typeof value === "string" ? mono(value) : "none recorded");

function Sources({ data }: { data: Table }) {
  const converters: Table = isTable(data.converters) ? data.converters : {};
  const names = Object.keys(converters).sort();
  const code: Table = isTable(data.code) ? data.code : {};
  const coverage: Table | null = isTable(data.coverage) ? data.coverage : null;
  return (
    <Section title="Sources">
      <Facts
        items={[
          ["Documents folder", mono(String(data.docsRoot))],
          ["Converters", names.length === 0 ? EMPTY : names.map((n) => `${n}: ${converters[n]}`).join(", ")],
          ["Code root", orNone(code.root)],
          ["Code revision", orNone(code.revision)],
          ...(coverage ? [["Coverage facts revision", orNone(coverage.sourceRevision)] as const] : []),
        ]}
      />
    </Section>
  );
}

const VERDICT_COLOUR: Record<string, string> = { does: "var(--color-node-function)", not: "var(--color-diff-changed)" };
const LOOKUP_COLOUR: Record<string, string> = { found: "var(--color-node-function)", "not-found": "var(--color-diff-affected)" };

/** The statistics and the two distribution charts above the tables: the product's counts, and the evidence counted by verdict. */
function Overview({ counts, units }: { counts: Table; units: UnitRow[] }) {
  const lookup = lookupBars(counts);
  const verdicts: BarRow[] = verdictBars(units).map((bar) => ({ ...bar, colour: VERDICT_COLOUR[bar.key] ?? "var(--color-text-muted)" }));
  return (
    <>
      <StatTiles>
        <StatTile label="Documents" value={counts.files} note="files in the documents folder" />
        <StatTile label="Units" value={counts.units} note="functions the documents describe" />
        <StatTile label="Code found" value={counts.found} note="units with evidence in code" />
        <StatTile label="No code found" value={counts.notFound} note="units whose searches found none" />
      </StatTiles>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <Section title="Units by lookup status">
          <BarList rows={lookup.rows.map((bar) => ({ ...bar, colour: LOOKUP_COLOUR[bar.key] ?? "var(--color-text-muted)" }))} label="Units by lookup status" />
          {lookup.missing.length > 0 ? <Note>{`${NOT_PROVIDED}: ${lookup.missing.join(", ")}`}</Note> : null}
        </Section>
        <Section title="Evidence by verdict">
          <BarList rows={verdicts} label="Pieces of evidence by the verdict of their check" />
        </Section>
      </div>
    </>
  );
}

function CountsCard({ counts }: { counts: Table }) {
  const tiles: [string, unknown][] = [
    ["Documents", counts.files], ["Read", counts.read], ["Empty", counts.empty], ["No converter", counts.noConverter],
    ["Unsupported", counts.unsupported], ["Failed", counts.failed], ["Units", counts.units],
    ["Code found", counts.found], ["No code found", counts.notFound], ["Not checked", counts.notChecked],
  ];
  return (
    <Collapsible title="All counts">
      <CountTiles>{tiles.map(([label, value]) => <CountTile key={label} label={label} value={value} />)}</CountTiles>
    </Collapsible>
  );
}

const textColumn = (label: string, field: "path" | "format" | "status" | "reason", width?: Column<DocumentRow>["width"]): Column<DocumentRow> => ({
  label, width, key: (d) => d[field], title: (d) => d[field], render: (d) => d[field],
});
const numberColumn = (label: string, field: "chars" | "lines" | "pages" | "units"): Column<DocumentRow> => ({
  label, num: true, key: (d) => d[field], render: (d) => (d[field] === null ? null : formatNumber(d[field])),
});

const DOCUMENT_COLUMNS: Column<DocumentRow>[] = [
  textColumn("Path", "path", "xl"), textColumn("Format", "format"), textColumn("Status", "status"), textColumn("Reason", "reason", "lg"),
  numberColumn("Chars", "chars"), numberColumn("Lines", "lines"), numberColumn("Pages", "pages"), numberColumn("Units", "units"),
];

function Units({ data, checks, detail }: { data: Table; checks: DocMapCheck[] | null; detail: ViewBodyProps["detail"] }) {
  const productRow = useDashboardStore((s) => s.productRow) as UnitRow | null;
  const setProductRow = useDashboardStore((s) => s.setProductRow);
  const joined = useMemo(() => joinChecks(listOf(data.units), checks), [data, checks]);
  const [filters, setFilters] = useState<{ codeStatus: string[]; verdict: string[]; text: string }>({ codeStatus: [], verdict: [], text: "" });
  const matching = useMemo(() => filterUnits(joined.rows, filters), [joined, filters]);
  const toggle = (field: "codeStatus" | "verdict") => (value: string) =>
    setFilters((f) => ({ ...f, [field]: f[field].includes(value) ? f[field].filter((v) => v !== value) : [...f[field], value] }));

  const columns = useMemo<Column<UnitRow>[]>(() => [
    { label: "Document", width: "md", key: KEYS.document, title: (r) => r.document, render: (r) => r.document },
    { label: "Id", key: KEYS.id, render: (r) => r.id },
    { label: "Title", width: "md", key: KEYS.title, title: (r) => r.title, render: (r) => r.title },
    { label: "Quote", width: "lg", key: KEYS.quote, title: (r) => r.quote, render: (r) => r.quote },
    { label: "Where", key: KEYS.where, render: whereText },
    { label: "Code", key: KEYS.codeStatus, render: (r) => <CodeBadge status={r.codeStatus} /> },
    { label: "Evidence", num: true, key: KEYS.evidence, render: (r) => String(r.evidence.length) },
    { label: "Verdicts", key: KEYS.verdict, render: (r) => r.verdictText },
  ], []);

  const notes: string[] = [];
  if (!joined.hasChecks) notes.push("There is no doc-map/checks.json in this page: every piece of evidence shows as not checked.");
  if (joined.unmatched > 0) notes.push(`${formatNumber(joined.unmatched)} check(s) in checks.json name no evidence of a unit.`);
  if (joined.duplicates > 0) notes.push(`${formatNumber(joined.duplicates)} check(s) repeat the unit, file and line of an earlier check and are not used.`);

  return (
    <>
      {detail}
      <Section title="Units" count={`${formatNumber(matching.length)} of ${formatNumber(joined.rows.length)}`}>
        <SearchInput value={filters.text} onChange={(text) => setFilters((f) => ({ ...f, text }))} placeholder="Search document, id, title or quote" />
        <div className="flex flex-col gap-2">
          <ChipGroup label="Code" values={CODE_STATUSES} selected={filters.codeStatus} onToggle={toggle("codeStatus")} />
          <ChipGroup label="Verdict" values={VERDICTS} selected={filters.verdict} onToggle={toggle("verdict")} />
        </div>
        <p className="text-xs text-text-muted" data-excavator-shown="units">{`Showing ${formatNumber(matching.length)} of ${formatNumber(joined.rows.length)} units`}</p>
        {notes.map((note) => <Note key={note}>{note}</Note>)}
        <DataTable name="units" rows={matching} columns={columns} onRowClick={(r) => setProductRow(r)} isSelected={(r) => productRow !== null && productRow.number === r.number} rowKey={(r) => String(r.number)} />
        <Note>Click a unit to see its quote, its code and the verdict on each place.</Note>
      </Section>
    </>
  );
}

function UnreadDocuments({ documents }: { documents: DocumentRow[] }) {
  const bad = documents.filter((d) => d.status !== "read");
  return (
    <Section title="Documents that were not read" count={formatNumber(bad.length)}>
      {bad.length === 0 ? (
        <Note>Every document was read.</Note>
      ) : (
        <SimpleTable columns={[{ label: "Path", wrap: true }, { label: "Status" }, { label: "Reason", wrap: true }]} rows={bad.map((d) => [d.path, d.status, d.reason])} />
      )}
    </Section>
  );
}

/** The checks of `doc-map/checks.json`: its `checks` list, or null when the page holds none. */
const checksOf = (secondary: unknown): DocMapCheck[] | null => (isTable(secondary) && Array.isArray(secondary.checks) ? (secondary.checks as DocMapCheck[]) : null);

function DocMapBody({ primary, secondary, detail }: ViewBodyProps) {
  const data = isTable(primary) ? primary : null;
  const checks = useMemo(() => checksOf(secondary), [secondary]);
  const documents = useMemo(() => listOf(data?.documents).map(toDocument), [data]);
  const joined = useMemo(() => joinChecks(listOf(data?.units), checks).rows, [data, checks]);
  if (data === null) return <Notice tone="error" title="This product could not be drawn" data-excavator-notice="error">The file is not in the expected shape.</Notice>;
  const counts: Table = isTable(data.counts) ? data.counts : {};
  const assumptions = textsOf(data.residualAssumptions);
  return (
    <>
      <Overview counts={counts} units={joined} />
      <Sources data={data} />
      <Section title="Documents" count={formatNumber(documents.length)}>
        <DataTable name="documents" rows={documents} columns={DOCUMENT_COLUMNS} />
      </Section>
      <Units data={data} checks={checks} detail={detail} />
      <Coverage coverage={data.coverage} />
      <UnreadDocuments documents={documents} />
      <Collapsible title="Residual assumptions" count={formatNumber(assumptions.length)}>
        <BulletList items={assumptions} />
      </Collapsible>
      <CountsCard counts={counts} />
    </>
  );
}

export const docMapView: ViewModule = { files: ["doc-map.json", "doc-map-checks.json"], Body: DocMapBody, Detail: UnitRowPanel as ViewModule["Detail"] };
