import { useMemo } from "react";
import { useDashboardStore } from "../../../store";
import type { Translate } from "../../nameTranslations";
import { EMPTY, formatNumber } from "../../products/format";
import { BUCKET_WORDS, externalLabel, missingEndText, unitsOf, type RelationRow, type RelationSite, type UnitInfo } from "../../products/relations";
import { useProductFile } from "../productFiles";
import { Quote } from "../shared/Controls";
import { Missing, RowDetail, RowFields, RowSection } from "../shared/RowDetail";
import { RowActions } from "../shared/RowActions";
import { ARROW, SiteLink, Target, targetEnglish, Translated, useTranslate } from "./names";
import { isRelationsRowRef, type RelationsRowRef } from "./rowRef";

/** The product's units by id, for naming the units a row refers to. */
function useUnits(): ReadonlyMap<string, UnitInfo> {
  const file = useProductFile("relations-graph.json");
  return useMemo(() => new Map(unitsOf(file?.state === "ready" ? file.value : null).map((u) => [u.id, u])), [file]);
}

/** One end: its unit, its quote, the moves to its node and its code, and the lines that prove its address. */
function SiteSection({ title, site, units, translate }: { title: string; site: RelationSite; units: ReadonlyMap<string, UnitInfo>; translate?: Translate }) {
  return (
    <RowSection title={title}>
      <RowFields fields={[{ label: "Unit", value: <Target id={site.unit} units={units} translate={translate} /> }, { label: "Site", value: <SiteLink site={site} /> }]} />
      {site.quote === null ? <Missing>No quote recorded.</Missing> : <Quote>{site.quote}</Quote>}
      <RowActions
        target={site.nodeId !== null ? { kind: "node", nodeId: site.nodeId } : site.file !== null ? { kind: "file", path: site.file } : null}
        path={site.file}
        range={site.line}
      />
      {site.evidence.length === 0 ? null : (
        <ul className="m-0 list-none divide-y divide-border-subtle p-0" aria-label={`${title} evidence`}>
          {site.evidence.map((e, i) => (
            <li key={i} className="space-y-1 py-1.5">
              <div className="text-text-muted">
                {"Evidence "}
                <SiteLink site={e} />
              </div>
              {e.quote === null ? null : <Quote>{e.quote}</Quote>}
            </li>
          ))}
        </ul>
      )}
    </RowSection>
  );
}

/** An end the relation has no site for, with the sentence that says why; nothing when the other end already says it. */
function MissingEnd({ title, text }: { title: string; text: string | null }) {
  if (text === null) return null;
  return <RowSection title={title}><Missing>{text}</Missing></RowSection>;
}

function RelationPanel({ row, onClose }: { row: RelationRow; onClose: () => void }) {
  const units = useUnits();
  const translate = useTranslate();
  return (
    <RowDetail kind="Relation" title={row.address ?? `${row.kind ?? "no kind"} ${row.bucket}`} onClose={onClose}>
      <RowFields
        fields={[
          { label: "Kind", value: row.kind ?? "none recorded as a string" },
          { label: "Bucket", value: `${row.bucket}: ${BUCKET_WORDS[row.bucket] ?? "a bucket this page does not describe"}` },
          { label: "Address", value: row.address },
          { label: "Reason", value: row.reason === null ? null : <Translated english={row.reason} translate={translate} /> },
          { label: "Confidence", value: row.confidence },
          { label: "Area", value: row.area },
          ...(row.targetUnitMissed ? [{ label: "Target unit", value: "the unit the analyzer named had no receiver with this address; paired across every other unit" }] : []),
        ]}
      />
      {row.caller === null ? <MissingEnd title="Caller" text={missingEndText(row, "caller")} /> : <SiteSection title="Caller" site={row.caller} units={units} translate={translate} />}
      {row.external !== null ? (
        <RowSection title="External system">
          <Translated english={externalLabel(row.external)} translate={translate} />
        </RowSection>
      ) : row.receiver === null ? (
        <MissingEnd title="Receiver" text={missingEndText(row, "receiver")} />
      ) : (
        <SiteSection title="Receiver" site={row.receiver} units={units} translate={translate} />
      )}
      {row.candidates.length === 0 ? null : (
        <RowSection title="Candidate receivers">
          <ul className="m-0 list-none divide-y divide-border-subtle p-0">
            {row.candidates.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                <Target id={c.unit} units={units} translate={translate} />
                <SiteLink site={c} />
                <span className="font-mono text-[11px] text-text-muted">{c.addressKey ?? EMPTY}</span>
              </li>
            ))}
          </ul>
        </RowSection>
      )}
    </RowDetail>
  );
}

