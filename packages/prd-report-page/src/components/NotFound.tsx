export function NotFound({ what }: { what: string }) {
  return (
    <div className="page not-found" data-view="not-found">
      <h1>Not found</h1>
      <p className="lede">{what}</p>
      <p><a href="#/">Back to the overview</a></p>
    </div>
  );
}
