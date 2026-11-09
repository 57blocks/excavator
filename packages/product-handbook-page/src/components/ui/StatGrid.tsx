export interface Stat {
  label: string;
  value: string | number;
}

/** Counts as a grid of small cards, each a label and its value; `part` names the grid for tests and for the stylesheet. The value is read first on screen and the label first by a screen reader. */
export function StatGrid({ part, stats }: { part: string; stats: Stat[] }) {
  return (
    <dl className="stat-grid" data-part={part}>
      {stats.map((stat, at) => (
        <div className="stat-card" data-part="stat" key={at}>
          <dt>{stat.label}</dt>
          <dd>{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}
