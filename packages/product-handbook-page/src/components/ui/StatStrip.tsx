export interface Stat {
  label: string;
  value: string | number;
}

/**
 * Counts as one inline strip: a bold number and a small label for each, spaced and wrapping, with no card around
 * them; `part` names the strip for tests and for the stylesheet. The value is read first on screen and the label first
 * by a screen reader.
 */
export function StatStrip({ part, stats }: { part: string; stats: Stat[] }) {
  return (
    <dl className="stat-strip" data-part={part}>
      {stats.map((stat, at) => (
        <div className="stat-item" data-part="stat" key={at}>
          <dt>{stat.label}</dt>
          <dd>{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A breakdown as a title and a run of small "label n" chips. */
export function StatChips({ part, title, stats }: { part: string; title: string; stats: Stat[] }) {
  return (
    <div className="stat-chips" data-part={part}>
      <span className="stat-chips-title">{title}</span>
      <ul role="list">
        {stats.map((stat, at) => <li className="stat-chip" key={at}>{stat.label} <b>{stat.value}</b></li>)}
      </ul>
    </div>
  );
}
