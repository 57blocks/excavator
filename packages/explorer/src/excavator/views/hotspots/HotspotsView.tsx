import { useMemo, useState, type ReactNode } from "react";
import { useDashboardStore } from "../../../store";
import { EMPTY, formatNumber, NOT_PROVIDED } from "../../products/format";
import { coChangeText, conservationText, filterRows, maxScore, notices, plainField, windowText } from "../../products/hotspots";
import { projectYears, scoreHistogram, topFiles } from "../../products/hotspots-charts";
import { BarList } from "../shared/BarList";
import { Collapsible } from "../shared/Collapsible";
import { BulletList, Facts, SearchInput, Segmented } from "../shared/Controls";
import { DataTable, SimpleTable } from "../shared/DataTable";
import { AreaSpark, Histogram } from "../shared/HistoryCharts";
import { Note, Notice, Section } from "../shared/Section";
import { isTable, listOf, textsOf, type Table } from "../shared/shape";
import { CountTile, CountTiles, StatTile, StatTiles } from "../shared/Stats";
import type { ViewBodyProps, ViewModule } from "../types";
import HotspotsRowPanel from "./HotspotsRowPanel";
import { isHotspotsRowRef } from "./rowRef";
import { TABLES, type Row } from "./hotspotsTables";

/** The tables of the page, one shown at a time. */
const VIEWS = ["files", "directories", "pairs", "groups"] as const;
type TableName = (typeof VIEWS)[number];
const VIEW_LABELS: Record<TableName, string> = { files: "Files", directories: "Directories", pairs: "Pairs", groups: "Groups" };

/** How many files the top-files chart shows. */
const TOP_FILES = 10;

const mono = (text: ReactNode) => <span className="font-mono text-[11px]">{text}</span>;

function Notices({ product }: { product: Table }) {
  const items = notices(product);
  if (items.length === 0) return null;
  return (
    <Section title="What the history can show" tone="warn">
      {items.map((text) => <p key={text}>{text}</p>)}
    </Section>
  );
}

function History({ product }: { product: Table }) {
  const repos = listOf(product.repos);
  const bots = product.bots;
  return (
    <>
      <Section title="History">
        <Facts
          items={[
            ["Window", windowText(product.window)],
            ["Source kind", plainField(product.sourceKind) || EMPTY],
            ["Commits by bots", bots && typeof bots.commits === "number" ? `${formatNumber(bots.commits)} (author email local part ends in ${String(bots.emailMarker).replace(/@$/, "")}; left out of the shares by author)` : EMPTY],
          ]}
        />
      </Section>
      {repos.length === 0 ? null : (
        <Section title="Repositories read" count={formatNumber(repos.length)}>
          <SimpleTable
            columns={[{ label: "Path" }, { label: "Head", wrap: true }, { label: "Shallow" }, { label: "Boundary commits", num: true }, { label: "Earliest visible commit" }]}
            rows={repos.map((r) => [r.path, mono(String(r.head)), r.shallow ? "yes" : "no", formatNumber(r.boundaryCommits), r.earliestVisibleCommit])}
          />
        </Section>
      )}
    </>
  );
}

/** The project's commits per year, from the product's project-root row; what the product does not give is said, never drawn as 0. */
function YearsChart({ product }: { product: Table }) {
  const years = projectYears(product);
  return (
    <Section title="Commits per year">
      {years.state === "provided" ? (
        <div data-excavator-years={years.points.map((p) => `${p.label}:${p.value}`).join(",")} className="space-y-2">
          <AreaSpark points={years.points} label="Commits per year of the project" />
          <Note>{`${formatNumber(years.total)} commits, as the project root directory row counts them by year.`}</Note>
        </div>
      ) : (
        <Note>{years.state === "no-history" ? "There is no history to count." : `Commits per year: ${NOT_PROVIDED} (no per-year counts for the project root directory).`}</Note>
      )}
    </Section>
  );
}

function ScoresChart({ files }: { files: Row[] }) {
  const hist = scoreHistogram(files);
  return (
    <Section title="File scores">
      {hist.state === "bins" ? <Histogram values={hist.values} edges={hist.edges} label="Files by score" /> : <Note>{`No file has a score above 0 (${formatNumber(hist.scored)} scored).`}</Note>}
      {hist.withoutScore > 0 ? <Note>{`${formatNumber(hist.withoutScore)} file(s) without a score.`}</Note> : null}
    </Section>
  );
}

