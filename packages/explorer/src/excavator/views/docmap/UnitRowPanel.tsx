import { EMPTY } from "../../products/format";
import { whereText, type UnitRow } from "../../products/docmap";
import { Badge, type BadgeTone } from "../shared/Controls";
import { Missing, RowDetail, RowFields, RowSection } from "../shared/RowDetail";
import { RowActions } from "../shared/RowActions";
import { Quote } from "../shared/Controls";

const VERDICT_TONE: Record<string, BadgeTone> = { does: "good", not: "bad" };
const CODE_TONE: Record<string, BadgeTone> = { found: "good", "not-found": "warn" };

export const VerdictBadge = ({ verdict }: { verdict: string }) => <Badge tone={VERDICT_TONE[verdict] ?? "neutral"}>{String(verdict)}</Badge>;
export const CodeBadge = ({ status }: { status: string }) => <Badge tone={CODE_TONE[status] ?? "neutral"}>{status}</Badge>;

function EvidenceItem({ item }: { item: UnitRow["evidence"][number] }) {
  const range = item.line === null ? null : [item.line];
  return (
    <li data-excavator-evidence={item.file === null ? "" : `${item.file}:${item.line ?? ""}`} className="min-w-0 space-y-1.5 rounded-lg border border-border-subtle bg-elevated/40 p-3">
      <div className="font-mono text-[11px] text-text-primary [overflow-wrap:anywhere]">{item.file === null ? EMPTY : item.file + (item.line === null ? "" : `:${item.line}`)}</div>
      {item.file === null ? null : <RowActions target={{ kind: "file", path: item.file }} path={item.file} range={range} />}
      {item.code === null ? null : <Quote>{item.code}</Quote>}
      {item.check === null ? (
        <p data-excavator-check="not-checked" className="text-text-muted">Not checked: checks.json has no verdict for this place.</p>
      ) : (
        <p data-excavator-check={item.check.verdict} className="[overflow-wrap:anywhere]">
          <VerdictBadge verdict={item.check.verdict} /> {item.check.reason === null ? <span className="text-text-muted">No reason recorded.</span> : item.check.reason}
        </p>
      )}
    </li>
  );
}

/** The details of a unit: its quote verbatim, where it is, its code status, and each place with its code and verdict. */
export default function UnitRowPanel({ row, onClose }: { row: UnitRow; onClose: () => void }) {
  const where = whereText(row);
  const title = [row.document === null ? EMPTY : row.document, row.id === null ? "" : ` / ${row.id}`, row.title === null ? "" : ` ${row.title}`].join("");
  return (
    <RowDetail kind={`Unit ${row.number}`} title={title} onClose={onClose}>
      <RowFields
        fields={[
          { label: "Document", value: row.document },
          { label: "Id", value: row.id },
          { label: "Title", value: row.title },
          { label: "Where", value: where },
          { label: "Code", value: <CodeBadge status={row.codeStatus} /> },
        ]}
      />
      <RowSection title="Quote">{row.quote === null ? <Missing>{EMPTY}</Missing> : <Quote>{row.quote}</Quote>}</RowSection>
      <RowSection title="Code">
        {row.codeStatus === "found" ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">{row.evidence.map((item, i) => <EvidenceItem key={i} item={item} />)}</ul>
        ) : row.codeStatus === "not-found" ? (
          <div data-excavator-searched={row.searched.length} className="space-y-1.5">
            <p>No code was found. The searches that found none:</p>
            {row.searched.length === 0 ? (
              <Missing>The product lists no search.</Missing>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {row.searched.map((search, i) => (
                  <li key={i} className="min-w-0 rounded-lg border border-border-subtle bg-elevated/40 p-3">
                    <div className="[overflow-wrap:anywhere]">Pattern: <code className="font-mono text-[11px] text-text-primary">{String(search.pattern)}</code></div>
                    <div className="text-text-muted [overflow-wrap:anywhere]">{`Paths: ${Array.isArray(search.paths) && search.paths.length > 0 ? search.paths.join(", ") : EMPTY}`}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <Missing>The code for this unit was not looked for.</Missing>
        )}
      </RowSection>
    </RowDetail>
  );
}
