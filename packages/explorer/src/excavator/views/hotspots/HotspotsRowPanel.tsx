import { useMemo } from "react";
import { useDashboardStore } from "../../../store";
import { formatNumber, NOT_PROVIDED } from "../../products/format";
import { yearSeries } from "../../products/hotspots";
import { coChanged } from "../../products/hotspots-charts";
import { AreaSpark } from "../shared/HistoryCharts";
import { LinkButton } from "../shared/Controls";
import { Missing, RowDetail, RowSection, TextFields } from "../shared/RowDetail";
import { RowActions } from "../shared/RowActions";
import { listOf } from "../shared/shape";
import { useProductFile } from "../productFiles";
import { directoryFields, fileFields } from "../rowFields";
import { isHotspotsRowRef, type HotspotsRowRef } from "./rowRef";

/** How many files the changed-together list shows. */
const CO_CHANGE_SHOWN = 5;

/** A row's commits per year: the row's own `commitsByYear` when the product gives one; else it is said to be missing. */
function Years({ row }: { row: Record<string, any> }) {
  const series = yearSeries(row.commitsByYear);
  if (series !== null) {
    return (
      <div data-excavator-row-years={series.map((p) => `${p.year}:${p.commits}`).join(",")}>
        <AreaSpark points={series.map((p) => ({ label: p.year, value: p.commits }))} label={`Commits per year of ${row.path}`} />
      </div>
    );
  }
  return <Missing>{row.commitsByYear === null ? "There is no history to count." : NOT_PROVIDED}</Missing>;
}

function FilePanel({ row, onClose }: { row: Record<string, any>; onClose: () => void }) {
  const setProductRow = useDashboardStore((s) => s.setProductRow);
  const file = useProductFile("hotspots.json");
  const product = file?.state === "ready" && file.value !== null && typeof file.value === "object" ? (file.value as Record<string, unknown>) : null;
  const files = useMemo(() => listOf(product?.files), [product]);
  const together = coChanged(product?.pairs, row.path, CO_CHANGE_SHOWN);
  const open = (path: string) => {
    const target = files.find((f) => f.path === path);
    if (target) setProductRow({ table: "files", row: target });
  };
  return (
    <RowDetail kind="File" title={String(row.path)} onClose={onClose}>
      <RowActions target={{ kind: "file", path: String(row.path) }} path={String(row.path)} />
      <TextFields fields={fileFields(row)} />
      <RowSection title="Commits per year">
        <Years row={row} />
      </RowSection>
      <RowSection title="Changed together most">
        {together.length === 0 ? (
          <Missing>The product lists no pair with this file.</Missing>
        ) : (
          <ol data-excavator-co-change={together.map((t) => `${t.path}:${t.together}`).join(",")} className="m-0 flex list-none flex-col gap-1 p-0">
            {together.map((t) => (
              <li key={t.path} className="flex items-baseline justify-between gap-3 [overflow-wrap:anywhere]">
                {files.some((f) => f.path === t.path) ? <LinkButton title={`Open ${t.path}`} onClick={() => open(t.path)}>{t.path}</LinkButton> : <span className="font-mono text-[11px]">{t.path}</span>}
                <span className="shrink-0 font-mono text-[11px] text-text-muted">{`${formatNumber(t.together)} together`}</span>
              </li>
            ))}
          </ol>
        )}
      </RowSection>
    </RowDetail>
  );
}

function DirectoryPanel({ row, onClose }: { row: Record<string, any>; onClose: () => void }) {
  return (
    <RowDetail kind="Directory" title={row.path === "." ? ". (the project root)" : String(row.path)} onClose={onClose}>
      <RowActions target={{ kind: "directory", path: String(row.path) }} path={null} />
      <TextFields fields={directoryFields(row)} />
      <RowSection title="Commits per year">
        <Years row={row} />
      </RowSection>
    </RowDetail>
  );
}

/** The details of a chosen file or directory row of the Hotspots view. */
export default function HotspotsRowPanel({ row, onClose }: { row: HotspotsRowRef | unknown; onClose: () => void }) {
  if (!isHotspotsRowRef(row)) return null;
  return row.table === "files" ? <FilePanel row={row.row} onClose={onClose} /> : <DirectoryPanel row={row.row} onClose={onClose} />;
}
