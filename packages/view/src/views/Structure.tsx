// Structure (artifact-view task 5.1): a squarified directory treemap of the
// manifest files, sized by line count (or file count, with a note), colored
// by language. A click drills into a directory with a zoom transition (none
// under prefers-reduced-motion); `#/dir/<path>` locates a directory, or a
// file shown selected with its symbols.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { motion } from 'framer-motion';
import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy';
import { cellText, isTable, type ViewData } from '../data';
import { fmtNumber } from '../format';
import { OTHER_COLOR, languageColors, languageOrder } from '../model/colors';
import { breadcrumbs, buildStructure, compressedDir, entryWeight, locate, type StructureModel, type TreeDir, type TreeEntry, type TreeFile } from '../model/tree';
import { dirHash, nodeHash } from '../routes';
import { report } from '../instrument';
import { useReducedMotion } from '../motion';

const UNKNOWN_COLOR = 'var(--surface-2)';
const DIR_HEADER = 18;

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type Cell = HierarchyRectangularNode<TreeEntry>;

/** Squarified layout of one directory level: its children and, inside directories, their children. */
function layoutLevel(dir: TreeDir, sizing: StructureModel['sizing'], width: number, height: number): Cell | null {
  // Below the shown level, single-subdirectory chains collapse into one cell
  // whose inner cells are the chain end's children.
  const root = hierarchy<TreeEntry>(dir, (e) => (e.kind === 'dir' ? (e === dir ? e.children : compressedDir(e).children) : undefined))
    .sum((e) => (e.kind === 'file' ? entryWeight(e, sizing) : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (!root.value) return null;
  return treemap<TreeEntry>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner(2)
    .paddingOuter((n) => (n.depth === 1 ? 2 : 0))
    .paddingTop((n) => (n.depth === 1 && n.data.kind === 'dir' ? DIR_HEADER : 0))
    .round(true)(root);
}

/** The rect, in `level`'s layout, of the child that is `target` or contains it. */
function childRect(level: Cell | null, target: string): Rect | null {
  for (const child of level?.children ?? []) {
    const p = child.data.path;
    if (target === p || target.startsWith(`${p}/`)) return { x0: child.x0, y0: child.y0, x1: child.x1, y1: child.y1 };
  }
  return null;
}

function isAncestor(ancestor: string, path: string): boolean {
  return ancestor !== path && (ancestor === '' || path.startsWith(`${ancestor}/`));
}

function colorOf(entry: TreeEntry, colors: Map<string, string>): string {
  if (entry.language === null) return UNKNOWN_COLOR;
  return colors.get(entry.language) ?? OTHER_COLOR;
}

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

type SymbolOf = (row: number) => { id: string; name: string };

function symbolOf(data: ViewData): SymbolOf {
  const nodes = data.segments.nodes;
  return (row) => {
    const text = (column: string) => (isTable(nodes) ? cellText(data.strings, nodes.columns[column]?.[row] ?? -1) : undefined);
    const id = text('id') ?? '';
    return { id, name: text('name') ?? id };
  };
}

function go(hash: string) {
  window.location.hash = hash;
}

export function Structure({ data, path }: { data: ViewData; path: string }) {
  const model = useMemo(() => buildStructure(data.segments, data.strings, data.meta), [data]);
  const colors = useMemo(() => languageColors(languageOrder(data.coverage)), [data]);
  const located = locate(model, path);
  const shownPath = located ? located.dir.path : null;

  useEffect(() => {
    report('data-treemap-path', shownPath);
    return () => report('data-treemap-path', null);
  }, [shownPath]);

  if (!located) {
    return (
      <div className="content" data-section="structure" data-dir-found="false">
        <section className="card">
          <h2>Not in this tree</h2>
          <p>
            No directory or file <code>{path}</code> is in the manifest. <a href={dirHash('')}>Back to the top of the tree</a>.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="content" data-section="structure" data-dir-found="true" data-treemap-path={located.dir.path} data-sizing={model.sizing}>
      <StructureNotes model={model} />
      <section className="card">
        <Breadcrumbs path={located.dir.path} model={model} />
        <Treemap model={model} dir={located.dir} selected={located.file} colors={colors} symbol={symbolOf(data)} />
        <Legend model={model} colors={colors} />
      </section>
      <div className="grid-2">
        {located.file && <FilePanel data={data} file={located.file} />}
        <ChildrenTable model={model} dir={located.dir} colors={colors} />
      </div>
    </div>
  );
}

function StructureNotes({ model }: { model: StructureModel }) {
  const notes: Array<{ key: string; text: string }> = [];
  if (model.sizing === 'files') {
    notes.push({
      key: 'sizing',
      text: `Sized by file count: none of the ${fmtNumber(model.totalFiles)} files has a line count (fingerprints.json was missing when this page was baked).`,
    });
  } else if (model.filesWithoutLines > 0) {
    notes.push({
      key: 'lines',
      text: `${fmtNumber(model.filesWithoutLines)} of ${fmtNumber(model.totalFiles)} files have no line count (fingerprints.json does not cover them): they take no area in the treemap and are listed in their directory's table.`,
    });
  }
  if (!model.hasIndex) notes.push({ key: 'language', text: 'Language colors are unavailable: this bundle has no source index.' });
  else if (model.unknownLanguageFiles > 0) {
    notes.push({ key: 'language', text: `${fmtNumber(model.unknownLanguageFiles)} files have no language in the source index and are shown as unknown.` });
  }
  if (model.symbolsOutsideFiles > 0) {
    notes.push({ key: 'outside', text: `${fmtNumber(model.symbolsOutsideFiles)} symbols are anchored outside the manifest files and are not in this tree.` });
  }
  if (model.totalFiles === 0) notes.push({ key: 'empty', text: 'The manifest lists no files.' });
  if (notes.length === 0) return null;
  return (
    <section className="banner" data-state="stale">
      <div>
        {notes.map((n) => (
          <div key={n.key} className="secondary" data-structure-note={n.key}>
            {n.text}
          </div>
        ))}
      </div>
    </section>
  );
}

function Breadcrumbs({ path, model }: { path: string; model: StructureModel }) {
  const trail = breadcrumbs(path);
  const dir = model.byPath.get(path) as TreeDir;
  return (
    <div className="toolbar">
      <nav className="crumbs" aria-label="Directory">
        {trail.map((p, i) => {
          const name = p === '' ? 'root' : (model.byPath.get(p)?.name ?? p);
          return (
            <span key={p}>
              {i > 0 && <span className="muted crumb-sep"> › </span>}
              {i === trail.length - 1 ? <strong data-crumb={p}>{name}</strong> : <a href={dirHash(p)} data-crumb={p}>{name}</a>}
            </span>
          );
        })}
      </nav>
      <span className="muted">
        {fmtNumber(dir.files)} files · {model.sizing === 'lines' ? `${fmtNumber(dir.lines)} lines` : 'sized by file count'}
      </span>
      {path !== '' && (
        <a href={dirHash(trail[trail.length - 2])} data-action="up">
          Up one level
        </a>
      )}
    </div>
  );
}

function Treemap({ model, dir, selected, colors, symbol }: { model: StructureModel; dir: TreeDir; selected: TreeFile | null; colors: Map<string, string>; symbol: SymbolOf }) {
  const [ref, width] = useWidth();
  const height = Math.round(Math.min(640, Math.max(360, width * 0.55)));
  const level = useMemo(() => (width > 0 ? layoutLevel(dir, model.sizing, width, height) : null), [dir, model.sizing, width, height]);

  // Zoom transition: entering a child starts from that child's rect in the
  // previous level; going up starts zoomed so the child we left fills the view.
  const previous = useRef<string | null>(null);
  const reduce = useReducedMotion();
  const from = previous.current;
  let initial: false | { x: number; y: number; scaleX: number; scaleY: number } = false;
  if (!reduce && width > 0 && from !== null && from !== dir.path) {
    if (isAncestor(from, dir.path)) {
      const parent = model.byPath.get(from);
      const r = parent && parent.kind === 'dir' ? childRect(layoutLevel(parent, model.sizing, width, height), dir.path) : null;
      if (r && r.x1 > r.x0 && r.y1 > r.y0) initial = { x: r.x0, y: r.y0, scaleX: (r.x1 - r.x0) / width, scaleY: (r.y1 - r.y0) / height };
    } else if (isAncestor(dir.path, from)) {
      const r = childRect(level, from);
      if (r && r.x1 > r.x0 && r.y1 > r.y0) {
        const sx = width / (r.x1 - r.x0);
        const sy = height / (r.y1 - r.y0);
        initial = { x: -r.x0 * sx, y: -r.y0 * sy, scaleX: sx, scaleY: sy };
      }
    }
  }
  useEffect(() => {
    previous.current = dir.path;
  }, [dir.path]);

  const cells = level?.children ?? [];
  return (
    <div ref={ref} className="treemap" style={{ height }} data-cells={cells.length} data-motion="treemap-zoom" data-motion-state={reduce ? 'static' : 'animated'}>
      {width > 0 && level === null && <p className="muted treemap-empty">Nothing to draw here: every file under this directory has zero size.</p>}
      {width > 0 && level !== null && (
        <motion.div
          key={dir.path}
          className="treemap-level"
          style={{ transformOrigin: '0 0' }}
          initial={initial}
          animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        >
          {cells.map((cell) => (
            <TreemapCell key={cell.data.path} cell={cell} sizing={model.sizing} colors={colors} selected={selected?.path === cell.data.path} symbol={symbol} />
          ))}
        </motion.div>
      )}
    </div>
  );
}

function box(cell: Rect, origin?: Rect) {
  return {
    left: cell.x0 - (origin?.x0 ?? 0),
    top: cell.y0 - (origin?.y0 ?? 0),
    width: Math.max(0, cell.x1 - cell.x0),
    height: Math.max(0, cell.y1 - cell.y0),
  };
}

/** Symbol links a file cell has room for (one per text line below the label); the file panel lists them all. */
function symbolRoom(height: number): number {
  return Math.max(0, Math.floor((height - 22) / 16));
}

function TreemapCell({ cell, sizing, colors, selected, symbol }: { cell: Cell; sizing: StructureModel['sizing']; colors: Map<string, string>; selected: boolean; symbol: SymbolOf }) {
  const entry = cell.data;
  const size = box(cell);
  if (size.width < 1 || size.height < 1) return null;
  const end = entry.kind === 'dir' ? compressedDir(entry) : null;
  const compressed = end !== null && end !== entry ? end : null;
  const target = dirHash(compressed ? compressed.path : entry.path);
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('a')) return;
    go(target);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && event.target === event.currentTarget) go(target);
  };
  const weight = entryWeight(entry, sizing);
  const title = `${entry.path} · ${sizing === 'lines' ? `${fmtNumber(weight)} lines` : entry.kind === 'dir' ? `${fmtNumber(weight)} files` : '1 file'}${entry.language ? ` · ${entry.language}` : ''}`;
  if (entry.kind === 'dir') {
    return (
      <div
        className="tm-cell tm-dir"
        style={size}
        title={title}
        role="link"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={onKey}
        data-cell={entry.path}
        data-kind="dir"
        data-member={entry.member ? 'true' : undefined}
        data-compressed={compressed ? compressed.path : undefined}
      >
        <a className="tm-label" href={target}>
          {entry.name}/{compressed ? `${compressed.path.slice(entry.path.length + 1)}/` : ''}
          {entry.member && <span className="tm-tag"> member</span>}
        </a>
        {(cell.children ?? []).map((inner) => {
          const s = box(inner, cell);
          if (s.width < 1 || s.height < 1) return null;
          return <span key={inner.data.path} className="tm-inner" style={{ ...s, background: colorOf(inner.data, colors) }} title={inner.data.path} />;
        })}
      </div>
    );
  }
  return (
    <div
      className="tm-cell tm-file"
      style={{ ...size, background: colorOf(entry, colors) }}
      title={title}
      role="link"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKey}
      data-cell={entry.path}
      data-kind="file"
      data-selected={selected ? 'true' : undefined}
      data-language={entry.language ?? 'unknown'}
    >
      <a className="tm-label" href={target}>
        {entry.name}
      </a>
      {(() => {
        const room = symbolRoom(size.height);
        const shown = entry.symbols.length <= room ? entry.symbols : entry.symbols.slice(0, Math.max(0, room - 1));
        return (
          <>
            {shown.map((row) => {
              const s = symbol(row);
              return (
                <a key={row} className="tm-symbol" href={nodeHash(s.id)} data-symbol={s.id}>
                  {s.name}
                </a>
              );
            })}
            {shown.length < entry.symbols.length && room > 0 && (
              <a className="tm-more" href={target}>
                +{fmtNumber(entry.symbols.length - shown.length)} more
              </a>
            )}
          </>
        );
      })()}
    </div>
  );
}

