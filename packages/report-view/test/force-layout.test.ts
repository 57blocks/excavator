import { describe, expect, it } from 'vitest';

import { computeForceLayout, type ForceNode, type ForceRequest, type ForceResponse } from '../src/lib/force-layout';
import { LayoutCancelled, startLayoutTask, type LayoutWorker } from '../src/lib/force-layout-client';

const node = (id: string, fixed = false): ForceNode => ({ id, width: 200, height: 48, ...(fixed ? { fixed } : {}) });

describe('computeForceLayout', () => {
  const nodes = [node('c', true), ...['a', 'b', 'd', 'e', 'f'].map((id) => node(id))];
  const links = ['a', 'b', 'd', 'e', 'f'].map((id) => ({ source: 'c', target: id }));

  it('gives every node a finite position and holds the fixed node at the origin', () => {
    const positions = computeForceLayout(nodes, links);
    expect(positions.map((p) => p.id)).toEqual(nodes.map((n) => n.id));
    for (const p of positions) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    const center = positions.find((p) => p.id === 'c');
    expect((center?.x ?? 1) + 100).toBeCloseTo(0, 6);
    expect((center?.y ?? 1) + 24).toBeCloseTo(0, 6);
  });

  it('is the same for the same nodes and links in the same order', () => {
    expect(computeForceLayout(nodes, links)).toEqual(computeForceLayout(nodes, links));
  });

  it('keeps the nodes apart: no two boxes overlap', () => {
    const positions = computeForceLayout(nodes, links);
    for (const a of positions) {
      for (const b of positions) {
        if (a === b) continue;
        expect(a.x + 200 <= b.x || b.x + 200 <= a.x || a.y + 48 <= b.y || b.y + 48 <= a.y, `${a.id} and ${b.id}`).toBe(true);
      }
    }
  });

  it('keeps a crowd of boxes of two sizes apart, the fixed one included, and packs them closer than a ring of circles would', () => {
    const crowd: ForceNode[] = [{ id: 'center', width: 264, height: 60, fixed: true }, ...Array.from({ length: 60 }, (_, i) => node(`n${i}`))];
    const web = [...crowd.slice(1).map((n) => ({ source: 'center', target: n.id })), ...crowd.slice(1, 40).map((n, i) => ({ source: n.id, target: crowd[1 + ((i * 7 + 3) % 60)].id }))];
    const positions = computeForceLayout(crowd, web);
    const box = (id: string) => {
      const p = positions.find((q) => q.id === id) as { x: number; y: number };
      const n = crowd.find((q) => q.id === id) as ForceNode;
      return { ...p, width: n.width, height: n.height };
    };
    for (let i = 0; i < crowd.length; i++) {
      for (let j = i + 1; j < crowd.length; j++) {
        const a = box(crowd[i].id);
        const b = box(crowd[j].id);
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${a.x},${a.y} ${b.x},${b.y}`).toBe(true);
      }
    }
    const xs = positions.map((p) => p.x);
    const ys = positions.map((p) => p.y);
    // 61 boxes of about 224 x 48 need about 61 * 270 * 62 = 1.0M square units; a ring of circles of radius 124 would span more than 3000 across.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(3000);
    expect((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))).toBeLessThan(12_000_000);
  });

  it('ignores a link to a node that is not there, and gives nothing for no nodes', () => {
    expect(computeForceLayout(nodes, [...links, { source: 'c', target: 'missing' }])).toHaveLength(nodes.length);
    expect(computeForceLayout([], [])).toEqual([]);
  });
});

/** A worker that answers with whatever `answer` makes of the request (or never). */
function fakeWorker(answer: ((request: ForceRequest) => ForceResponse | 'unreadable' | null) | null) {
  const log = { terminated: 0 };
  const worker = {
    onmessage: null as ((event: MessageEvent<ForceResponse>) => void) | null,
    onmessageerror: null as (() => void) | null,
    onerror: null,
    postMessage(request: ForceRequest) {
      const response = answer?.(request);
      queueMicrotask(() => {
        if (response === 'unreadable') worker.onmessageerror?.();
        else if (response) worker.onmessage?.({ data: response } as MessageEvent<ForceResponse>);
      });
    },
    terminate() {
      log.terminated += 1;
    },
  };
  return { worker: worker as unknown as LayoutWorker, log };
}

const REQUEST: ForceRequest = { requestId: 7, nodes: [node('a')], links: [] };

describe('startLayoutTask', () => {
  it('resolves with the positions of the answer to its request and ends the worker', async () => {
    const { worker, log } = fakeWorker((request) => ({ requestId: request.requestId, positions: [{ id: 'a', x: 1, y: 2 }] }));
    await expect(startLayoutTask(REQUEST, () => worker).promise).resolves.toEqual([{ id: 'a', x: 1, y: 2 }]);
    expect(log.terminated).toBe(1);
  });

  it('rejects, naming the cause, for a failed, a mismatched and an unreadable answer', async () => {
    await expect(startLayoutTask(REQUEST, () => fakeWorker((r) => ({ requestId: r.requestId, error: 'boom' })).worker).promise).rejects.toThrow('The layout worker failed: boom');
    await expect(startLayoutTask(REQUEST, () => fakeWorker(() => ({ requestId: 99, positions: [] })).worker).promise).rejects.toThrow('answered request 99');
    await expect(startLayoutTask(REQUEST, () => fakeWorker(() => 'unreadable').worker).promise).rejects.toThrow('could not be read');
  });

  it('rejects when the worker cannot start, with no fallback layout in its place', async () => {
    await expect(startLayoutTask(REQUEST, () => { throw new Error('no workers here'); }).promise).rejects.toThrow('no workers here');
  });

  it('stops a request that is cancelled, ending the worker, and says it was cancelled', async () => {
    const { worker, log } = fakeWorker(null);
    const task = startLayoutTask(REQUEST, () => worker);
    task.cancel();
    await expect(task.promise).rejects.toBeInstanceOf(LayoutCancelled);
    expect(log.terminated).toBe(1);
    task.cancel();
    expect(log.terminated).toBe(1);
  });
});
