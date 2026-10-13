// Open a local `.excavator/` directory (task 9.2): drop it here or pick it
// with a directory picker. The files are read in this tab by the data Worker
// with the same rules as the bake and never leave the browser. Shown on the
// unbaked template, and at #/open on a baked page. A directory that cannot
// be read shows its error here; the current page stays as it was.
import { useState, type DragEvent } from 'react';
import { readDroppedData } from '../bundle';
import { droppedFiles, pickedFiles } from '../drop/collect';
import { showData } from '../drop/host';
import { clearBusy, countError, markBusy, report } from '../instrument';
import type { DroppedFile } from '../decode/protocol';

const BUSY_KEY = 'drop-read';

type State = { kind: 'idle' } | { kind: 'reading'; files: number } | { kind: 'error'; message: string };

export function DropZone() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [over, setOver] = useState(false);

  const load = async (files: DroppedFile[]) => {
    if (files.length === 0) {
      setState({ kind: 'error', message: 'Nothing was dropped: pick or drop a .excavator directory.' });
      return;
    }
    setState({ kind: 'reading', files: files.length });
    markBusy(BUSY_KEY);
    report('data-drop-state', 'reading');
    try {
      const data = await readDroppedData(files);
      report('data-drop-state', 'loaded');
      showData(data);
    } catch (error) {
      countError();
      const err = error instanceof Error ? error : new Error(String(error));
      report('data-drop-state', 'error');
      setState({ kind: 'error', message: `${err.name}: ${err.message}` });
    } finally {
      clearBusy(BUSY_KEY);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    droppedFiles(event.dataTransfer).then(load, (error: unknown) => setState({ kind: 'error', message: String(error) }));
  };

  return (
    <div
      className="drop-zone"
      data-drop-zone={state.kind}
      data-drop-over={over ? 'true' : 'false'}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <p>
        <strong>Drop a .excavator directory here</strong>, or{' '}
        <label className="drop-pick">
          choose one
          <input
            type="file"
            data-drop-input=""
            // React has no typed prop for these; the attributes enable directory picking.
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            multiple
            onChange={(event) => load(pickedFiles(event.currentTarget.files))}
          />
        </label>
        .
      </p>
      <p className="secondary" data-drop-note="local">
        The files are read in this browser tab and never leave it. Source text is not shown for a dropped directory: the page reads only the
        .excavator artifacts, not the project's source.
      </p>
      {state.kind === 'reading' && <p className="muted">Reading {state.files} files…</p>}
      {state.kind === 'error' && (
        <p className="alert" role="alert" data-drop-error="">
          Could not read this directory. {state.message}
        </p>
      )}
    </div>
  );
}
