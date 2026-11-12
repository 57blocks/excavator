/**
 * The architecture chapter of the technical view (openspec change handbook-architecture-chapter, D4, D5): when the architecture files
 * are checked, the chapter as written (citations kept, as a feature chapter in the technical view) under the fixed not-verified
 * mark and a mermaid flowchart with one subgraph per layer; otherwise the diagram of the applications and the external systems they
 * call, with one fixed text that says why. Pure and deterministic.
 */

import { renderChapter } from './chapter-render.mjs';
import { inline } from './markdown.mjs';
import { label, structureDiagram } from './render-entities.mjs';
import { shiftHeadings } from './render-outline.mjs';

/** The layers, from the left, with the fixed-text key of each title; the layer of a kind is `LAYER_OF` (architecture-check.mjs). */
const LAYERS = Object.freeze([
  { layer: 0, key: 'md.architecture.layer.users' },
  { layer: 1, key: 'md.architecture.layer.frontend' },
  { layer: 2, key: 'md.architecture.layer.backend' },
  { layer: 3, key: 'md.architecture.layer.services' },
]);

/** The mermaid flowchart of a model (`components` with a layer, `links`): components in the order of the file, an empty layer left out. */
export function architectureMermaid(model, t) {
  const index = new Map(model.components.map((component, at) => [component.id, `C${at}`]));
  const out = ['```mermaid', 'flowchart LR'];
  for (const { layer, key } of LAYERS) {
    const here = model.components.filter((component) => component.layer === layer);
    if (here.length === 0) continue;
    out.push(`  subgraph L${layer}["${label(t(key))}"]`);
    for (const component of here) out.push(`    ${index.get(component.id)}["${label(component.label)}"]`);
    out.push('  end');
  }
  for (const link of model.links) out.push(`  ${index.get(link.from)} -->|"${label(link.text)}"| ${index.get(link.to)}`);
  out.push('```', '');
  return out;
}

/** The lines of the block `architecture`; `entities` is the computed entities of the old diagram, `architecture` the loaded section (architecture-state.mjs). */
export function architectureBlock({ architecture, entities, t }) {
  if (architecture.status !== 'checked') {
    const reason = { none: 'notSelected', failed: 'failed', missing: 'missing' }[architecture.status];
    const old = structureDiagram(entities, t);
    return [old[0], '', t(`md.architecture.${reason}`), '', ...old.slice(2)];
  }
  const body = shiftHeadings(renderChapter(architecture.chapter.text, []).trimEnd().split('\n'), 3);
  return [
    `### ${t('md.architecture.diagramHeading')}`, '',
    inline(t('md.architecture.unverified')), '',
    ...body, '',
    `#### ${t('md.architecture.diagramHeading')}`, '',
    t('md.architecture.diagramNote'), '',
    ...architectureMermaid(architecture.model, t),
  ];
}
