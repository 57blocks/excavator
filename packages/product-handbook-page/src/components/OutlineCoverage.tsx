import { useView } from '../lib/links';
import { useText } from '../lib/text';
import type { PageData } from '../lib/types';

const TECHNICAL_ONLY = new Set(['architecture', 'data', 'applications-matrix', 'dictionaries', 'applications', 'systems']);

/**
 * The part of the coverage page about the outline (openspec change handbook-outline, D5): which outline the chapters follow,
 * the lines of why the default one was used when the written one failed its check, and each block the outline leaves
 * out with its reason (a block only the technical view has is not listed in the product view).
 */
export function OutlineCoverage({ data }: { data: PageData }) {
  const t = useText();
  const view = useView();
  const { outline } = data;
  const left = outline.unplaced.filter((item) => view === 'technical' || !TECHNICAL_ONLY.has(item.block));
  return (
    <section className="section" data-part="outline-coverage" aria-labelledby="cov-outline">
      <h2 className="section-title" id="cov-outline">{t('md.coverage.outlineHeading')}</h2>
      {outline.source === 'outline' && <p className="muted">{t('md.coverage.outlineUsed')}</p>}
      {outline.source === 'default' && outline.problems.length === 0 && <p className="muted">{t('md.coverage.outlineDefault')}</p>}
      {outline.source === 'default' && outline.problems.length > 0 && (
        <>
          <p className="muted">{t('md.coverage.outlineFailed')}</p>
          <ul className="plain-list" data-part="outline-problems">{outline.problems.map((line, at) => <li key={at}>{line}</li>)}</ul>
        </>
      )}
      {left.length > 0 && (
        <>
          <h3 className="block-title">{t('md.coverage.outlineUnplacedHeading')}</h3>
          <ul className="plain-list" data-part="outline-unplaced">
            {left.map((item) => <li key={item.block}>{t('md.coverage.outlineUnplacedItem', { block: item.title, reason: item.reason })}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
