import { useMemo, useState, type ReactNode } from 'react';

import { ProductPage } from '../components/ProductPage';
import { Card } from '../components/ui/Card';
import { BulletList, Facts, SearchInput } from '../components/ui/Controls';
import { DataTable, SimpleTable } from '../components/ui/DataTable';
import { Tile, Tiles } from '../components/ui/Tile';
import { useCounts } from '../hooks/use-signals';
import { EMPTY, formatNumber } from '../lib/format';
import { coChangeText, conservationText, filterRows, maxScore, notices, plainField, windowText } from '../lib/hotspots';
import { TABLES, type Row } from './hotspots-tables';

type Product = Record<string, any>;

const list = (value: unknown): Row[] => (Array.isArray(value) ? value : []);

function Notices({ product }: { product: Product }) {
  const items = notices(product);
  if (items.length === 0) return null;
  return (
    <Card title="What the history can show" tone="warn">
      {items.map((text) => <p key={text}>{text}</p>)}
    </Card>
  );
}

function Header({ product }: { product: Product }) {
  const counts = product.counts || {};
  const repos = list(product.repos);
  const bots = product.bots;
  const conservation = conservationText(product.conservation);
  const tiles: [string, number][] = [
    ['Files with history', counts.filesWithHistory], ['Files without history', counts.filesWithoutHistory],
    ['Binary files', counts.binaryFiles], ['Files with lineage conflicts', counts.filesWithLineageConflicts],
  ];
  return (
    <>
      <Card title="History">
        <Facts
          items={[
            ['Window', windowText(product.window)],
            ['Source kind', plainField(product.sourceKind) || EMPTY],
            ['Commits by bots', bots && typeof bots.commits === 'number' ? `${formatNumber(bots.commits)} (author email local part ends in ${String(bots.emailMarker).replace(/@$/, '')}; left out of the shares by author)` : EMPTY],
          ]}
        />
      </Card>
      {repos.length === 0 ? null : (
        <Card title="Repositories read">
          <SimpleTable
            columns={[{ label: 'Path' }, { label: 'Head', wrap: true }, { label: 'Shallow' }, { label: 'Boundary commits', num: true }, { label: 'Earliest visible commit' }]}
            rows={repos.map((r) => [r.path, <span key="h" className="font-mono text-[12.5px]">{String(r.head)}</span>, r.shallow ? 'yes' : 'no', formatNumber(r.boundaryCommits), r.earliestVisibleCommit])}
          />
        </Card>
      )}
      <Card title="Counts">
        <Tiles>{tiles.map(([label, value]) => <Tile key={label} label={label} value={value} />)}</Tiles>
        {conservation === null ? null : <p className="mt-3 font-mono text-[12.5px]">{conservation}</p>}
      </Card>
    </>
  );
}

