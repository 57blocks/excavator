import { NOT_PROVIDED } from '../lib/format';
import { sparkBars, yearSeries, yearText } from '../lib/hotspots';

const WIDTH = 84;
const HEIGHT = 24;
const GAP = 1;

/** One bar per year of commits, in a box of 84 x 24; a product without the field says so, and null is empty. */
export function sparkline(commitsByYear: unknown) {
  const series = yearSeries(commitsByYear);
  if (series === null) return commitsByYear === undefined ? NOT_PROVIDED : null;
  return (
    <svg className="block border-b border-line-2" width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Commits by year: ${yearText(series)}`}>
      {sparkBars(series, WIDTH, HEIGHT, GAP).map((bar) => (
        <rect key={bar.title} x={bar.x} y={bar.y} width={bar.width} height={bar.height} className="fill-accent">
          <title>{bar.title}</title>
        </rect>
      ))}
    </svg>
  );
}
