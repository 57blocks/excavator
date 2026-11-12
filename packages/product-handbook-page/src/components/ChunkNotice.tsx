import { PARTS_DIRECTORY } from '../lib/chunks';
import type { Detail } from '../lib/chunks';
import { useText } from '../lib/text';

/** What a page shows in place of its detail while that is loading, or when a part file it needs is not there; the rest of the page is unaffected. */
export function ChunkNotice({ state }: { state: Exclude<Detail<unknown>, { status: 'ready' }> }) {
  const t = useText();
  if (state.status === 'loading') return <p className="muted" role="status" data-part="chunk-loading">{t('page.chunk.loading')}</p>;
  return (
    <div className="notice" role="note" data-part="chunk-missing">
      <p>{t('page.chunk.missing', { parts: state.parts.map((id) => `${PARTS_DIRECTORY}/${id}.js`).join(', ') })}</p>
    </div>
  );
}
