import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useDashboardStore } from "../../../store";
import type { Translate } from "../../nameTranslations";
import { EMPTY, formatNumber } from "../../products/format";
import {
  bucketRows, candidatesOf, endsWithoutUnit, escalationLines, externalLabel, externalSystems, measurementRows, relationRows, siteText, unitLinks, unitSummaries, unitsOf,
  type ExternalRow, type LinkRow, type RelationRow, type UnitInfo,
} from "../../products/relations";
import { Badge, BulletList, Facts, SearchInput, Segmented } from "../shared/Controls";
import { DataTable, SimpleTable, type Column } from "../shared/DataTable";
import { Note, Notice, Section } from "../shared/Section";
import { isTable, listOf, type Table } from "../shared/shape";
import { StatTile, StatTiles } from "../shared/Stats";
import type { ViewBodyProps, ViewModule } from "../types";
import { ARROW, SiteLink, Target, targetEnglish, targetWords, Translated, useTranslate } from "./names";
import RelationsRowPanel from "./RelationsRowPanel";
import { isRelationsRowRef, type RelationsRowRef } from "./rowRef";

/**
 * The Relations view: the runtime units and what each one calls and receives, the links between units and to
 * external systems, every site with its bucket, and the measurements of the run, all as the relations product states
 * them. The first three read as a map of the product; the sites and measurements are the code-level record. Every
 * site opens its file at its line when the page holds that file's source.
 */

const VIEWS = ["units", "links", "externals", "sites", "measurements"] as const;
type TableName = (typeof VIEWS)[number];
const VIEW_LABELS: Record<TableName, string> = { units: "Units", links: "Links", externals: "External systems", sites: "Sites", measurements: "Measurements" };

const ALL = "all";
const mono = (value: ReactNode) => <span className="font-mono text-[11px]">{value}</span>;
const countsText = (counts: Record<string, number>): string | null => {
  const entries = Object.entries(counts);
  return entries.length === 0 ? null : entries.map(([bucket, n]) => `${bucket} ${formatNumber(n)}`).join(", ");
};

interface Context {
  units: ReadonlyMap<string, UnitInfo>;
  translate?: Translate;
  choose: (ref: RelationsRowRef) => void;
  chosen: unknown;
}

function Notices({ product, coverage, coverageReason }: { product: Table; coverage: Table | null; coverageReason: string | null }) {
  const notAccepted = coverage === null ? [] : listOf(coverage.areas).filter((a) => a.status !== "accepted");
  return (
    <>
      {product.status === "incomplete" ? (
        <Notice tone="warn" title="Incomplete run" data-excavator-notice="incomplete">
          {`The run that wrote this product did not accept every area; the relations below hold only the accepted areas.${notAccepted.length === 0 ? "" : ` Not accepted: ${notAccepted.map((a) => `${a.areaId} (${a.status})`).join(", ")}.`}`}
        </Notice>
      ) : null}
      {coverage === null ? (
        <Notice tone="info" title="Coverage report not in this page" data-excavator-notice="coverage">
          {`${coverageReason ?? "The page holds no coverage report for this product."} The measurements are the relations graph's own; the candidate files, areas and rejections are not shown.`}
        </Notice>
      ) : null}
    </>
  );
}

function Overview({ units, rows, links, externals }: { units: UnitInfo[]; rows: RelationRow[]; links: LinkRow[]; externals: ExternalRow[] }) {
  const runtime = units.filter((u) => u.kind === "runtime").length;
  const linked = rows.filter((r) => r.bucket === "linked").length;
  return (
    <StatTiles>
      <StatTile label="Units" value={units.length} note={`${formatNumber(runtime)} runtime`} />
      <StatTile label="Links between units" value={links.filter((l) => !l.external).length} note="unit pairs per kind with a linked relation" />
      <StatTile label="External systems" value={externals.length} note="as the product names them" />
      <StatTile label="Relations" value={rows.length} note={`${formatNumber(linked)} linked`} />
    </StatTiles>
  );
}

