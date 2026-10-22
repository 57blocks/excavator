/**
 * One request to a layout worker (openspec: changes/viewer-app, design D4). Each
 * request gets a fresh worker, so cancelling stops a long simulation instead of
 * queueing behind it. A worker that cannot start, fails or answers for another
 * request is an error the page shows; there is no fallback layout that would
 * pass for the real one.
 */

import type { ForcePosition, ForceRequest, ForceResponse } from './force-layout';

export type LayoutWorker = Pick<Worker, 'onmessage' | 'onmessageerror' | 'onerror' | 'postMessage' | 'terminate'>;

export class LayoutCancelled extends Error {
  constructor() {
    super('The layout request was cancelled');
    this.name = 'LayoutCancelled';
  }
}

export interface LayoutTask {
  promise: Promise<ForcePosition[]>;
  cancel: () => void;
}

export function startLayoutTask(request: ForceRequest, createWorker: () => LayoutWorker): LayoutTask {
  let worker: LayoutWorker;
  try {
    worker = createWorker();
  } catch (error) {
    return { promise: Promise.reject(error instanceof Error ? error : new Error(String(error))), cancel: () => {} };
  }
  let settled = false;
  let reject: (reason: unknown) => void = () => {};
  const cleanup = () => {
    worker.onmessage = null;
    worker.onmessageerror = null;
    worker.onerror = null;
    worker.terminate();
  };
  const promise = new Promise<ForcePosition[]>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(error);
    };
    worker.onmessage = (event: MessageEvent<ForceResponse>) => {
      if (settled) return;
      const response = event.data;
      if (response.requestId !== request.requestId) return fail(new Error(`The layout worker answered request ${response.requestId}; the request was ${request.requestId}`));
      if ('error' in response) return fail(new Error(`The layout worker failed: ${response.error}`));
      settled = true;
      cleanup();
      resolvePromise(response.positions);
    };
    worker.onmessageerror = () => fail(new Error('The layout worker sent an answer that could not be read'));
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      fail(new Error(event.message || 'The layout worker failed'));
    };
    try {
      worker.postMessage(request);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new LayoutCancelled());
    },
  };
}
