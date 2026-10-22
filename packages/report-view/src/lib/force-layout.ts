/**
 * The focus view's layout (openspec: changes/viewer-app, design D4): a d3-force
 * simulation over the focused node and its neighbours, the focused node held at
 * the origin. It touches no DOM, so a worker runs it and a unit test can too.
 * The simulation starts from d3's own deterministic seed, so the same nodes and
 * links in the same order give the same positions. The nodes are wide boxes, so
 * they are kept apart by a force that separates boxes (d3's own collision force
 * separates circles, which would leave a ring of them far apart), and a last pass
 * separates any boxes that still overlap when the ticks are over.
 */

import { forceCenter, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Force, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';

export interface ForceNode {
  id: string;
  width: number;
  height: number;
  /** The node is held at the origin. */
  fixed?: boolean;
}

export interface ForceLink {
  source: string;
  target: string;
}

export interface ForcePosition {
  id: string;
  /** The top-left corner of the node's box. */
  x: number;
  y: number;
}

export interface ForceRequest {
  requestId: number;
  nodes: ForceNode[];
  links: ForceLink[];
}

export type ForceResponse = { requestId: number; positions: ForcePosition[] } | { requestId: number; error: string };

interface SimNode extends SimulationNodeDatum {
  id: string;
  width: number;
  height: number;
}

/** The space left between two boxes. */
const GAP = 14;

/**
 * Push apart every two boxes that overlap, along the axis in which they overlap
 * least; a fixed node does not move, and two movable ones share the push. Returns
 * how many pairs overlapped.
 */
function separate(nodes: readonly SimNode[], strength: number): number {
  let overlapping = 0;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const aFixed = a.fx !== undefined && a.fx !== null;
      const bFixed = b.fx !== undefined && b.fx !== null;
      if (aFixed && bFixed) continue;
      const dx = (b.x ?? 0) - (a.x ?? 0);
      const dy = (b.y ?? 0) - (a.y ?? 0);
      const overlapX = (a.width + b.width) / 2 + GAP - Math.abs(dx);
      const overlapY = (a.height + b.height) / 2 + GAP - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      overlapping += 1;
      const shareA = aFixed ? 0 : bFixed ? 1 : 0.5;
      if (overlapX < overlapY) {
        const push = (dx < 0 ? -1 : 1) * overlapX * strength;
        a.x = (a.x ?? 0) - push * shareA;
        b.x = (b.x ?? 0) + push * (1 - shareA);
      } else {
        const push = (dy < 0 ? -1 : 1) * overlapY * strength;
        a.y = (a.y ?? 0) - push * shareA;
        b.y = (b.y ?? 0) + push * (1 - shareA);
      }
    }
  }
  return overlapping;
}

/** A d3 force that separates the boxes of the nodes it is given. */
function boxes(): Force<SimNode, never> {
  let nodes: SimNode[] = [];
  const force = (() => {
    separate(nodes, 0.6);
  }) as Force<SimNode, never>;
  force.initialize = (given) => {
    nodes = given;
  };
  return force;
}

export function computeForceLayout(nodes: readonly ForceNode[], links: readonly ForceLink[]): ForcePosition[] {
  if (nodes.length === 0) return [];
  const sim: SimNode[] = nodes.map((node) => ({ id: node.id, width: node.width, height: node.height, ...(node.fixed ? { fx: 0, fy: 0 } : {}) }));
  const ids = new Set(sim.map((node) => node.id));
  const simLinks: SimulationLinkDatum<SimNode>[] = links.filter((link) => ids.has(link.source) && ids.has(link.target)).map((link) => ({ source: link.source, target: link.target }));
  const large = nodes.length > 100;

  const simulation = forceSimulation<SimNode>(sim)
    .force('link', forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks).id((node) => node.id).distance(large ? 230 : 180).strength(0.25))
    .force('charge', forceManyBody().strength(large ? -500 : -300).distanceMax(1400))
    .force('center', forceCenter(0, 0).strength(0.03))
    .force('x', forceX(0).strength(0.02))
    .force('y', forceY(0).strength(0.02))
    .force('boxes', boxes());
  simulation.tick(Math.min(300, Math.max(120, nodes.length)));
  simulation.stop();
  for (let pass = 0; pass < 200 && separate(sim, 1) > 0; pass++);

  return sim.map((node) => ({
    id: node.id,
    x: (Number.isFinite(node.x) ? (node.x ?? 0) : 0) - node.width / 2,
    y: (Number.isFinite(node.y) ? (node.y ?? 0) : 0) - node.height / 2,
  }));
}
