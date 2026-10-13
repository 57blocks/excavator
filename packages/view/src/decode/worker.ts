// Decode Worker: built inline (Vite `?worker&inline`) and started from a blob
// URL, so it works from file://. It decodes with the shared codec and hands
// the TypedArray columns back by transfer.
import { decodeBundle } from '../../../../skills/excavator-view/bundle-codec.mjs';
import { transferables, type DecodeRequest, type DecodeResponse } from './protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: DecodeResponse, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  decodeBundle(event.data.payload).then(
    ({ segments }) => scope.postMessage({ ok: true, segments }, transferables(segments)),
    (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      scope.postMessage({ ok: false, name: err.name, message: err.message }, []);
    },
  );
};
