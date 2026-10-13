// Decode the embedded payload off the main thread. The Worker is the normal
// path; the main thread is the fallback only when a Worker cannot be created
// or fails to start (no Worker global, a blocked blob URL). A decode error
// reported BY the Worker is the data's fault and is not retried.
import { decodeBundle } from '../../../../skills/excavator-view/bundle-codec.mjs';
import DecodeWorker from './worker?worker&inline';
import type { DecodeResponse } from './protocol';

export class BundleError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

export interface Decoded {
  segments: Record<string, unknown>;
  mode: 'worker' | 'main';
}

async function decodeOnMainThread(payload: string): Promise<Decoded> {
  const { segments } = await decodeBundle(payload);
  return { segments, mode: 'main' };
}

function decodeInWorker(payload: string): Promise<Decoded> | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new DecodeWorker();
  } catch {
    return null;
  }
  return new Promise<Decoded>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
      worker.terminate();
      const data = event.data;
      if (data.ok) resolve({ segments: data.segments, mode: 'worker' });
      else reject(new BundleError(data.name, data.message));
    };
    worker.onerror = (event) => {
      // The Worker itself failed (not the data): fall back to the main thread.
      event.preventDefault();
      worker.terminate();
      decodeOnMainThread(payload).then(resolve, reject);
    };
    worker.postMessage({ payload });
  });
}

export function decodePayload(payload: string): Promise<Decoded> {
  return decodeInWorker(payload) ?? decodeOnMainThread(payload);
}
