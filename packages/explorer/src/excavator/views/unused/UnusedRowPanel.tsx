import { useMemo } from "react";
import { useDashboardStore } from "../../../store";
import { NOT_PROVIDED, formatNumber } from "../../products/format";
import { normalizeRow, type UnusedRow } from "../../products/unused";
import { groupMates, referrerList } from "../../products/unused-related";
import { BulletList, LinkButton } from "../shared/Controls";
import { Missing, RowDetail, RowFields, RowSection } from "../shared/RowDetail";
import { RowActions } from "../shared/RowActions";
import { listOf } from "../shared/shape";
import { useProductFile } from "../productFiles";
import { unusedFields } from "../rowFields";
import { confidenceBadge } from "./confidence";

const signalDetail = (signal: Record<string, unknown>) => {
  const { signal: name, ...rest } = signal;
  return Object.keys(rest).length === 0 ? String(name) : `${String(name)} ${JSON.stringify(rest)}`;
};

/** A function the panel names: a button that opens its own row when it is on the unused list, else its id as text. */
function Related({ id, name, listed, note, onOpen }: { id: string; name: string | null; listed: boolean; note?: string; onOpen: (id: string) => void }) {
  const label = name === null ? id : `${name} (${id})`;
  return (
    <li className="[overflow-wrap:anywhere]">
      {listed ? <LinkButton title={`Open ${id}`} onClick={() => onOpen(id)}>{label}</LinkButton> : <span className="font-mono text-[11px]">{id}</span>}
      {note ? <span className="text-text-muted">{` ${note}`}</span> : null}
    </li>
  );
}

/** The details of an unused function: its fields and signals, its group, its referrers, where it is. */
export default function UnusedRowPanel({ row, onClose }: { row: UnusedRow; onClose: () => void }) {
  const setProductRow = useDashboardStore((s) => s.setProductRow);
  const file = useProductFile("unused-code.json");
  const product = file?.state === "ready" && file.value !== null && typeof file.value === "object" ? (file.value as Record<string, unknown>) : null;
  const byId = useMemo(() => new Map(listOf(product?.unused).map(normalizeRow).map((r) => [r.id, r])), [product]);
  const mates = groupMates(product?.groups, row);
  const referrers = referrerList(row, new Set(byId.keys()));
  const nameOf = (id: string) => byId.get(id)?.name ?? null;
  const open = (id: string) => {
    const target = byId.get(id);
    if (target) setProductRow(target);
  };
  return (
    <RowDetail kind="Unused function" title={row.name ?? row.id} onClose={onClose}>
      <RowActions target={{ kind: "node", nodeId: row.id }} path={row.file} range={row.lineRange} />
      <RowFields fields={unusedFields(row).map((f) => ({ label: f.label, value: f.label === "Confidence" ? confidenceBadge(row.confidence) : f.text }))} />
      <RowSection title="Signals">
        {row.signals.length === 0 ? <Missing>The product records no signal.</Missing> : <BulletList mono items={row.signals.map((sig) => signalDetail(sig as Record<string, unknown>))} />}
      </RowSection>
      <RowSection title="Group">
        {mates.state === "no-group" ? <Missing>The row names no group.</Missing> : null}
        {mates.state === "not-listed" ? <Missing>{`The product's groups list has no group ${mates.group}.`}</Missing> : null}
        {mates.state === "listed" ? (
          <div data-excavator-group={mates.group} data-excavator-group-others={mates.others.length} className="space-y-1.5">
            <p className="text-text-muted">{`Group ${mates.group}: ${formatNumber(mates.others.length + 1)} member(s), entries: ${mates.entries.length === 0 ? "none listed" : mates.entries.join(", ")}.`}</p>
            {mates.others.length === 0 ? (
              <Missing>No other member.</Missing>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {mates.others.map((id) => <Related key={id} id={id} name={nameOf(id)} listed={byId.has(id)} note={mates.entries.includes(id) ? "(entry)" : undefined} onOpen={open} />)}
              </ul>
            )}
          </div>
        ) : null}
      </RowSection>
      <RowSection title="Referrers">
        {referrers.state === "not-provided" ? <Missing>{NOT_PROVIDED}</Missing> : referrers.referrers.length === 0 ? <Missing>The product records no referrer.</Missing> : (
          <ul data-excavator-referrers={referrers.referrers.length} className="m-0 flex list-none flex-col gap-1 p-0">
            {referrers.referrers.map((r) => <Related key={`${r.id} ${r.edge}`} id={r.id} name={nameOf(r.id)} listed={r.listed} note={r.edge === null ? undefined : `(${r.edge}${r.reverse ? ", reverse" : ""})`} onOpen={open} />)}
          </ul>
        )}
      </RowSection>
    </RowDetail>
  );
}
