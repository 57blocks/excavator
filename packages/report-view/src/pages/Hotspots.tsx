import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { ProductPage } from '../components/ProductPage';
import { RowActions, RowSource } from '../components/RowExtras';
import { AreaSpark } from '../components/ui/AreaSpark';
import { BarList } from '../components/ui/BarList';
import { Card } from '../components/ui/Card';
import { Collapsible } from '../components/ui/Collapsible';
import { BulletList, Facts, LinkButton, SearchInput } from '../components/ui/Controls';
import { DataTable, SimpleTable } from '../components/ui/DataTable';
import { Histogram } from '../components/ui/Histogram';
import { PrefixBar, RowMissing } from '../components/ui/RowLinkNotes';
import { RowFields, RowPanel, RowSection } from '../components/ui/RowPanel';
import { Segmented } from '../components/ui/Segmented';
import { StatTile, StatTiles } from '../components/ui/StatTile';
import { Tile, Tiles } from '../components/ui/Tile';
import { useRowLink } from '../hooks/use-row-link';
import { useCounts } from '../hooks/use-signals';
import { normalizePrefix, underPrefix } from '../lib/detail-rows';
import { EMPTY, formatNumber, NOT_PROVIDED } from '../lib/format';
import { coChangeText, conservationText, filterRows, maxScore, notices, numberField, plainField, windowText, yearSeries } from '../lib/hotspots';
import { coChanged, projectYears, scoreHistogram, topFiles } from '../lib/hotspots-charts';
import { TABLES, type Row } from './hotspots-tables';

type Product = Record<string, any>;

const list = (value: unknown): Row[] => (Array.isArray(value) ? value : []);

/** The tables of the page, one shown at a time; `view` in the address names it. */
const VIEWS = ['files', 'directories', 'pairs', 'groups'] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABELS: Record<View, string> = { files: 'Files', directories: 'Directories', pairs: 'Pairs', groups: 'Groups' };
const viewOf = (value: string | undefined): View => ((VIEWS as readonly string[]).includes(value ?? '') ? (value as View) : 'files');

/** How many files the top-files chart and a file's changed-together list show. */
const TOP_FILES = 10;
const CO_CHANGE_SHOWN = 10;

function Notices({ product }: { product: Product }) {
  const items = notices(product);
  if (items.length === 0) return null;
  return (
    <Card title="What the history can show" tone="warn">
      {items.map((text) => <p key={text}>{text}</p>)}
    </Card>
  );
}

function History({ product }: { product: Product }) {
  const repos = list(product.repos);
  const bots = product.bots;
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
    </>
  );
}

/** The project's commits per year, from the product's project-root row; what the product does not give is said, never drawn as 0. */
function YearsChart({ product }: { product: Product }) {
  const years = projectYears(product);
  return (
    <Card title="Commits per year">
      {years.state === 'provided' ? (
        <div data-xv-years={years.points.map((p) => `${p.label}:${p.value}`).join(',')} data-xv-years-state="provided">
          <AreaSpark points={years.points} label="Commits per year of the project" />
          <p className="mt-2 text-xs text-muted">{`${formatNumber(years.total)} commits, as the project root directory row counts them by year.`}</p>
        </div>
      ) : (
        <p data-xv-years-state={years.state} className="text-muted">
          {years.state === 'no-history' ? 'There is no history to count.' : `Commits per year: ${NOT_PROVIDED} (no per-year counts for the project root directory).`}
        </p>
      )}
    </Card>
  );
}

function ScoresChart({ files }: { files: Row[] }) {
  const hist = scoreHistogram(files);
  return (
    <Card title="File scores">
      {hist.state === 'bins' ? <Histogram values={hist.values} edges={hist.edges} label="Files by score" /> : <p className="text-muted">{`No file has a score above 0 (${formatNumber(hist.scored)} scored).`}</p>}
      {hist.withoutScore > 0 ? <p data-xv-without-score={hist.withoutScore} className="mt-2 text-xs text-muted">{`${formatNumber(hist.withoutScore)} file(s) without a score.`}</p> : null}
    </Card>
  );
}

function Overview({ product, files, onOpen }: { product: Product; files: Row[]; onOpen: (path: string) => void }) {
  const counts = product.counts || {};
  const conservation = conservationText(product.conservation);
  const top = topFiles(files, TOP_FILES);
  return (
    <>
      <StatTiles>
        <StatTile label="Files with history" value={counts.filesWithHistory} note="selected files with history" />
        <StatTile label="Files without history" value={counts.filesWithoutHistory} note="in no repository read" />
        <StatTile label="Binary files" value={counts.binaryFiles} note="no lines, no score" />
        <StatTile label="Lineage conflicts" value={counts.filesWithLineageConflicts} note="files with lineage conflicts" />
      </StatTiles>
      {conservation === null ? null : <p className="m-0 font-mono text-[12.5px] text-muted">{conservation}</p>}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-5">
        <YearsChart product={product} />
        <ScoresChart files={files} />
        <Card title={`Top ${TOP_FILES} files by score`}>
          {top.length === 0 ? <p className="text-muted">No file has a score.</p> : <BarList rows={top.map((f) => ({ key: f.path, label: f.path, value: f.score }))} label="Files with the highest scores" onSelect={(bar) => onOpen(bar.key)} />}
        </Card>
      </div>
    </>
  );
}