function Buckets({ product }: { product: Table }) {
  const { caller, receiver } = bucketRows(product.buckets);
  const names = [...new Set([...caller.map((r) => r.bucket), ...receiver.map((r) => r.bucket)])];
  const of = (list: typeof caller, bucket: string) => {
    const found = list.find((r) => r.bucket === bucket);
    return found === undefined ? "" : formatNumber(found.count);
  };
  return (
    <Section title="Ends by bucket">
      <Note>Every call site and receiving site the analyzers wrote is in exactly one bucket. A bucket that does not apply to a role shows a dash.</Note>
      <SimpleTable columns={[{ label: "Bucket" }, { label: "Caller ends", num: true }, { label: "Receiver ends", num: true }]} rows={names.map((b) => [b, of(caller, b), of(receiver, b)])} />
    </Section>
  );
}

function Units({ units, rows, links, coverage, ctx }: { units: UnitInfo[]; rows: RelationRow[]; links: LinkRow[]; coverage: Table | null; ctx: Context }) {
  const summaries = useMemo(() => unitSummaries(units, rows), [units, rows]);
  const candidateFiles = new Map(listOf(coverage?.units).map((u) => [u.id, u.candidateFiles]));
  const linkOf = (unit: string, kind: string, target: string) => links.find((l) => l.from === unit && l.kind === kind && l.to === target);
  const unitless = useMemo(() => endsWithoutUnit(rows), [rows]);
  return (
    <Section title="Units" count={formatNumber(units.length)}>
      <Note>What each unit calls and receives, by bucket, and the units and external systems its linked relations reach. Click a target to see the relations.</Note>
      {unitless.total === 0 ? null : (
        <p className="text-xs text-text-muted" data-excavator-unitless={String(unitless.total)}>
          {`${formatNumber(unitless.total)} ends name no unit (${countsText(unitless.byBucket)}): the product keeps an end that failed its quote check as the analyzer wrote it, without its unit, so no unit below counts it. The Sites table lists them.`}
        </p>
      )}
      <ul className="m-0 list-none divide-y divide-border-subtle p-0" data-excavator-units="">
        {summaries.map(({ unit, calls, receives, reaches }) => (
          <li key={unit.id} className="space-y-1 py-2.5" data-excavator-unit={unit.id}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium text-text-primary"><Translated english={unit.name} translate={ctx.translate} /></span>
              {unit.kind === null ? null : <Badge>{unit.kind}</Badge>}
              <span className="font-mono text-[11px] text-text-muted">{unit.root ?? EMPTY}</span>
              {candidateFiles.has(unit.id) ? <span className="text-xs text-text-muted">{`${formatNumber(candidateFiles.get(unit.id))} candidate files`}</span> : null}
            </div>
            <div className="text-xs">
              {countsText(calls) === null && countsText(receives) === null ? (
                <span className="text-text-muted">No call site or receiving site recorded with this unit.</span>
              ) : (
                <span className="flex flex-wrap gap-x-4">
                  <span><span className="text-text-muted">Calls: </span>{countsText(calls) ?? EMPTY}</span>
                  <span><span className="text-text-muted">Receives: </span>{countsText(receives) ?? EMPTY}</span>
                </span>
              )}
            </div>
            {reaches.length === 0 ? null : (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                <span className="text-text-muted">Reaches:</span>
                {reaches.map((reach) => {
                  const link = linkOf(unit.id, reach.kind, reach.target);
                  return (
                    <button
                      key={`${reach.kind}|${reach.target}`}
                      type="button"
                      onClick={() => link && ctx.choose({ table: "links", row: link })}
                      className="cursor-pointer border-0 bg-transparent p-0 text-left text-accent hover:underline"
                    >
                      <Target id={reach.target} units={ctx.units} translate={ctx.translate} />
                      <span className="text-text-muted">{` (${reach.kind}, ${formatNumber(reach.relations)})`}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Links({ links, ctx }: { links: LinkRow[]; ctx: Context }) {
  const columns: Column<LinkRow>[] = useMemo(() => [
    { label: "Kind", key: (l) => l.kind, render: (l) => l.kind },
    { label: "From", key: (l) => targetEnglish(l.from, ctx.units), render: (l) => <Target id={l.from} units={ctx.units} translate={ctx.translate} /> },
    { label: "To", key: (l) => targetEnglish(l.to, ctx.units), render: (l) => <Target id={l.to} units={ctx.units} translate={ctx.translate} /> },
    { label: "Relations", num: true, key: (l) => l.relations.length, render: (l) => formatNumber(l.relations.length) },
    { label: "Caller lines", num: true, key: (l) => l.callerSites, render: (l) => formatNumber(l.callerSites) },
    { label: "Receiver lines", num: true, key: (l) => (l.external ? null : l.receiverSites), render: (l) => (l.external ? null : formatNumber(l.receiverSites)) },
  ], [ctx.units, ctx.translate]);
  return (
    <Section title="Links" count={formatNumber(links.length)}>
      <Note>{`The linked relations grouped by kind, caller unit and receiving unit or external system (${ARROW}). Click a link to see its relations.`}</Note>
      <DataTable name="links" rows={links} columns={columns} initialSort={{ label: "Relations", dir: -1 }} rowKey={(l) => l.key} onRowClick={(row) => ctx.choose({ table: "links", row })} isSelected={(l) => isRelationsRowRef(ctx.chosen) && ctx.chosen.row === l} />
    </Section>
  );
}

function Externals({ externals, ctx }: { externals: ExternalRow[]; ctx: Context }) {
  const columns: Column<ExternalRow>[] = useMemo(() => [
    { label: "System", key: (e) => externalLabel(e.id), render: (e) => <Translated english={externalLabel(e.id)} translate={ctx.translate} /> },
    { label: "Called by", width: "lg", key: (e) => e.units.map((u) => targetEnglish(u, ctx.units)).join(", "), title: (e) => e.units.map((u) => targetEnglish(u, ctx.units)).join(", "), render: (e) => e.units.map((u) => targetEnglish(u, ctx.units)).join(", ") },
    { label: "Relations", num: true, key: (e) => e.relations.length, render: (e) => formatNumber(e.relations.length) },
  ], [ctx.units, ctx.translate]);
  return (
    <Section title="External systems" count={formatNumber(externals.length)}>
      <Note>Each external system the linked relations name, with the units that call it. A call whose system could not be resolved is in the Sites table under address-unresolved.</Note>
      <DataTable name="externals" rows={externals} columns={columns} initialSort={{ label: "Relations", dir: -1 }} rowKey={(e) => e.id} onRowClick={(row) => ctx.choose({ table: "externals", row })} isSelected={(e) => isRelationsRowRef(ctx.chosen) && ctx.chosen.row === e} />
    </Section>
  );
}

function Sites({ rows, ctx, detail }: { rows: RelationRow[]; ctx: Context; detail: ReactNode }) {
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<string>(ALL);
  const buckets = useMemo(() => [ALL, ...new Set(rows.map((r) => r.bucket))], [rows]);
  const labels = useMemo(() => Object.fromEntries(buckets.map((b) => [b, b === ALL ? "All" : `${b} (${formatNumber(rows.filter((r) => r.bucket === b).length)})`])), [buckets, rows]);
  const matching = useMemo(() => {
    const words = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (bucket !== ALL && r.bucket !== bucket) return false;
      if (words === "") return true;
      const hay = [r.kind, r.address, r.reason, ctx.translate && r.reason ? ctx.translate(r.reason) : null, siteText(r.caller), siteText(r.receiver),
        targetWords(r.caller?.unit ?? null, ctx.units, ctx.translate), targetWords(r.external ?? r.receiver?.unit ?? null, ctx.units, ctx.translate)].join(" ").toLowerCase();
      return hay.includes(words);
    });
  }, [rows, bucket, query, ctx.units, ctx.translate]);
  const columns: Column<RelationRow>[] = useMemo(() => [
    { label: "Bucket", key: (r) => r.bucket, render: (r) => r.bucket },
    { label: "Kind", key: (r) => r.kind, render: (r) => r.kind },
    { label: "Address", width: "md", key: (r) => r.address, title: (r) => r.address, render: (r) => (r.address === null ? null : mono(r.address)) },
    { label: "Caller", key: (r) => (r.caller?.unit ? targetEnglish(r.caller.unit, ctx.units) : null), render: (r) => <Target id={r.caller?.unit ?? null} units={ctx.units} translate={ctx.translate} /> },
    { label: "Caller site", width: "lg", key: (r) => siteText(r.caller), title: (r) => siteText(r.caller), render: (r) => <SiteLink site={r.caller} /> },
    { label: "Receiver", key: (r) => { const t = r.external ?? r.receiver?.unit ?? null; return t === null ? null : targetEnglish(t, ctx.units); }, render: (r) => <Target id={r.external ?? r.receiver?.unit ?? null} units={ctx.units} translate={ctx.translate} /> },
    { label: "Receiver site", width: "lg", key: (r) => siteText(r.receiver), title: (r) => siteText(r.receiver), render: (r) => <SiteLink site={r.receiver} /> },
    { label: "Reason", width: "lg", key: (r) => r.reason, title: (r) => r.reason, render: (r) => (r.reason === null ? null : <Translated english={r.reason} translate={ctx.translate} />) },
  ], [ctx.units, ctx.translate]);
  return (
    <>
      {detail}
      <Section title="Sites" count={`${formatNumber(matching.length)} of ${formatNumber(rows.length)}`}>
        <Note>Every relation with its bucket: a linked pair, or a caller or receiver end alone. A site opens its file at its line. Click a row for the quotes and the lines that prove the address.</Note>
        <Segmented label="Bucket" values={buckets} labels={labels} value={bucket} onChange={setBucket} />
        <SearchInput value={query} onChange={setQuery} placeholder="Search units, addresses, files and reasons" />
        <p className="text-xs text-text-muted" data-excavator-shown="sites">{`Showing ${formatNumber(matching.length)} of ${formatNumber(rows.length)} relations`}</p>
        <DataTable name="sites" rows={matching} columns={columns} rowKey={(r) => r.id} onRowClick={(row) => ctx.choose({ table: "sites", row })} isSelected={(r) => isRelationsRowRef(ctx.chosen) && ctx.chosen.row === r} />
      </Section>
    </>
  );
}

const rate = (value: number | null) => (value === null ? null : String(value));

function Measurements({ product, coverage }: { product: Table; coverage: Table | null }) {
  const measurements = coverage?.measurements ?? product.measurements;
  const rows = measurementRows(measurements);
  const lines = escalationLines(coverage === null ? candidatesOf(measurements) : coverage.escalationCandidates, measurements, coverage?.thresholds ?? null);
  const files: Table | null = coverage !== null && isTable(coverage.files) ? coverage.files : null;
  const notCited = listOf(files?.rows).filter((r) => r.status !== "cited");
  const outOfScope = isTable(product.outOfScope) ? Object.entries(product.outOfScope) : [];
  const rejections = coverage !== null && isTable(coverage.rejections) ? Object.entries(coverage.rejections).filter(([, n]) => typeof n === "number" && n > 0) : [];
  const conservation = coverage !== null && isTable(coverage.conservation) ? coverage.conservation : null;
  return (
    <>
      <Section title="Measurements per kind" count={formatNumber(rows.length)}>
        <Note>{`As ${coverage === null ? "the relations graph" : "the coverage report"} records them. The agreement compares the linked relations with the previous run on the same input.`}</Note>
        <SimpleTable
          columns={[{ label: "Kind" }, { label: "Ends", num: true }, { label: "Quote failed", num: true }, { label: "Quote failure rate", num: true }, { label: "Unresolved", num: true }, { label: "Unresolved share", num: true }, { label: "Linked", num: true }, { label: "Agreement" }, { label: "Escalation" }]}
          rows={rows.map((r) => [r.kind, formatNumber(r.ends), formatNumber(r.quoteFailed), rate(r.quoteFailureRate), formatNumber(r.unresolved), rate(r.unresolvedShare), formatNumber(r.linked), r.agreement, r.escalation.join(", ")])}
        />
      </Section>
      <Section title="Escalation candidates" count={formatNumber(lines.length)}>
        {lines.length === 0 ? <Note>No kind is an escalation candidate.</Note> : <BulletList items={lines} />}
      </Section>
      {files === null ? null : (
        <Section title="Candidate files" count={formatNumber(listOf(files.rows).length)}>
          <Facts items={(isTable(files.buckets) ? Object.entries(files.buckets) : []).map(([b, n]) => [b, formatNumber(n)] as const)} />
          {notCited.length === 0 ? <Note>Every candidate file is cited.</Note> : (
            <ul className="m-0 list-none divide-y divide-border-subtle p-0 text-xs" data-excavator-uncited="">
              {notCited.map((r) => (
                <li key={String(r.file)} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                  <SiteLink site={{ file: typeof r.file === "string" ? r.file : null, line: null }} />
                  <span className="text-text-muted">{String(r.status)}</span>
                  {typeof r.reason === "string" ? <span>{r.reason}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      {coverage === null ? null : (
        <Section title="Checks of the run">
          <Facts
            items={[
              ["Conservation", conservation === null ? EMPTY : `${conservation.ok ? "holds" : "fails"}: ${formatNumber(conservation.endsIn)} ends written, ${formatNumber(conservation.inBuckets)} in buckets, ${formatNumber(conservation.duplicates)} duplicates`],
              ["Areas", `${formatNumber(listOf(coverage.areas).length)} (${formatNumber(listOf(coverage.areas).filter((a) => a.status === "accepted").length)} accepted)`],
              ["Rejected ends", rejections.length === 0 ? "none" : rejections.map(([r, n]) => `${r} ${formatNumber(n)}`).join(", ")],
              ["Out of scope", outOfScope.length === 0 ? "none" : outOfScope.map(([k, n]) => `${k} ${formatNumber(n)}`).join(", ")],
            ]}
          />
        </Section>
      )}
    </>
  );
}

function RelationsBody({ primary, secondary, state, detail }: ViewBodyProps) {
  const product = isTable(primary) ? primary : null;
  const coverage = isTable(secondary) ? secondary : null;
  const translate = useTranslate();
  const units = useMemo(() => unitsOf(product), [product]);
  const rows = useMemo(() => relationRows(product), [product]);
  const links = useMemo(() => unitLinks(rows), [rows]);
  const externals = useMemo(() => externalSystems(product, rows), [product, rows]);
  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const chosen = useDashboardStore((s) => s.productRow);
  // A relation or an external system chosen from the graph (the node panel, an external system's node) opens on its
  // table, also when the view is already open on another one.
  const [table, setTable] = useState<TableName>(() => (isRelationsRowRef(chosen) && chosen.table !== "links" ? chosen.table : "units"));
  const revealed = isRelationsRowRef(chosen) && chosen.reveal === true && chosen.table !== "links" ? chosen.table : null;
  useEffect(() => {
    if (revealed !== null) setTable(revealed);
  }, [chosen, revealed]);
  const setProductRow = useDashboardStore((s) => s.setProductRow);
  if (product === null) return <Notice tone="error" title="This product could not be drawn" data-excavator-notice="error">The file is not in the expected shape.</Notice>;
  const ctx: Context = { units: unitMap, translate, chosen, choose: (ref) => setProductRow(ref) };
  return (
    <>
      <Notices product={product} coverage={coverage} coverageReason={state.coverage?.reason ?? null} />
      <Overview units={units} rows={rows} links={links} externals={externals} />
      <Buckets product={product} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Relations tables"
          values={VIEWS}
          labels={VIEW_LABELS}
          value={table}
          onChange={(next) => {
            setTable(next);
            setProductRow(null);
          }}
        />
      </div>
      {table !== "sites" && table !== "measurements" ? detail : null}
      {table === "units" ? <Units units={units} rows={rows} links={links} coverage={coverage} ctx={ctx} /> : null}
      {table === "links" ? <Links links={links} ctx={ctx} /> : null}
      {table === "externals" ? <Externals externals={externals} ctx={ctx} /> : null}
      {table === "sites" ? <Sites rows={rows} ctx={ctx} detail={detail} /> : null}
      {table === "measurements" ? <Measurements product={product} coverage={coverage} /> : null}
    </>
  );
}

export const relationsView: ViewModule = {
  files: ["relations-graph.json", "relations-coverage.json"],
  Body: RelationsBody,
  Detail: RelationsRowPanel as ViewModule["Detail"],
};