function Overview({ product, files }: { product: Table; files: Row[] }) {
  const setProductRow = useDashboardStore((s) => s.setProductRow);
  const counts: Table = isTable(product.counts) ? product.counts : {};
  const conservation = conservationText(product.conservation);
  const top = topFiles(files, TOP_FILES);
  const openFile = (path: string) => {
    const row = files.find((f) => f.path === path);
    if (row) setProductRow({ table: "files", row });
  };
  return (
    <>
      <StatTiles>
        <StatTile label="Files with history" value={counts.filesWithHistory} note="selected files with history" />
        <StatTile label="Files without history" value={counts.filesWithoutHistory} note="in no repository read" />
        <StatTile label="Binary files" value={counts.binaryFiles} note="no lines, no score" />
        <StatTile label="Lineage conflicts" value={counts.filesWithLineageConflicts} note="files with lineage conflicts" />
      </StatTiles>
      {conservation === null ? null : <p className="font-mono text-[11px] text-text-muted [overflow-wrap:anywhere]" data-excavator-conservation="">{conservation}</p>}
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <YearsChart product={product} />
        <ScoresChart files={files} />
      </div>
      <Section title={`Top ${TOP_FILES} files by score`}>
        {top.length === 0 ? <Note>No file has a score.</Note> : <BarList rows={top.map((f) => ({ key: f.path, label: f.path, value: f.score }))} label="Files with the highest scores" onSelect={(bar) => openFile(bar.key)} />}
      </Section>
    </>
  );
}

/** A table card with a search box, a "showing" line and the sorted, paged table. `fields` are the texts the search looks in. */
function FilteredTable({ name, title, noun, placeholder, rows, def, max, fields, intro, detail, table }: {
  name: string;
  title: string;
  noun: string;
  placeholder: string;
  rows: Row[];
  def: (typeof TABLES)[keyof typeof TABLES];
  max: number | null;
  fields: ((row: Row) => unknown)[];
  intro?: ReactNode;
  detail?: ReactNode;
  /** The table's rows can be chosen (files and directories); the others have no details. */
  table?: "files" | "directories";
}) {
  const productRow = useDashboardStore((s) => s.productRow);
  const setProductRow = useDashboardStore((s) => s.setProductRow);
  const [query, setQuery] = useState("");
  const matching = useMemo(() => filterRows(rows, query, fields), [rows, query, fields]);
  const columns = useMemo(() => def.columns(max), [def, max]);
  const chosen = isHotspotsRowRef(productRow) && productRow.table === table ? productRow.row : null;
  return (
    <>
      {table ? detail : null}
      <Section title={title} count={`${formatNumber(matching.length)} of ${formatNumber(rows.length)}`}>
        {intro}
        <SearchInput value={query} onChange={setQuery} placeholder={placeholder} />
        <p className="text-xs text-text-muted" data-excavator-shown={name}>{`Showing ${formatNumber(matching.length)} of ${formatNumber(rows.length)} ${noun}`}</p>
        <DataTable
          name={name}
          rows={matching}
          columns={columns}
          initialSort={def.initialSort}
          rowKey={table ? (row) => String(row.path) : undefined}
          onRowClick={table ? (row) => setProductRow({ table, row }) : undefined}
          isSelected={table ? (row) => row === chosen : undefined}
        />
      </Section>
    </>
  );
}

