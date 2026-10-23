import { useMemo, useState } from 'react';

import { CodeView } from '../components/CodeView';
import { FileInGraph } from '../components/FileInGraph';
import { BarList } from '../components/ui/BarList';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { SearchInput } from '../components/ui/Controls';
import { Page } from '../components/ui/Page';
import { useRoute } from '../hooks/use-route';
import { useCounts, useReady } from '../hooks/use-signals';
import type { SourceBucket } from '../data/manifest';
import { BUCKETS, bucketLabel, bucketReason, buildTree, codeHash, entriesFromSource, filterEntries, lineNotice, lineStatus, splitLines, type SourceEntry, type TreeNode } from '../lib/code';
import { formatNumber } from '../lib/format';
import { useEmbeddedText } from '../state/source';
import { useViewer } from '../state/viewer';

const MAX_TREE_FILES = 3000;

const BUCKET_TONE: Partial<Record<SourceBucket, BadgeTone>> = { embedded: 'success', tooLarge: 'warning', notInSnapshot: 'danger' };
const BUCKET_DOT: Record<string, string> = { embedded: 'bg-success', tooLarge: 'bg-warning', notInSnapshot: 'bg-danger' };
const BUCKET_COLOUR: Record<string, string> = { embedded: 'var(--color-success)', tooLarge: 'var(--color-warning)', notInSnapshot: 'var(--color-danger)' };

function BucketDot({ bucket }: { bucket: string }) {
  return <span title={bucketLabel(bucket)} aria-label={bucketLabel(bucket)} className={`mr-1.5 inline-block size-2 shrink-0 rounded-full ${BUCKET_DOT[bucket] ?? 'bg-muted'}`} />;
}

