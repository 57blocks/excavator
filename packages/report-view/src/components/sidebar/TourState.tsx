import { useMemo } from 'react';

import { findProduct } from '../../data/manifest';
import { formatNumber } from '../../lib/format';
import { tourIdle, tourSteps } from '../../lib/tour-state';
import { useLoaded, useViewer } from '../../state/viewer';

/**
 * The Learn mode's sidebar when nothing is selected, until the learn panel draws the tour (design D1, D8): the tour
 * product's state as the packer wrote it, and for an included tour its steps' titles.
 */
export function TourState() {
  const { manifest, payloads } = useViewer();
  const product = findProduct(manifest, 'tour');
  const idle = product ? tourIdle(product) : null;
  const payloadId = idle?.state === 'included' && product ? product.payloads[0] : undefined;
  const loaded = useLoaded<unknown>(payloadId ? `tour:${payloadId}` : '', () => (payloadId ? payloads.parsed(payloadId) : Promise.resolve(null)));
  const steps = useMemo(() => (loaded.state === 'ready' ? tourSteps(loaded.value) : []), [loaded]);

  if (!product || !idle) return <p className="m-0 text-muted">The page lists no tour product.</p>;
  return (
    <div className="flex flex-col gap-3 text-[13.5px]" data-xv-tour-state={idle.state}>
      {idle.state === 'not-run' ? (
        <>
          <p className="m-0">{`Not run: there is no ${idle.file} in .excavator/.`}</p>
          <p className="m-0">Command: <code data-xv-tour-command="">{idle.command}</code></p>
        </>
      ) : null}
      {idle.state === 'unreadable' ? <p className="m-0" data-xv-tour-reason="">{`Unreadable: ${idle.reason}`}</p> : null}
      {idle.state === 'different-revision' ? (
        <>
          <p className="m-0">The tour was made from other facts than this graph, so its steps are not shown.</p>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">Tour factDigest</dt>
            <dd className="m-0 break-all font-mono" data-xv-tour-digest="tour">{idle.tourDigest ?? 'not recorded'}</dd>
            <dt className="text-muted">Graph factsDigest</dt>
            <dd className="m-0 break-all font-mono" data-xv-tour-digest="graph">{idle.graphDigest ?? 'not recorded'}</dd>
          </dl>
        </>
      ) : null}
      {idle.state === 'included' ? (
        <>
          <p className="m-0" data-xv-tour-steps={idle.steps}>{`${formatNumber(idle.steps)} step${idle.steps === 1 ? '' : 's'}`}</p>
          {loaded.state === 'error' ? <p className="m-0 text-muted">{loaded.error.message}</p> : null}
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {steps.map((step) => (
              <li key={`${step.order}:${step.title}`} data-xv-tour-step={step.order} className="flex gap-2">
                <span className="w-6 shrink-0 text-right font-mono text-xs leading-5 text-muted">{step.order}</span>
                <span className="min-w-0 text-ink">{step.title}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </div>
  );
}
