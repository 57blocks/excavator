// Data Worker: built inline (Vite `?worker&inline`) and started from a blob
// URL, so it works from file://. It decodes with the shared codec (or reads a
// dropped directory with the shared bake rules), keeps a
// copy of the columns the query engine reads, hands the decoded columns to the
// page by transfer, then answers queries. Query indexes are built on first
// use, never on the decode (ready) path.
import { decodeBundle } from '../../../../skills/excavator-view/bundle-codec.mjs';
import { readDroppedDirectory } from '../../../../skills/excavator-view/shared/drop-mode.mjs';
import { QueryEngine, retainForQueries } from '../model/engine';
import { transferables, type WorkerMessage, type WorkerRequest } from './protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerMessage, transfer: Transferable[]): void;
};

let engine: QueryEngine | null = null;

function failure(error: unknown): { name: string; message: string } {
  const err = error instanceof Error ? error : new Error(String(error));
  return { name: err.name, message: err.message };
}

function answer(load: Promise<Record<string, unknown>>): void {
  load.then(
    (segments) => {
      engine = new QueryEngine(retainForQueries(segments));
      scope.postMessage({ type: 'decoded', ok: true, segments }, transferables(segments));
    },
    (error: unknown) => scope.postMessage({ type: 'decoded', ok: false, ...failure(error) }, []),
  );
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'decode') {
    answer(decodeBundle(request.payload).then(({ segments }) => segments));
    return;
  }
  if (request.type === 'parse-dir') {
    answer(readDroppedDirectory(request.files));
    return;
  }
  const { id, query } = request;
  if (!engine) {
    scope.postMessage({ type: 'result', id, ok: false, name: 'QueryError', message: 'the bundle is not decoded' }, []);
    return;
  }
  try {
    const result = engine.run(query, (done, total) => scope.postMessage({ type: 'progress', id, done, total }, []));
    scope.postMessage({ type: 'result', id, ok: true, result }, []);
  } catch (error) {
    scope.postMessage({ type: 'result', id, ok: false, ...failure(error) }, []);
  }
};