/**
 * A table card with a search box, the path filter, a "showing" line and the sorted, paged table. `fields` are the
 * texts the search looks in; `paths` the paths the prefix is tested on (any of them under it keeps the row), null when
 * the rows have none. A row the address names is turned to and opened through `link`.
 */
function FilteredTable({ name, title, noun, placeholder, rows, def, max, fields, paths, intro, link }: {
  name: string;
  title: string;
  noun: string;
  placeholder: string;
  rows: Row[];
  def: (typeof TABLES)[keyof typeof TABLES];
  max: number | null;
  fields: ((row: Row) => unknown)[];
  paths: (row: Row) => string[];
  intro?: ReactNode;
  link?: { rowKey: (row: Row) => string; linked: Row | null; onOpen: (row: Row) => void };
}) {
  const { prefix, clearPrefix } = useRowLink();
  const [query, setQuery] = useState('');
  const prefixed = useMemo(() => rows.filter((row) => paths(row).some((path) => underPrefix(path, prefix))), [rows, paths, prefix]);
  const matching = useMemo(() => filterRows(prefixed, query, fields), [prefixed, query, fields]);
  const columns = useMemo(() => def.columns(max), [def, max]);
  const linked = link?.linked ?? null;
  // A linked row the search hides: the search is cleared so the row can be shown.
  useEffect(() => {
    if (linked !== null && prefixed.includes(linked) && !matching.includes(linked)) setQuery('');
  }, [linked]);
  const shown = linked !== null && matching.includes(linked) ? linked : null;
  useCounts({ [`${name}-shown`]: matching.length, [`${name}-prefixed`]: prefixed.length });
  return (
    <Card title={title}>
      {intro}
      <PrefixBar prefix={prefix} shown={prefixed.length} total={rows.length} noun={noun} onClear={clearPrefix} />
      <SearchInput value={query} onChange={setQuery} placeholder={placeholder} />
      <p className="text-muted">{`Showing ${formatNumber(matching.length)} of ${formatNumber(prefixed.length)} ${noun}`}</p>
      <DataTable
        rows={matching}
        columns={columns}
        initialSort={def.initialSort}
        rowKey={link?.rowKey}
        onRowClick={link?.onOpen}
        isSelected={link ? (row) => row === shown : undefined}
        focusKey={shown && link ? link.rowKey(shown) : null}
      />
    </Card>
  );
}

