import { useReady } from '../hooks/use-signals';
import { Card } from './ui/Card';

/** What the page shows when it cannot be drawn, centred as a page's column is; the page signals `error`. */
export function ErrorCard({ title, error }: { title: string; error: unknown }) {
  useReady('error');
  return (
    <div className="mx-auto my-8 max-w-[1200px] px-8">
      <Card title={title} tone="error">
        <p>{error instanceof Error ? error.message : String(error)}</p>
      </Card>
    </div>
  );
}
