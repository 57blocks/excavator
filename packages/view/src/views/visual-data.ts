// The structure model and language colors the graph levels draw with (task
// 10.0), built once per mounted data set and shared by every level, so the
// graph uses the same language mapping as the overview and the treemap.
import type { ViewData } from '../data';
import { languageColors, languageOrder } from '../model/colors';
import { buildStructure, type StructureModel } from '../model/tree';

const cache = new WeakMap<ViewData, { structure: StructureModel; colors: Map<string, string> }>();

export function visualData(data: ViewData): { structure: StructureModel; colors: Map<string, string> } {
  let hit = cache.get(data);
  if (!hit) {
    hit = { structure: buildStructure(data.segments, data.strings, data.meta), colors: languageColors(languageOrder(data.coverage)) };
    cache.set(data, hit);
  }
  return hit;
}
