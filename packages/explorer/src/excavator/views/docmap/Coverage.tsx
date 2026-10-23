import { useMemo, useState } from "react";
import { unitList } from "../../products/docmap";
import { formatNumber } from "../../products/format";
import { BulletList, ChipGroup, SearchInput } from "../shared/Controls";
import { type Column, DataTable, SimpleTable } from "../shared/DataTable";
import { Note, Section } from "../shared/Section";
import { isTable, listOf, textsOf, type Table } from "../shared/shape";
import { CountTile, CountTiles } from "../shared/Stats";

const mono = (text: unknown) => <span className="font-mono text-[11px]">{String(text)}</span>;
const withEvidence = (f: Table) => Array.isArray(f.units) && f.units.length > 0;

/** The coverage record: the code files with and without evidence, by directory and by file, and the evidence outside the code files. */
export function Coverage({ coverage }: { coverage: unknown }) {
  const data = isTable(coverage) ? coverage : null;
  const directories = listOf(data?.directories);
  const files = listOf(data?.files);
  const [filter, setFilter] = useState<{ evidence: string[]; text: string }>({ evidence: [], text: "" });
  const matching = useMemo(() => {
    const text = filter.text.trim().toLowerCase();
    return files.filter((f) => (filter.evidence.length === 0 || filter.evidence.includes(withEvidence(f) ? "with evidence" : "without evidence")) && (text === "" || String(f.path).toLowerCase().includes(text)));
  }, [files, filter]);

  const directoryColumns = useMemo<Column<Table>[]>(() => [
    { label: "Directory", width: "xl", key: (d) => d.path, title: (d) => d.path, render: (d) => mono(d.path) },
    { label: "Code files", num: true, key: (d) => d.files, render: (d) => formatNumber(d.files) },
    { label: "With evidence", num: true, key: (d) => d.withEvidence, render: (d) => formatNumber(d.withEvidence) },
    { label: "Units", width: "lg", key: (d) => (d.units ? d.units.length : null), title: (d) => unitList(d.units), render: (d) => unitList(d.units) },
  ], []);
  const fileColumns = useMemo<Column<Table>[]>(() => [
    { label: "File", width: "xl", key: (f) => f.path, title: (f) => f.path, render: (f) => mono(f.path) },
    { label: "Evidence", key: (f) => (withEvidence(f) ? 1 : 0), render: (f) => (withEvidence(f) ? "with evidence" : "without evidence") },
    { label: "Units", width: "lg", key: (f) => (f.units ? f.units.length : null), title: (f) => unitList(f.units), render: (f) => unitList(f.units) },
  ], []);

  if (data === null) {
    return (
      <Section title="Coverage">
        <Note>{"The product has no coverage yet: /excavator-doc-map has not counted the project's code files."}</Note>
      </Section>
    );
  }
  const c: Table = isTable(data.counts) ? data.counts : {};
  const tiles: [string, unknown][] = [
    ["Files analysed", c.files], ["Documents", c.documents], ["Code files", c.code], ["With evidence", c.withEvidence],
    ["Without evidence", c.withoutEvidence], ["Pieces of evidence", c.evidence], ["Not in a code file", c.outside],
  ];
  const outside = listOf(data.outside);
  const documents = textsOf(data.documents);
  return (
    <>
      <Section title="Coverage">
        <Note>{"A code file without evidence means only that no unit's evidence is in it."}</Note>
        <CountTiles>{tiles.map(([label, value]) => <CountTile key={label} label={label} value={value} />)}</CountTiles>
      </Section>
      <Section title="Coverage by directory" count={formatNumber(directories.length)}>
        <DataTable name="coverage-directories" rows={directories} columns={directoryColumns} />
      </Section>
      <Section title="Coverage by file" count={`${formatNumber(matching.length)} of ${formatNumber(files.length)}`}>
        <SearchInput value={filter.text} onChange={(text) => setFilter((f) => ({ ...f, text }))} placeholder="Search code file paths" />
        <ChipGroup
          label="Evidence"
          values={["with evidence", "without evidence"]}
          selected={filter.evidence}
          onToggle={(v) => setFilter((f) => ({ ...f, evidence: f.evidence.includes(v) ? f.evidence.filter((x) => x !== v) : [...f.evidence, v] }))}
        />
        <p className="text-xs text-text-muted">{`Showing ${formatNumber(matching.length)} of ${formatNumber(files.length)} code files`}</p>
        <DataTable name="coverage-files" rows={matching} columns={fileColumns} />
      </Section>
      <Section title="Evidence outside the code files" count={formatNumber(outside.length)}>
        {outside.length === 0 ? (
          <Note>Every piece of evidence is in a code file of the facts.</Note>
        ) : (
          <SimpleTable
            columns={[{ label: "Unit", num: true }, { label: "File", wrap: true }, { label: "Line", num: true }]}
            rows={outside.map((o) => [formatNumber(o.unit), typeof o.file === "string" ? mono(o.file) : null, formatNumber(o.line)])}
          />
        )}
      </Section>
      <Section title="Documents among the facts" count={formatNumber(documents.length)}>
        {documents.length === 0 ? <Note>No fact file counts as a document.</Note> : <BulletList mono items={documents} />}
      </Section>
    </>
  );
}
