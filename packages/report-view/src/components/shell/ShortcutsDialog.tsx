import { SHORTCUTS } from '../../lib/shortcuts';
import { useGraphUi } from '../../state/graph-ui';
import { Dialog } from './Dialog';

/** The `?` dialog: every shortcut the viewer has. */
export function ShortcutsDialog() {
  const { overlay, setOverlay } = useGraphUi();
  return (
    <Dialog open={overlay === 'shortcuts'} title="Keyboard shortcuts" onClose={() => setOverlay(null)}>
      <dl className="m-0 grid grid-cols-[max-content_1fr] items-baseline gap-x-5 gap-y-2.5">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className="contents">
            <dt><kbd className="rounded-control border border-line-2 bg-paper px-2 py-0.5 font-mono text-xs text-ink">{shortcut.keys}</kbd></dt>
            <dd className="m-0">{shortcut.description}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
