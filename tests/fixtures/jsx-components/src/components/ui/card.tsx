export default function Card({ children }: { children?: unknown }) {
  return <div className="card">{children}</div>;
}

export function CardTitle({ children }: { children?: unknown }) {
  return <h2>{children}</h2>;
}
