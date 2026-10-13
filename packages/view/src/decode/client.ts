// Decode the embedded payload off the main thread. The Worker is the normal
// path; the main thread is the fallback only when a Worker cannot be created
// or fails to start (no Worker global, a blocked blob URL). A decode error
// reported BY the Worker is the data's fault and is not retried.
//
// After decoding, the Worker stays alive as the page's query service; on the
// fallback the same query engine runs on the main thread.
import { decodeBundle } from '../../../../skills/excavator-view/bundle-codec.mjs';
import DecodeWorker from './worker?worker&inline';
import type { QueryResult } from '../model/engine';
import type { WorkerMessage } from './protocol';
import { mainThreadQueries, type QueryService } from './queries';

export class BundleError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

export interface Decoded {
  segments: Record<string, unknown>;
  mode: 'worker' | 'main';
  queries: QueryService;
}

async function decodeOnMainThread(payload: string): Promise<Decoded> {
  const { segments } = await decodeBundle(payload);
  return { segments, mode: 'main', queries: mainThreadQueries(segments) };
}

function workerQueries(worker: Worker): QueryService {
  let nextId = 1;
  const pending = new Map<number, { resolve: (r: QueryResult) => void; reject: (e: Error) => void; onProgress?: (done: number, total: number) => void }>();
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const data = event.data;
    if (data.type === 'decoded') return;
    const waiter = pending.get(data.id);
    if (!waiter) return;
    if (data.type === 'progress') {
      waiter.onProgress?.(data.done, data.total);
      return;
    }
    pending.delete(data.id);
    if (data.ok) waiter.resolve(data.result);
    else waiter.reject(new BundleError(data.name, data.message));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    const error = new BundleError('QueryWorkerError', event.message || 'the data worker failed');
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  return {
    run(query, onProgress) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress });
        worker.postMessage({ type: 'query', id, query });
      });
    },
  };
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
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const data = event.data;
      if (data.type !== 'decoded') return;
      if (data.ok) resolve({ segments: data.segments, mode: 'worker', queries: workerQueries(worker) });
      else {
        worker.terminate();
        reject(new BundleError(data.name, data.message));
      }
    };
    worker.onerror = (event) => {
      // The Worker itself failed (not the data): fall back to the main thread.
      event.preventDefault();
      worker.terminate();
      decodeOnMainThread(payload).then(resolve, reject);
    };
    worker.postMessage({ type: 'decode', payload });
  });
}

export function decodePayload(payload: string): Promise<Decoded> {
  return decodeInWorker(payload) ?? decodeOnMainThread(payload);
}
