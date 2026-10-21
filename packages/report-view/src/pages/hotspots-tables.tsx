/**
 * The columns of each Hotspots table and the column it starts sorted by (by
 * label), kept together so a test can read them. A cell the product lacks says
 * so and is never 0.
 */

import { scoreCell } from '../components/ScoreCell';
import { sparkline } from '../components/Sparkline';
import { CodeLink } from '../components/ui/CodeLink';
import type { Column } from '../components/ui/DataTable';
import { NOT_PROVIDED, formatNumber } from '../lib/format';
import { dateText, numberField, plainField, timeKey, yearSeries, yearText } from '../lib/hotspots';

export type Row = Record<string, any>;

const numColumn = (label: string, field: string): Column<Row> => ({ label, num: true, key: (r) => r[field], render: (r) => numberField(r[field]) });

const lastChangedColumn = (): Column<Row> => ({
  label: 'Last changed',
  key: (r) => timeKey(r.lastChanged),
  title: (r) => (typeof r.lastChanged === 'string' ? r.lastChanged : null),
  render: (r) => dateText(r.lastChanged),
});

const concentration = (r: Row, field: string) => {
  if (r.concentration === undefined) return undefined;
  return r.concentration === null ? null : r.concentration[field];
};

/** The columns a directory row and a group row share: counts, score, commits by year and the shares by author. */
export function statColumns(max: number | null): Column<Row>[] {
  const share = (field: string) => (r: Row) => {
    const v = concentration(r, field);
    return v === undefined ? NOT_PROVIDED : v === null ? null : String(v);
  };
  const people = (field: string) => (r: Row) => {
    const v = concentration(r, field);
    return v === undefined ? NOT_PROVIDED : numberField(v);
  };
  return [
    { label: 'Score', num: true, key: (r) => r.score, render: (r) => scoreCell(r.score, max) },
    numColumn('Commits', 'commits'),
    numColumn('Authors', 'authors'),
    {
      label: 'Commits by year',
      key: (r) => {
        const s = yearSeries(r.commitsByYear);
        return s && s.length > 0 ? s[s.length - 1].commits : null;
      },
      title: (r) => {
        const s = yearSeries(r.commitsByYear);
        return s ? yearText(s) : null;
      },
      render: (r) => sparkline(r.commitsByYear),
    },
    numColumn('Files', 'files'),
    numColumn('Lines', 'lines'),
    numColumn('Added', 'added'),
    numColumn('Removed', 'removed'),
    lastChangedColumn(),
    { label: 'Commits by people', num: true, key: (r) => concentration(r, 'commitsByPeople'), render: people('commitsByPeople') },
    { label: 'Top author share', num: true, key: (r) => concentration(r, 'topAuthorShare'), render: share('topAuthorShare') },
    { label: 'Authors for 80%', num: true, key: (r) => concentration(r, 'authorsFor80Percent'), render: people('authorsFor80Percent') },
  ];
}

export interface TableDef {
  initialSort: { label: string; dir: 1 | -1 };
  columns: (max: number | null) => Column<Row>[];
}

export const TABLES: Record<'files' | 'directories' | 'pairs' | 'groups', TableDef> = {
  files: {
    initialSort: { label: 'Score', dir: -1 },
    columns: (max) => [
      { label: 'Path', width: 'xl', key: (r) => r.path, title: (r) => r.path, render: (r) => <CodeLink path={r.path} /> },
      { label: 'Score', num: true, key: (r) => r.score, render: (r) => scoreCell(r.score, max) },
      numColumn('Commits', 'commits'),
      numColumn('Authors', 'authors'),
      numColumn('Added', 'added'),
      numColumn('Removed', 'removed'),
      numColumn('Lines', 'lines'),
      lastChangedColumn(),
      numColumn('Lineage conflicts', 'lineageConflicts'),
    ],
  },
  directories: {
    initialSort: { label: 'Score', dir: -1 },
    columns: (max) => [
      { label: 'Directory', width: 'xl', key: (r) => r.path, title: (r) => (r.path === '.' ? '. (the project root)' : r.path), render: (r) => r.path },
      ...statColumns(max),
    ],
  },
  pairs: {
    initialSort: { label: 'Together', dir: -1 },
    columns: () => [
      numColumn('Together', 'together'),
      { label: 'Share of A', num: true, key: (r) => r.shareOfA, render: (r) => plainField(r.shareOfA) },
      { label: 'Share of B', num: true, key: (r) => r.shareOfB, render: (r) => plainField(r.shareOfB) },
      { label: 'File A', width: 'xl', key: (r) => r.a, title: (r) => r.a, render: (r) => <CodeLink path={r.a} /> },
      { label: 'File B', width: 'xl', key: (r) => r.b, title: (r) => r.b, render: (r) => <CodeLink path={r.b} /> },
    ],
  },
  groups: {
    initialSort: { label: 'Score', dir: -1 },
    columns: (max) => [
      { label: 'Group', width: 'lg', key: (r) => r.name, title: (r) => r.name, render: (r) => r.name },
      ...statColumns(max),
      {
        label: 'Unmatched paths',
        num: true,
        key: (r) => (Array.isArray(r.unmatchedPaths) ? r.unmatchedPaths.length : null),
        render: (r) => (Array.isArray(r.unmatchedPaths) ? formatNumber(r.unmatchedPaths.length) : NOT_PROVIDED),
      },
    ],
  },
};
