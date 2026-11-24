import { useDashboardStore } from "../store";
import { onCanvasClick, type CanvasAction, type CanvasNodeType } from "./canvasSelection";

/**
 * Runs one click or double click on a canvas node against the store: the pure rule (`onCanvasClick`) decides, this
 * applies it. A group card's selection lives in `selectedGroupId`, every other node's in `selectedNodeId`.
 */
export function runCanvasClick(type: CanvasNodeType, id: string, event: "click" | "dblclick", detail: number): CanvasAction {
  const store = useDashboardStore.getState();
  const selected = type === "group" ? store.selectedGroupId === id : store.selectedNodeId === id;
  const action = onCanvasClick({ type, event, detail, selected });
  if (action.kind === "select") {
    if (type === "group") store.selectGroup(id);
    else store.selectNode(id);
  } else if (action.kind === "deselect") {
    store.selectNode(null);
  } else if (action.kind === "enter") {
    store.enterNode(type, id);
  }
  return action;
}
