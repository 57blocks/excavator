// The graph's layer coloring switch and legend (artifact-view task 8.2).
// Only nodes that are one graph node (a symbol, or a file through its file
// node) take a layer color; directory aggregates keep their tone, and the
// legend says so. A node no layer lists is "unlayered". A stale semantic
// graph still colors, labelled stale.
import { Badge } from '../components/Badge';
import { fmtNumber } from '../format';
import { UNLAYERED_COLOR_VAR, type LayerModel } from '../model/semantics';

export function LayerLegend({ model, on, onToggle, colored, unlayered, aggregates }: {
  model: LayerModel | null;
  on: boolean;
  onToggle: () => void;
  /** Drawn nodes per layer index, at this level. */
  colored: Map<number, number>;
  /** Drawn single-node items no layer lists. */
  unlayered: number;
  /** Drawn aggregates (directories) that are never colored. */
  aggregates: number;
}) {
  if (!model) {
    return (
      <p className="muted" data-layer-legend="not-generated">
        Layer coloring: no semantic-graph.json in this page.
      </p>
    );
  }
  return (
    <div className="layer-legend" data-layer-legend={on ? 'on' : 'off'} data-layer-stale={model.stale ? 'true' : 'false'}>
      <button type="button" className="legend-toggle" aria-pressed={on} onClick={onToggle} data-layer-toggle="">
        Color by layer
      </button>
      {model.stale && <Badge state="stale">Layers stale</Badge>}
      {on && (
        <ul className="legend" aria-label="Layers">
          {model.layers.map((layer) => (
            <li key={layer.id} data-layer-swatch={layer.id} data-layer-drawn={colored.get(layer.index) ?? 0}>
              <span className="swatch" style={{ background: `var(${layer.colorVar})` }} />
              {layer.name} <span className="muted">{fmtNumber(colored.get(layer.index) ?? 0)}</span>
            </li>
          ))}
          <li data-layer-swatch="unlayered" data-layer-drawn={unlayered}>
            <span className="swatch" style={{ background: `var(${UNLAYERED_COLOR_VAR})` }} />
            unlayered <span className="muted">{fmtNumber(unlayered)}</span>
          </li>
          {aggregates > 0 && <li className="muted">{fmtNumber(aggregates)} directory aggregates are not colored</li>}
        </ul>
      )}
    </div>
  );
}
