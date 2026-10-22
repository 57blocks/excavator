import { useMemo } from 'react';

import type { GraphNode } from '../data/graph';
import { bucketLabel, bucketReason, codeHash, entriesFromSource, lineNotice, lineStatus, splitLines } from '../lib/code';
import { nodeLines } from '../lib/node-details';
import type { DrawerState } from '../state/graph-ui';
import { useEmbeddedText } from '../state/source';
import { useViewer } from '../state/viewer';
import { CodeView } from './CodeView';
import { Panel } from './shell/Panel';

const BUTTON = 'cursor-pointer rounded-control border-0 bg-transparent px-2 py-1 text-[13px] text-muted hover:bg-paper hover:text-ink';

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

/** What the drawer shows for a node's file: the file's class decides, as on the Code page. */
function DrawerBody({ node }: { node: GraphNode }) {
  const { manifest } = useViewer();
  const entries = useMemo(() => entriesFromSource(manifest.source), [manifest]);
  const path = typeof node.filePath === 'string' ? node.filePath : null;
  if (path === null) return <p className="m-0 px-4 py-3 text-muted">This node has no file path, so there is no source to show.</p>;
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
  return <EmbeddedBody path={path} lines={nodeLines(node)} />;
}

/**
 * The code drawer along the bottom: the source of the selected node's file with
 * the node's line range marked, expandable to the whole main area, with a jump
 * to the Code page. It follows the same source classes and line rules as that
 * page and carries the same `.xv-code` marks.
 */
export function CodeDrawer({ node, state, onState, onClose }: { node: GraphNode | null; state: DrawerState; onState: (state: DrawerState) => void; onClose: () => void }) {
  const open = state !== 'closed' && node !== null;
  const path = node && typeof node.filePath === 'string' ? node.filePath : null;
  const lines = node ? nodeLines(node) : null;
  const actions = (
    <>
      <button type="button" data-xv-action="expand" aria-pressed={state === 'full'} onClick={() => onState(state === 'full' ? 'open' : 'full')} className={BUTTON}>
        {state === 'full' ? 'Shrink' : 'Expand'}
      </button>
      {path ? <a href={codeHash(path, node?.lineRange)} data-xv-action="code-page" className={`${BUTTON} hover:no-underline`}>Code page</a> : null}
    </>
  );
  const title = path ? `${path}${lines ? `:${lines}` : ''}` : node ? `${node.name} (no file)` : 'Code';
  return (
    <Panel slot="drawer" open={open} title={title} onClose={onClose} closeOnEscape={false} expanded={state === 'full'} actions={actions} flush>
      {node ? <div className="xv-drawer"><DrawerBody node={node} /></div> : null}
    </Panel>
  );
}