function FeatureGroups({ product, groups }: { product: Table; groups: Row[] }) {
  const summary = product.featureGroups;
  const max = maxScore(groups);
  const columns = useMemo(() => TABLES.groups.columns(max), [max]);
  if (summary === null || summary === undefined) {
    return (
      <Section title="Feature groups">
        <Note>No feature groups in this product.</Note>
      </Section>
    );
  }
  const tiles: [string, unknown][] = [
    ["Groups listed", summary.groupsListed], ["Files in a group", summary.filesInAGroup],
    ["Files in several groups", summary.filesInSeveralGroups], ["Listed paths matching no file", summary.pathsUnmatched],
  ];
  const unmatched = groups.filter((g) => Array.isArray(g.unmatchedPaths) && g.unmatchedPaths.length > 0);
  return (
    <Section title="Feature groups" count={formatNumber(groups.length)}>
      <Note>A group counts only the files its groups file lists, and a file in several groups counts in each.</Note>
      <CountTiles>{tiles.map(([label, value]) => <CountTile key={label} label={label} value={value} />)}</CountTiles>
      <DataTable name="groups" rows={groups} columns={columns} initialSort={TABLES.groups.initialSort} />
      {unmatched.length === 0 ? null : <h4 className="pt-1 text-[10px] uppercase tracking-wider text-text-muted">Listed paths that matched no selected file</h4>}
      {unmatched.map((g) => (
        <details key={g.name}>
          <summary className="max-w-[300px] cursor-pointer truncate font-mono text-[11px] text-text-secondary">{`${g.name} (${g.unmatchedPaths.length})`}</summary>
          <div className="mt-1.5">
            <BulletList mono items={g.unmatchedPaths.map(String)} />
          </div>
        </details>
      ))}
    </Section>
  );
}

const pathFields = [(r: Row) => r.path];
const pairFields = [(r: Row) => r.a, (r: Row) => r.b];

function HotspotsBody({ primary, detail }: ViewBodyProps) {
  const product = isTable(primary) ? primary : null;
  const files = useMemo(() => listOf(product?.files), [product]);
  const directories = useMemo(() => listOf(product?.directories), [product]);
  const pairs = useMemo(() => listOf(product?.pairs), [product]);
  const groups = useMemo(() => listOf(product?.groups), [product]);
  const [table, setTable] = useState<TableName>("files");
  const setProductRow = useDashboardStore((s) => s.setProductRow);
  if (product === null) return <Notice tone="error" title="This product could not be drawn" data-excavator-notice="error">The file is not in the expected shape.</Notice>;
  const rule = coChangeText(product.coChange);
  const coChange: Table = isTable(product.coChange) ? product.coChange : {};
  return (
    <>
      <Notices product={product} />
      <Overview product={product} files={files} />
      <History product={product} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Hotspots tables"
          values={VIEWS}
          labels={VIEW_LABELS}
          value={table}
          onChange={(next) => {
            setTable(next);
            setProductRow(null);
          }}
        />
      </div>
      {table === "files" ? (
        <FilteredTable
          name="files" title="Files" noun="files" placeholder="Search file paths" rows={files} def={TABLES.files} max={maxScore(files)} fields={pathFields} table="files" detail={detail}
          intro={<Note>Score is commits x lines at HEAD. A binary file has no lines and no score. Click a file to see its numbers, the files changed with it and where it is.</Note>}
        />
      ) : null}
      {table === "directories" ? (
        <FilteredTable name="directories" title="Directories" noun="directories" placeholder="Search directory paths" rows={directories} def={TABLES.directories} max={maxScore(directories)} fields={pathFields} table="directories" detail={detail} />
      ) : null}
      {table === "pairs" ? (
        <FilteredTable
          name="pairs" title="Files changed together" noun="pairs" placeholder="Search file paths" rows={pairs} def={TABLES.pairs} max={null} fields={pairFields}
          intro={(
            <div className="space-y-2">
              {rule === null ? <Note>The product records no rule for pairs.</Note> : <p>{rule}</p>}
              <Note>
                {`Commits counted for pairs: ${formatNumber(coChange.commitsCounted)}. Commits over the limit, counted for no pair: ${formatNumber(coChange.commitsOverLimit)}. Pairs listed: ${formatNumber(coChange.pairsListed)}. Pairs below the minimum, not listed: ${formatNumber(coChange.pairsBelowMinimum)}.`}
              </Note>
            </div>
          )}
        />
      ) : null}
      {table === "groups" ? <FeatureGroups product={product} groups={groups} /> : null}
      <Collapsible title="Residual assumptions" count={formatNumber(textsOf(product.residualAssumptions).length)}>
        <BulletList items={textsOf(product.residualAssumptions)} />
      </Collapsible>
    </>
  );
}

export const hotspotsView: ViewModule = { files: ["hotspots.json"], Body: HotspotsBody, Detail: HotspotsRowPanel as ViewModule["Detail"] };

