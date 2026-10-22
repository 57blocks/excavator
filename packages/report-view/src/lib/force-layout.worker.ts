import { computeForceLayout, type ForceRequest, type ForceResponse } from './force-layout';

self.onmessage = (event: MessageEvent<ForceRequest>) => {
  const { requestId, nodes, links } = event.data;
  let response: ForceResponse;
  try {
    response = { requestId, positions: computeForceLayout(nodes, links) };
  } catch (error) {
    response = { requestId, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