/** The relations of a link or an external system, each opening its own details. */
function RelationList({ rows, units, translate }: { rows: readonly RelationRow[]; units: ReadonlyMap<string, UnitInfo>; translate?: Translate }) {
  const setProductRow = useDashboardStore((s) => s.setProductRow);
  if (rows.length === 0) return <Missing>No linked relation.</Missing>;
  return (
    <ul className="m-0 list-none divide-y divide-border-subtle p-0" data-excavator-relation-list="">
      {rows.map((row) => (
        <li key={row.id} className="space-y-0.5 py-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <SiteLink site={row.caller} />
            <span className="text-text-muted">{ARROW}</span>
            {row.external !== null ? <Target id={row.external} units={units} translate={translate} /> : <SiteLink site={row.receiver} />}
          </div>
          <button
            type="button"
            onClick={() => setProductRow({ table: "sites", row } satisfies RelationsRowRef)}
            className="cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-[11px] text-text-muted hover:text-accent"
          >
            {row.address ?? row.kind ?? row.bucket}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The details of a chosen relation, link or external system of the Relations view. */
export default function RelationsRowPanel({ row, onClose }: { row: RelationsRowRef | unknown; onClose: () => void }) {
  const units = useUnits();
  const translate = useTranslate();
  if (!isRelationsRowRef(row)) return null;
  if (row.table === "sites") return <RelationPanel row={row.row} onClose={onClose} />;
  if (row.table === "links") {
    const link = row.row;
    return (
      <RowDetail kind={`Link (${link.kind})`} title={`${targetEnglish(link.from, units)} ${ARROW} ${targetEnglish(link.to, units)}`} onClose={onClose}>
        <RowFields
          fields={[
            { label: "From", value: <Target id={link.from} units={units} translate={translate} /> },
            { label: "To", value: <Target id={link.to} units={units} translate={translate} /> },
            { label: "Relations", value: formatNumber(link.relations.length) },
            { label: "Caller lines", value: formatNumber(link.callerSites) },
            { label: "Receiver lines", value: link.external ? "an external system has none" : formatNumber(link.receiverSites) },
          ]}
        />
        <RowSection title="Relations">
          <RelationList rows={link.relations} units={units} translate={translate} />
        </RowSection>
      </RowDetail>
    );
  }
  const system = row.row;
  return (
    <RowDetail kind="External system" title={externalLabel(system.id)} onClose={onClose}>
      <RowFields
        fields={[
          { label: "Shown as", value: <Translated english={externalLabel(system.id)} translate={translate} /> },
          { label: "Id", value: system.id },
          { label: "Called by", value: system.units.length === 0 ? null : <span>{system.units.map((u, i) => <span key={u}>{i > 0 ? ", " : ""}<Target id={u} units={units} translate={translate} /></span>)}</span> },
          ...(system.names === null ? [] : [{ label: "Names written", value: system.names.join(", ") }]),
          ...(system.hosts === null ? [] : [{ label: "Hosts written", value: system.hosts.join(", ") }]),
          ...(system.keyBy === null ? [] : [{ label: "Keyed by", value: system.keyBy.join(", ") }]),
        ]}
      />
      <RowSection title="Relations">
        <RelationList rows={system.relations} units={units} translate={translate} />
      </RowSection>
    </RowDetail>
  );
}
