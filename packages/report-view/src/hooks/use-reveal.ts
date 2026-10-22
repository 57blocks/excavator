import { useReactFlow } from '@xyflow/react';
import { useEffect, useRef, type RefObject } from 'react';

import { READABLE_ZOOM } from '../lib/camera';
import { measureFitPadding } from '../lib/fit-padding';
import { DURATION } from '../lib/motion';

const MAX_ZOOM = 1.2;

/**
 * The selected node stays in view: when a layout or the code drawer leaves it outside or under the drawer, the camera
 * moves to it, keeping the zoom unless that is too small to read. `layoutKey` names the laid-out level (null while none
 * is); it is when it changes, the selection changes or the drawer opens or closes that the node is looked for.
 */
export function useReveal({ pane, layoutKey, selected, drawerOpen, reduce }: { pane: RefObject<HTMLElement | null>; layoutKey: string | null; selected: string | null; drawerOpen: boolean; reduce: boolean | null }) {
  const { getInternalNode, getViewport, setViewport } = useReactFlow();
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (layoutKey === null || selected === null) return undefined;
    const mark = `${layoutKey}|${selected}|${drawerOpen}`;
    if (revealed.current === mark) return undefined;
    const timer = window.setTimeout(() => {
      const node = getInternalNode(selected);
      const element = pane.current;
      if (!node || !element) return;
      revealed.current = mark;
      const { x, y, zoom } = getViewport();
      const box = element.getBoundingClientRect();
      const width = node.measured.width ?? node.width ?? 0;
      const height = node.measured.height ?? node.height ?? 0;
      const at = node.internals.positionAbsolute;
      const [left, top] = [at.x * zoom + x, at.y * zoom + y];
      const safe = { top: measureFitPadding(element).top, bottom: drawerOpen ? box.height * 0.6 - 16 : box.height - 16, left: 16, right: box.width - 16 };
      if (left >= safe.left && top >= safe.top && left + width * zoom <= safe.right && top + height * zoom <= safe.bottom) return;
      const next = Math.min(Math.max(zoom, READABLE_ZOOM), MAX_ZOOM);
      setViewport({ x: box.width / 2 - (at.x + width / 2) * next, y: (safe.top + safe.bottom) / 2 - (at.y + height / 2) * next, zoom: next }, { duration: reduce ? 0 : DURATION.camera * 1000 });
    }, reduce ? 0 : DURATION.camera * 1000 + 80);
    return () => window.clearTimeout(timer);
  }, [layoutKey, selected, drawerOpen, reduce, getInternalNode, getViewport, setViewport]);
}