/** A table card with a search box, a "showing" line and the sorted, paged table. `fields` are the texts the search looks in. */
function FilteredTable({ name, title, noun, placeholder, rows, def, max, fields, intro }: {
  name: string;
  title: string;
  noun: string;
  placeholder: string;
  rows: Row[];
  def: (typeof TABLES)[keyof typeof TABLES];
  max: number | null;
  fields: ((row: Row) => unknown)[];
  intro?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const matching = useMemo(() => filterRows(rows, query, fields), [rows, query, fields]);
  const columns = useMemo(() => def.columns(max), [def, max]);
  useCounts({ [name]: rows.length, [`${name}-shown`]: matching.length });
  return (
    <Card title={title}>
      {intro}
      <SearchInput value={query} onChange={setQuery} placeholder={placeholder} />
      <p className="text-muted">{`Showing ${formatNumber(matching.length)} of ${formatNumber(rows.length)} ${noun}`}</p>
      <DataTable rows={matching} columns={columns} initialSort={def.initialSort} />
    </Card>
  );
}

function FeatureGroups({ product, groups }: { product: Product; groups: Row[] }) {
  const summary = product.featureGroups;
  const max = maxScore(groups);
  const columns = useMemo(() => TABLES.groups.columns(max), [max]);
  if (summary === null || summary === undefined) {
    return (
      <Card title="Feature groups">
        <p className="text-muted">No feature groups in this product.</p>
      </Card>
    );
  }
  const tiles: [string, number][] = [
    ['Groups listed', summary.groupsListed], ['Files in a group', summary.filesInAGroup],
    ['Files in several groups', summary.filesInSeveralGroups], ['Listed paths matching no file', summary.pathsUnmatched],
  ];
  const unmatched = groups.filter((g) => Array.isArray(g.unmatchedPaths) && g.unmatchedPaths.length > 0);
  return (
    <Card title="Feature groups">
      <p className="text-muted">A group counts only the files its groups file lists, and a file in several groups counts in each.</p>
      <Tiles>{tiles.map(([label, value]) => <Tile key={label} label={label} value={value} />)}</Tiles>
      <div className="mt-3">
        <DataTable rows={groups} columns={columns} initialSort={TABLES.groups.initialSort} />
      </div>
      {unmatched.length === 0 ? null : <h3 className="mt-4">Listed paths that matched no selected file</h3>}
      {unmatched.map((g) => (
        <details key={g.name} className="mt-1.5">
          <summary className="max-w-[300px] cursor-pointer truncate font-mono text-[12.5px] text-ink-soft">{`${g.name} (${g.unmatchedPaths.length})`}</summary>
          <BulletList mono items={g.unmatchedPaths.map(String)} />
        </details>
      ))}
    </Card>
  );
}

const pathFields = [(r: Row) => r.path];
const pairFields = [(r: Row) => r.a, (r: Row) => r.b];

function HotspotsBody({ product }: { product: Product }) {
  const files = useMemo(() => list(product.files), [product]);
  const directories = useMemo(() => list(product.directories), [product]);
  const pairs = useMemo(() => list(product.pairs), [product]);
  const groups = useMemo(() => list(product.groups), [product]);
  const rule = coChangeText(product.coChange);
  const coChange = product.coChange || {};
  useCounts({ groups: groups.length });
  return (
    <>
      <Notices product={product} />
      <Header product={product} />
      <FilteredTable
        name="files" title="Files" noun="files" placeholder="Search file paths" rows={files} def={TABLES.files} max={maxScore(files)} fields={pathFields}
        intro={<p className="text-muted">Score is commits x lines at HEAD. A binary file has no lines and no score.</p>}
      />
      <FilteredTable name="directories" title="Directories" noun="directories" placeholder="Search directory paths" rows={directories} def={TABLES.directories} max={maxScore(directories)} fields={pathFields} />
      <FilteredTable
        name="pairs" title="Files changed together" noun="pairs" placeholder="Search file paths" rows={pairs} def={TABLES.pairs} max={null} fields={pairFields}
        intro={(
          <div>
            {rule === null ? <p className="text-muted">The product records no rule for pairs.</p> : <p>{rule}</p>}
            <p className="text-muted">
              {`Commits counted for pairs: ${formatNumber(coChange.commitsCounted)}. Commits over the limit, counted for no pair: ${formatNumber(coChange.commitsOverLimit)}. Pairs listed: ${formatNumber(coChange.pairsListed)}. Pairs below the minimum, not listed: ${formatNumber(coChange.pairsBelowMinimum)}.`}
            </p>
          </div>
        )}
      />
      <FeatureGroups product={product} groups={groups} />
      <Card title="Residual assumptions">
        <BulletList items={(product.residualAssumptions ?? []).map(String)} />
      </Card>
    </>
  );
}

export function HotspotsPage() {
  return (
    <ProductPage<Product>
      product="hotspots"
      title="Hotspots"
      subtitle="Where the history counts changes, as the hotspots product states them: commits, authors and lines per file and directory, and the files changed together."
      load={(payloads, product) => payloads.parsed<Product>(product.payloads[0])}
    >
      {(product) => <HotspotsBody product={product} />}
    </ProductPage>
  );
}