function FeatureGroups({ product, groups }: { product: Product; groups: Row[] }) {
  const { prefix } = useRowLink();
  const summary = product.featureGroups;
  const max = maxScore(groups);
  const columns = useMemo(() => TABLES.groups.columns(max), [max]);
  const dir = normalizePrefix(prefix);
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
      {dir === null ? null : <p className="text-muted">{`A group is not one path: the path filter (${dir}) does not apply to groups.`}</p>}
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

/** A file row's commits per year: the row's own `commitsByYear` when the product gives one; else it is said to be missing. */
function FileYears({ row }: { row: Row }) {
  const series = yearSeries(row.commitsByYear);
  if (series !== null) {
    return (
      <div data-xv-file-years={series.map((p) => `${p.year}:${p.commits}`).join(',')}>
        <AreaSpark points={series.map((p) => ({ label: p.year, value: p.commits }))} label={`Commits per year of ${row.path}`} />
      </div>
    );
  }
  return <p data-xv-file-years={row.commitsByYear === null ? 'no-history' : 'not-provided'} className="text-muted">{row.commitsByYear === null ? 'There is no history to count.' : NOT_PROVIDED}</p>;
}

/** The row panel of a file: its numbers, its commits per year, the files changed together with it most, and its source. */
function FilePanel({ row, pairs, files, onOpen }: { row: Row; pairs: Row[]; files: ReadonlySet<string>; onOpen: (path: string) => void }) {
  const together = coChanged(pairs, row.path, CO_CHANGE_SHOWN);
  return (
    <>
      <RowActions target={{ kind: 'file', path: row.path }} overlay="hotspots" path={row.path} />
      <RowFields
        fields={[
          { label: 'Path', value: <code>{row.path}</code> },
          { label: 'Score', value: numberField(row.score) },
          { label: 'Commits', value: numberField(row.commits) },
          { label: 'Authors', value: numberField(row.authors) },
          { label: 'Added', value: numberField(row.added) },
          { label: 'Removed', value: numberField(row.removed) },
          { label: 'Lines', value: numberField(row.lines) },
          { label: 'Last changed', value: plainField(row.lastChanged) },
          { label: 'Lineage conflicts', value: numberField(row.lineageConflicts) },
        ]}
      />
      <RowSection title="Commits per year">
        <FileYears row={row} />
      </RowSection>
      <RowSection title="Changed together most">
        {together.length === 0 ? <p className="text-muted">The product lists no pair with this file.</p> : (
          <ol data-xv-co-change={together.map((t) => `${t.path}:${t.together}`).join(',')} className="m-0 flex list-none flex-col gap-1 p-0">
            {together.map((t) => (
              <li key={t.path} className="flex items-baseline justify-between gap-3 [overflow-wrap:anywhere]">
                {files.has(t.path) ? <LinkButton title={`Open ${t.path}`} onClick={() => onOpen(t.path)}><span data-xv-related={t.path}>{t.path}</span></LinkButton> : <code>{t.path}</code>}
                <span className="shrink-0 font-mono text-xs text-muted">{`${formatNumber(t.together)} together`}</span>
              </li>
            ))}
          </ol>
        )}
      </RowSection>
      <RowSource path={row.path} />
    </>
  );
}

const pathFields = [(r: Row) => r.path];
const pairFields = [(r: Row) => r.a, (r: Row) => r.b];
const rowPath = (r: Row) => [r.path];
const pairPaths = (r: Row) => [r.a, r.b];
const fileKey = (r: Row) => String(r.path);

function HotspotsBody({ product }: { product: Product }) {
  const files = useMemo(() => list(product.files), [product]);
  const directories = useMemo(() => list(product.directories), [product]);
  const pairs = useMemo(() => list(product.pairs), [product]);
  const groups = useMemo(() => list(product.groups), [product]);
  const filePaths = useMemo(() => new Set(files.map(fileKey)), [files]);
  const { route, row: linkedPath, prefix, open, close, set } = useRowLink();
  const view = viewOf(route.params.view);
  const rule = coChangeText(product.coChange);
  const coChange = product.coChange || {};
  useCounts({ files: files.length, directories: directories.length, pairs: pairs.length, groups: groups.length });

  // A `row` names a file row: it is opened in the Files view, when the file is under the path filter.
  const target = view === 'files' && linkedPath !== null ? files.find((r) => r.path === linkedPath) ?? null : null;
  const visible = target !== null && underPrefix(target.path, prefix) ? target : null;
  const missing = linkedPath === null ? null
    : view !== 'files' ? `The address names the file "${linkedPath}", which only the Files view opens.`
    : target === null ? `No file of the hotspots product has the path "${linkedPath}".`
      : visible === null ? `"${linkedPath}" is not under the path ${normalizePrefix(prefix)}.` : null;
  const openFile = (path: string) => open(path, { view: 'files' });

  return (
    <>
      <Notices product={product} />
      <Overview product={product} files={files} onOpen={openFile} />
      <History product={product} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Hotspots tables" values={VIEWS} labels={VIEW_LABELS} value={view} onChange={(v) => set({ view: v, row: null })} />
      </div>
      <RowMissing text={missing} />
      {view === 'files' ? (
        <FilteredTable
          name="files" title="Files" noun="files" placeholder="Search file paths" rows={files} def={TABLES.files} max={maxScore(files)} fields={pathFields} paths={rowPath}
          intro={<p className="text-muted">Score is commits x lines at HEAD. A binary file has no lines and no score. Click a file to see its numbers, the files changed with it and its source.</p>}
          link={{ rowKey: fileKey, linked: visible, onOpen: (r) => openFile(r.path) }}
        />
      ) : null}
      {view === 'directories' ? (
        <FilteredTable name="directories" title="Directories" noun="directories" placeholder="Search directory paths" rows={directories} def={TABLES.directories} max={maxScore(directories)} fields={pathFields} paths={rowPath} />
      ) : null}
      {view === 'pairs' ? (
        <FilteredTable
          name="pairs" title="Files changed together" noun="pairs" placeholder="Search file paths" rows={pairs} def={TABLES.pairs} max={null} fields={pairFields} paths={pairPaths}
          intro={(
            <div>
              {rule === null ? <p className="text-muted">The product records no rule for pairs.</p> : <p>{rule}</p>}
              <p className="text-muted">
                {`Commits counted for pairs: ${formatNumber(coChange.commitsCounted)}. Commits over the limit, counted for no pair: ${formatNumber(coChange.commitsOverLimit)}. Pairs listed: ${formatNumber(coChange.pairsListed)}. Pairs below the minimum, not listed: ${formatNumber(coChange.pairsBelowMinimum)}.`}
              </p>
            </div>
          )}
        />
      ) : null}
      {view === 'groups' ? <FeatureGroups product={product} groups={groups} /> : null}
      <Collapsible title="Residual assumptions" count={formatNumber(list(product.residualAssumptions).length)}>
        <BulletList items={(product.residualAssumptions ?? []).map(String)} />
      </Collapsible>
      <RowPanel open={visible !== null} rowKey={visible ? fileKey(visible) : null} title={visible ? visible.path : 'File'} onClose={close}>
        {visible ? <FilePanel row={visible} pairs={pairs} files={filePaths} onOpen={openFile} /> : null}
      </RowPanel>
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
