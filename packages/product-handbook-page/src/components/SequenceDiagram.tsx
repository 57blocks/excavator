import type { Sequence } from '../lib/types';

/** The width of one participant's column and the height of one step's row, in pixels. */
export const COLUMN = 132;
export const ROW = 40;
const LOOP = 22;
const HEAD = 8;

/** A filled arrowhead whose tip is at (x, y), pointing right for `direction` 1 and left for -1; drawn as a path, so the page needs no marker id. */
const head = (x: number, y: number, direction: number): string => `M${x},${y} L${x - direction * HEAD},${y - 4} L${x - direction * HEAD},${y + 4} z`;

/**
 * The sequence diagram of an operation (openspec change handbook-deep-entry, design D4): the script computed the
 * participants and, per step, the two it joins; this draws them. The names are HTML above the drawing so that a long
 * name wraps; the drawing is an inline SVG of the lifelines and one numbered arrow per step, top to bottom, a step that
 * stays with the same participant drawn as a loop. Columns have a fixed width, so a diagram wider than the content
 * scrolls inside its own box and the page never does.
 */
export function SequenceDiagram({ sequence, label }: { sequence: Sequence; label: string }) {
  const { participants, steps } = sequence;
  const width = participants.length * COLUMN;
  const height = (steps.length + 1) * ROW;
  const x = (at: number): number => at * COLUMN + COLUMN / 2;
  return (
    <figure className="seq" data-part="sequence">
      <div className="seq-scroll">
        <div className="seq-inner" style={{ width }}>
          <ol className="seq-heads" style={{ gridTemplateColumns: `repeat(${participants.length}, ${COLUMN}px)` }}>
            {participants.map((name, at) => <li key={at} className="seq-head" data-starter={at === 0 ? '' : undefined}>{name}</li>)}
          </ol>
          <svg className="seq-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
            {participants.map((_, at) => <line key={at} className="seq-life" x1={x(at)} y1={0} x2={x(at)} y2={height} />)}
            {steps.map((step, at) => {
              const y = (at + 1) * ROW;
              const number = String(at + 1);
              if (step.from === step.to) {
                const left = x(step.to);
                return (
                  <g key={at} className="seq-step" data-step={number}>
                    <path className="seq-arrow" d={`M${left},${y - 8} h${LOOP} v16 h${-(LOOP - HEAD)}`} fill="none" />
                    <path className="seq-arrowhead" d={head(left, y + 8, -1)} />
                    <circle className="seq-badge" cx={left + LOOP + 12} cy={y} r={9} />
                    <text className="seq-number" x={left + LOOP + 12} y={y} dy="0.35em" textAnchor="middle">{number}</text>
                  </g>
                );
              }
              const from = x(step.from);
              const to = x(step.to);
              const middle = (from + to) / 2;
              const direction = to > from ? 1 : -1;
              return (
                <g key={at} className="seq-step" data-step={number}>
                  <line className="seq-arrow" x1={from} y1={y} x2={to - direction * HEAD} y2={y} />
                  <path className="seq-arrowhead" d={head(to, y, direction)} />
                  <circle className="seq-badge" cx={middle} cy={y} r={9} />
                  <text className="seq-number" x={middle} y={y} dy="0.35em" textAnchor="middle">{number}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </figure>
  );
}
