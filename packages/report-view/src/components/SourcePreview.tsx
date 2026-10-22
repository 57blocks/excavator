import { useMemo } from 'react';

import { bucketLabel, bucketReason, entriesFromSource, lineNotice, lineStatus, splitLines } from '../lib/code';
import { useEmbeddedText } from '../state/source';
import { useViewer } from '../state/viewer';
import { CodeView } from './CodeView';

function EmbeddedBody({ path, lines }: { path: string; lines: string | null }) {
  const loaded = useEmbeddedText(path);
  if (loaded.state === 'loading') return <p className="m-0 px-4 py-3 text-muted">Reading the file.</p>;
  if (loaded.state === 'error') return <p className="m-0 px-4 py-3">{loaded.error.message}</p>;
  const status = lineStatus(lines, splitLines(loaded.value).length);
  const notice = lineNotice(status);
  return (
    <>
      {notice ? <p className="xv-notice m-0 border-l-4 border-warning bg-surface px-4 py-2.5 text-ink">{notice}</p> : null}
      <CodeView path={path} text={loaded.value} status={status} />
    </>
  );
}

/**
 * The source of a file with `lines` (a range such as `5-7`) marked: the file's
 * class decides what is shown, with the same classes, line rules and `.xv-code`
 * marks as the Code page. Used by the code drawer and the row panels.
 */
export function SourcePreview({ path, lines }: { path: string; lines: string | null }) {
  const { manifest } = useViewer();
  const entries = useMemo(() => entriesFromSource(manifest.source), [manifest]);
  const entry = entries.find((e) => e.path === path);
  if (!entry) return <p className="m-0 px-4 py-3">No included product points at this path, so the page holds nothing for it.</p>;
  if (entry.bucket !== 'embedded') {
    return (
      <div className="px-4 py-3">
        <p className="m-0 mb-1 text-muted">{bucketLabel(entry.bucket)}</p>
        <p className="m-0">{bucketReason(entry.bucket, entry, manifest.source, manifest.snapshot.revision)}</p>
      </div>
    );
  }
  return <EmbeddedBody path={path} lines={lines} />;
}
