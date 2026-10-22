import { useReady } from '../hooks/use-signals';
import { Card } from './ui/Card';

/** What the page shows when it cannot be drawn; the page signals `error`. */
export function ErrorCard({ title, error }: { title: string; error: unknown }) {
  useReady('error');
  return (
    <div className="m-8">
      <Card title={title} tone="error">
        <p>{error instanceof Error ? error.message : String(error)}</p>
      </Card>
    </div>
  );
}