function Tree({ node, active, open }: { node: TreeNode; active: string | null; open: boolean }) {
  return (
    <ul className="m-0 list-none p-0 [&_ul]:ml-3.5 [&_ul]:border-l [&_ul]:border-line-2 [&_ul]:pl-2">
      {node.dirs.map((dir) => (
        <li key={dir.path}>
          <details open={open || (active !== null && `${active}/`.startsWith(`${dir.path}/`))}>
            <summary className="cursor-pointer py-0.5 text-ink">
              {`${dir.name}/ `}
              <span className="text-muted">{`(${formatNumber(dir.count)})`}</span>
            </summary>
            <Tree node={dir} active={active} open={open} />
          </details>
        </li>
      ))}
      {node.files.map((file) => (
        <li key={file.path}>
          <a href={codeHash(file.path)} aria-current={file.path === active ? 'true' : undefined} className="flex items-center py-0.5 text-ink-soft [overflow-wrap:anywhere] aria-[current=true]:font-semibold aria-[current=true]:text-accent">
            <BucketDot bucket={file.bucket} />
            <span>{file.name}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The referenced files by class, as the source manifest counts them. */
function ClassCounts({ entries, counts }: { entries: SourceEntry[]; counts: Record<string, number> }) {
  const rows = BUCKETS.filter((bucket) => typeof counts[bucket] === 'number').map((bucket) => ({ key: bucket, label: bucketLabel(bucket), value: counts[bucket], colour: BUCKET_COLOUR[bucket] }));
  return (
    <div className="mb-3 border-b border-line pb-3" data-xv-class-counts={entries.length}>
      <p className="m-0 mb-2 text-muted">{`${formatNumber(entries.length)} referenced files`}</p>
      <BarList rows={rows} label="Referenced files by class" />
    </div>
  );
}

function FileTree({ entries, active, counts }: { entries: SourceEntry[]; active: string | null; counts: Record<string, number> }) {
  const [filter, setFilter] = useState('');
  const matching = useMemo(() => filterEntries(entries, filter), [entries, filter]);
  const shown = matching.slice(0, MAX_TREE_FILES);
  const tree = useMemo(() => buildTree(shown), [shown]);
  return (
    <Card title="Files" className="max-h-[78vh] overflow-auto">
      <ClassCounts entries={entries} counts={counts} />
      <SearchInput value={filter} onChange={setFilter} placeholder="Filter paths" />
      <p className="text-muted">{`${formatNumber(matching.length)} of ${formatNumber(entries.length)} paths`}</p>
      <Tree node={tree} active={active} open={filter.trim() !== ''} />
      {matching.length > shown.length ? <p className="text-muted">{`Showing the first ${formatNumber(shown.length)} of ${formatNumber(matching.length)} paths; narrow the filter to see the rest.`}</p> : null}
      {matching.length === 0 ? <p className="text-muted">No referenced path matches.</p> : null}
    </Card>
  );
}

function PanelHead({ entry, extra }: { entry: SourceEntry; extra?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-paper-2 px-4 py-3">
      <span className="min-w-0 font-mono text-[12.5px] text-ink [overflow-wrap:anywhere]">{entry.path}</span>
      <Badge tone={BUCKET_TONE[entry.bucket as SourceBucket] ?? 'neutral'}>{bucketLabel(entry.bucket)}</Badge>
      {extra ? <span className="text-muted">{extra}</span> : null}
    </div>
  );
}

/** The source of an embedded file, once the page's source payload is unpacked. */
function EmbeddedSource({ entry }: { entry: SourceEntry }) {
  const { route } = useRoute();
  const loaded = useEmbeddedText(entry.path);
  const lineCount = loaded.state === 'ready' ? splitLines(loaded.value).length : 0;
  const status = lineStatus(route.params.lines, lineCount);
  useCounts(loaded.state === 'ready' ? { lines: lineCount } : null);
  useReady(loaded.state, route.params.lines ?? '');
  if (loaded.state === 'loading') return <Card><PanelHead entry={entry} /></Card>;
  if (loaded.state === 'error') return <Card title="This file could not be shown" tone="error"><p>{loaded.error.message}</p></Card>;
  const notice = lineNotice(status);
  return (
    <Card flush>
      <PanelHead entry={entry} extra={`${formatNumber(lineCount)} lines, ${formatNumber(entry.bytes)} bytes`} />
      {notice ? <p className="xv-notice m-0 border-l-4 border-warning bg-surface px-4 py-2.5 text-ink">{notice}</p> : null}
      <CodeView path={entry.path} text={loaded.value} status={status} />
    </Card>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  useReady('ready');
  return children;
}

function SourcePanel({ entries, active }: { entries: SourceEntry[]; active: string | null }) {
  const { manifest } = useViewer();
  if (active === null) {
    return <Placeholder><Card><p className="text-muted">{entries.length === 0 ? 'No product points at a file.' : 'Choose a file to see its source.'}</p></Card></Placeholder>;
  }
  const entry = entries.find((e) => e.path === active);
  if (!entry) {
    return (
      <Placeholder>
        <Card>
          <span className="font-mono text-[12.5px]">{active}</span>
          <p>No included product points at this path, so the page holds nothing for it.</p>
        </Card>
      </Placeholder>
    );
  }
  if (entry.bucket !== 'embedded') {
    return (
      <Placeholder>
        <Card flush>
          <PanelHead entry={entry} />
          <p className="px-4 py-3">{bucketReason(entry.bucket, entry, manifest.source, manifest.snapshot.revision)}</p>
        </Card>
      </Placeholder>
    );
  }
  return <EmbeddedSource entry={entry} />;
}

export function CodePage() {
  const { manifest } = useViewer();
  const { route } = useRoute();
  const source = manifest.source;
  const entries = useMemo(() => entriesFromSource(source), [source]);
  const active = route.params.path ? route.params.path : null;
  useCounts({ sources: source.counts.embedded });
  return (
    <Page title="Code" subtitle={`The files the included products point at, as they are in the source snapshot ${manifest.snapshot.revision}.`}>
      <div className="grid grid-cols-[minmax(240px,340px)_minmax(0,1fr)] items-start gap-5 max-[900px]:grid-cols-1">
        <FileTree entries={entries} active={active} counts={source.counts as Record<string, number>} />
        <div className="flex min-w-0 flex-col gap-5">
          {active === null ? null : <FileInGraph path={active} />}
          <SourcePanel entries={entries} active={active} />
        </div>
      </div>
    </Page>
  );
}