function Legend({ model, colors }: { model: StructureModel; colors: Map<string, string> }) {
  // Languages with a color slot are listed one by one; the rest fold into one
  // "other" entry (they share its color), as in the overview ring.
  const present = new Map<string, number>();
  for (const entry of model.byPath.values()) if (entry.kind === 'file') present.set(entry.language ?? '', (present.get(entry.language ?? '') ?? 0) + 1);
  const rows: Array<{ key: string; label: string; files: number; color: string; unknown?: boolean }> = [];
  let otherFiles = 0;
  let otherLanguages = 0;
  for (const [language, files] of [...present.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    if (language === '') rows.push({ key: 'unknown', label: 'unknown', files, color: UNKNOWN_COLOR, unknown: true });
    else if ((colors.get(language) ?? OTHER_COLOR) === OTHER_COLOR) {
      otherFiles += files;
      otherLanguages += 1;
    } else rows.push({ key: language, label: language, files, color: colors.get(language) as string });
  }
  if (otherLanguages > 0) rows.push({ key: 'other', label: `other (${fmtNumber(otherLanguages)} languages)`, files: otherFiles, color: OTHER_COLOR });
  return (
    <ul className="legend treemap-legend" aria-label="Languages">
      {rows.map((row) => (
        <li key={row.key} data-legend-language={row.key}>
          <span className="swatch" style={{ background: row.color, outline: row.unknown ? '1px solid var(--baseline)' : undefined }} />
          {row.label} ({fmtNumber(row.files)} files)
        </li>
      ))}
    </ul>
  );
}

function FilePanel({ data, file }: { data: ViewData; file: TreeFile }) {
  const nodes = data.segments.nodes;
  const str = (column: string, row: number) => (isTable(nodes) ? cellText(data.strings, nodes.columns[column]?.[row] ?? -1) : undefined);
  const num = (column: string, row: number) => (isTable(nodes) ? (nodes.columns[column]?.[row] ?? -1) : -1);
  const fileId = file.fileNode >= 0 ? str('id', file.fileNode) : undefined;
  return (
    <section className="card" data-file-panel={file.path}>
      <h2 className="mono">{file.path}</h2>
      <dl className="facts">
        <dt>Lines</dt>
        <dd>{file.lines >= 0 ? fmtNumber(file.lines) : 'unknown'}</dd>
        <dt>Language</dt>
        <dd>{file.language ?? 'unknown'}</dd>
        <dt>File node</dt>
        <dd className="mono">{fileId ? <a href={nodeHash(fileId)}>{fileId}</a> : 'not in the graph'}</dd>
      </dl>
      <h3>Symbols ({fmtNumber(file.symbols.length)})</h3>
      {file.symbols.length === 0 ? (
        <p className="muted">No symbols are anchored in this file.</p>
      ) : (
        <ul className="symbol-list" data-symbols={file.symbols.length}>
          {file.symbols.map((row) => {
            const id = str('id', row) ?? '';
            const line0 = num('line0', row);
            return (
              <li key={row}>
                <span className="muted">{str('type', row) ?? '—'}</span> <a href={nodeHash(id)} data-symbol={id}>{str('name', row) ?? id}</a>
                {line0 >= 0 && <span className="muted"> :{line0}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ChildrenTable({ model, dir, colors }: { model: StructureModel; dir: TreeDir; colors: Map<string, string> }) {
  return (
    <section className="card">
      <h2>In this directory ({fmtNumber(dir.children.length)})</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">Files</th>
              <th className="num">Lines</th>
              <th>Language</th>
            </tr>
          </thead>
          <tbody>
            {dir.children.map((child) => (
              <tr key={child.path} data-child={child.path}>
                <td className="mono">
                  <a href={dirHash(child.path)}>{child.kind === 'dir' ? `${child.name}/` : child.name}</a>
                </td>
                <td className="num">{child.kind === 'dir' ? fmtNumber(child.files) : '1'}</td>
                <td className="num">{child.kind === 'dir' ? (model.sizing === 'lines' ? fmtNumber(child.lines) : '—') : child.lines >= 0 ? fmtNumber(child.lines) : 'unknown'}</td>
                <td>
                  <span className="swatch" style={{ background: colorOf(child, colors) }} /> {child.language ?? 'unknown'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
