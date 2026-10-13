// #/semantics[?flow=<id>&step=<n>] (artifact-view tasks 8.1-8.3): cached
// summaries, architecture layers and relations, and domain flows, each from
// its own product and each with the freshness the bake recorded. A missing
// product says "Not generated" with its command; a stale one stays readable
// and says it is stale. Steps of a flow play in order (framer-motion); under
// reduced motion nothing plays and the current step is only highlighted.
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { ViewData } from '../data';
import { Badge } from '../components/Badge';
import { fmtNumber, text } from '../format';
import { clearBusy, markBusy, report } from '../instrument';
import { useReducedMotion } from '../motion';
import { nodeHash, sectionHash } from '../routes';
import {
  allFlows, domainModel, freshnessBadge, layerModel, productState, semanticEntries, summaryCoverage,
  type DomainFlow, type FlowStep, type ProductState,
} from '../model/semantics';

/** Milliseconds each step stays current while a flow plays. */
export const STEP_MS = 900;

/** Self-report of what the section shows, removed when it goes away. */
function useSemanticsReport(values: Record<string, string | number | null>) {
  const key = JSON.stringify(values);
  useEffect(() => {
    for (const [name, value] of Object.entries(values)) report(`data-semantics-${name}`, value);
  }, [key]);
  useEffect(
    () => () => {
      for (const name of Object.keys(values)) report(`data-semantics-${name}`, null);
    },
    [],
  );
}

function NotGenerated({ product, label }: { product: Exclude<ProductState, { state: 'present' }>; label: string }) {
  if (product.state === 'invalid') {
    return (
      <p data-product-state="invalid">
        <Badge state="invalid">Invalid</Badge> {label} could not be read: {product.reason}
      </p>
    );
  }
  return (
    <p data-product-state="not-generated">
      <Badge state="not-generated">Not generated</Badge> <span className="mono">{product.command}</span>
    </p>
  );
}

export function Semantics({ data, flowParam, stepParam }: { data: ViewData; flowParam: string | null; stepParam: string | null }) {
  const summaries = productState(data.meta, 'semantic-cache.json');
  const layersProduct = productState(data.meta, 'semantic-graph.json');
  const domainProduct = productState(data.meta, 'domain-graph.json');
  const coverage = useMemo(() => summaryCoverage(data.segments, data.counts.nodes), [data]);
  const layers = useMemo(() => layerModel(data.segments, data.strings), [data]);
  const domain = useMemo(() => domainModel(data.segments, data.strings), [data]);
  const flows = useMemo(() => (domain ? allFlows(domain) : []), [domain]);
  const stepNumber = stepParam !== null && /^\d+$/.test(stepParam) ? Number(stepParam) : null;

  useSemanticsReport({
    summaries: summaries.state === 'present' ? `${coverage.withSummary}/${coverage.total}` : summaries.state,
    'summaries-fresh': summaries.state === 'present' ? coverage.fresh : null,
    'summaries-stale': summaries.state === 'present' ? coverage.stale : null,
    layers: layers ? layers.layers.length : layersProduct.state,
    'layers-freshness': layers ? (layers.stale ? 'stale' : 'fresh') : null,
    relations: layers ? layers.relations.length : null,
    domain: domain ? (domain.stale ? 'stale' : 'fresh') : domainProduct.state,
    flows: domain ? domain.counts.flows : null,
    steps: domain ? domain.counts.steps : null,
    unanchored: domain ? domain.counts.unanchored : null,
  });

  return (
    <div className="content" data-section="semantics">
      <section className="card" data-semantics-block="summaries" aria-labelledby="summaries-heading">
        <h2 id="summaries-heading">Summaries</h2>
        {summaries.state !== 'present' ? <NotGenerated product={summaries} label="semantic-cache.json" /> : <SummaryList data={data} coverage={coverage} />}
      </section>

      <section className="card" data-semantics-block="layers" data-stale={layers?.stale ? 'true' : 'false'} aria-labelledby="layers-heading">
        <h2 id="layers-heading">Architecture layers</h2>
        {layersProduct.state !== 'present' || !layers ? (
          layersProduct.state === 'present' ? <p className="muted">The semantic graph carries no layers.</p> : <NotGenerated product={layersProduct} label="semantic-graph.json" />
        ) : (
          <LayersBlock model={layers} />
        )}
      </section>

      <section className="card" data-semantics-block="domain" data-stale={domain?.stale ? 'true' : 'false'} aria-labelledby="domain-heading">
        <h2 id="domain-heading">Domain flows</h2>
        {domainProduct.state !== 'present' || !domain ? (
          domainProduct.state === 'present' ? <p className="muted">The domain graph carries no nodes.</p> : <NotGenerated product={domainProduct} label="domain-graph.json" />
        ) : (
          <>
            <p data-domain-freshness={domain.freshness.state}>
              <Badge state={domain.freshness.state}>{domain.freshness.label}</Badge> <span className="secondary">{domain.reason}</span>
            </p>
            {domain.stale && (
              <p className="secondary" data-hint="domain-stale">
                The flows below are shown as recorded and may no longer match the code. Hint: run /excavator-domain
              </p>
            )}
            <p className="muted">
              {fmtNumber(domain.counts.domains)} domains, {fmtNumber(domain.counts.flows)} flows, {fmtNumber(domain.counts.steps)} steps; step anchors:{' '}
              {fmtNumber(domain.counts.anchors)} in this graph, {fmtNumber(domain.counts.unanchored)} unanchored.
            </p>
            {domain.domains.map((d) => (
              <div key={d.id} data-domain={d.id}>
                <h3>{d.name}</h3>
                {d.summary && <p className="secondary">{d.summary}</p>}
                {d.flows.length === 0 && <p className="muted">No flow is linked to this domain.</p>}
                {d.flows.map((flow) => (
                  <FlowPlayer key={flow.id} flow={flow} current={flow.id === flowParam ? stepNumber : null} />
                ))}
              </div>
            ))}
            {domain.orphanFlows.length > 0 && (
              <div data-domain="(no domain)">
                <h3>Flows no domain contains</h3>
                {domain.orphanFlows.map((flow) => (
                  <FlowPlayer key={flow.id} flow={flow} current={flow.id === flowParam ? stepNumber : null} />
                ))}
              </div>
            )}
            {domain.orphanSteps.length > 0 && (
              <div data-orphan-steps={domain.orphanSteps.length}>
                <h3>Steps no flow lists</h3>
                <ul className="flow-steps">
                  {domain.orphanSteps.map((step) => (
                    <StepItem key={step.id} step={step} current={false} showOrder={false} />
                  ))}
                </ul>
              </div>
            )}
            {flows.length === 0 && <p className="muted">The domain graph has no flow.</p>}
          </>
        )}
      </section>
    </div>
  );
}

function SummaryList({ data, coverage }: { data: ViewData; coverage: ReturnType<typeof summaryCoverage> }) {
  const entries = [...semanticEntries(data.segments).values()];
  return (
    <>
      <p data-summaries={`${coverage.withSummary}/${coverage.total}`}>
        <strong>{fmtNumber(coverage.withSummary)}</strong> of {fmtNumber(coverage.total)} nodes have a cached summary: {fmtNumber(coverage.fresh)} fresh,{' '}
        {fmtNumber(coverage.stale)} stale
        {coverage.untrusted > 0 && <>, {fmtNumber(coverage.untrusted)} not trusted</>}
        {coverage.notInGraph > 0 && <>; {fmtNumber(coverage.notInGraph)} entries name nodes not in this graph</>}. Every other node is unsummarized.
      </p>
      <p className="muted">Freshness compares each entry's source hash with the file's content hash in the manifest, at bake time.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Node</th>
              <th>Freshness</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const badge = freshnessBadge(entry.freshness);
              return (
                <tr key={entry.nodeId} data-summary-entry={entry.nodeId} data-freshness={badge.state}>
                  <td className="mono">
                    {entry.inGraph ? <a href={nodeHash(entry.nodeId)}>{entry.nodeId}</a> : <>{entry.nodeId} <span className="muted">(not in this graph)</span></>}
                  </td>
                  <td>
                    <Badge state={badge.state}>{badge.label}</Badge>
                  </td>
                  <td>
                    {text(entry.summary)}
                    {entry.tags.length > 0 && (
                      <ul className="tag-list">
                        {entry.tags.map((tag) => (
                          <li key={tag}>{tag}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LayersBlock({ model }: { model: NonNullable<ReturnType<typeof layerModel>> }) {
  return (
    <>
      <p data-layers-freshness={model.freshness.state}>
        <Badge state={model.freshness.state}>{model.stale ? 'Stale' : 'Fresh'}</Badge>{' '}
        <span className="secondary">
          {model.stale
            ? `The semantic graph was written for facts ${text(model.factDigest?.slice(0, 12))}…, the graph header is ${text(model.headerFactsDigest?.slice(0, 12))}…; layers and relations are shown as recorded.`
            : 'The semantic graph matches the facts in this page.'}
        </span>
      </p>
      {model.stale && <p className="secondary" data-hint="layers-stale">Hint: run /excavator --mode=full</p>}
      <p className="muted">
        {fmtNumber(model.layers.length)} layers; {fmtNumber(model.unlayered)} graph nodes are unlayered
        {model.multiLayer > 0 && <>, {fmtNumber(model.multiLayer)} are in more than one layer</>}. <a href="#/graph">Color the graph by layer</a> from its legend.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Layer</th>
              <th>Description</th>
              <th className="num">Nodes listed</th>
              <th className="num">In this graph</th>
            </tr>
          </thead>
          <tbody>
            {model.layers.map((layer) => (
              <tr key={layer.id} data-layer={layer.id} data-layer-nodes={layer.nodeCount}>
                <td>
                  <span className="swatch" style={{ background: `var(${layer.colorVar})` }} /> {layer.name}
                </td>
                <td className="secondary">{layer.description || '—'}</td>
                <td className="num">{fmtNumber(layer.nodeCount)}</td>
                <td className="num">{fmtNumber(layer.inGraph)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Relations ({fmtNumber(model.relations.length)})</h3>
      {model.relations.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="edge-list">
          {model.relations.map((r) => (
            <li key={r.id} data-relation={r.id}>
              <span className="mono">{r.type}</span>: <Endpoint id={r.source} found={r.sourceFound} /> → <Endpoint id={r.target} found={r.targetFound} />
              {r.description && <div className="secondary">{r.description}</div>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Endpoint({ id, found }: { id: string; found: boolean }) {
  return found ? (
    <a className="mono" href={nodeHash(id)}>
      {id}
    </a>
  ) : (
    <span className="mono">
      {id} <span className="muted">(not in this graph)</span>
    </span>
  );
}

function StepItem({ step, current, showOrder }: { step: FlowStep; current: boolean; showOrder: boolean }) {
  const reduced = useReducedMotion();
  const found = step.anchors.filter((a) => a.found);
  return (
    <motion.li
      className="flow-step"
      data-step-id={step.id}
      data-step-order={step.order}
      data-current={current ? 'true' : 'false'}
      animate={current && !reduced ? { scale: [1, 1.015, 1] } : { scale: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div>
        {showOrder && <span className="order">{step.order}.</span>} <strong>{step.name}</strong>
        {step.provenance === 'inferred' && <span className="muted"> (inferred)</span>}
        {found.length > 0 && (
          <>
            {' '}
            <a href={nodeHash(found[0].id)} data-step-locate={step.id}>
              Go to node
            </a>
          </>
        )}
      </div>
      {step.summary && <div className="secondary">{step.summary}</div>}
      {step.filePath && (
        <div className="muted mono">
          {step.filePath}
          {step.lineRange ? `:${step.lineRange[0]}-${step.lineRange[1]}` : ''}
        </div>
      )}
      {step.anchors.length === 0 ? (
        <div className="muted" data-anchor="none">No anchored node.</div>
      ) : (
        <ul className="anchor-list">
          {step.anchors.map((a) => (
            <li key={a.id} data-anchor={a.found ? 'found' : 'unanchored'}>
              {a.found ? (
                <a className="mono" href={nodeHash(a.id)}>
                  {a.id}
                </a>
              ) : (
                <>
                  <span className="mono">{a.id}</span> <Badge state="missing">unanchored</Badge>
                  <span className="muted"> not in this graph{a.writerUnresolved ? ' (the domain writer could not resolve it either)' : ''}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </motion.li>
  );
}

function FlowPlayer({ flow, current }: { flow: DomainFlow; current: number | null }) {
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  const total = flow.steps.length;
  const shown = current !== null && current >= 1 && current <= total ? current : null;
  const busyKey = `flow-play:${flow.id}`;
  const go = (step: number) => {
    window.location.hash = sectionHash('semantics', { flow: flow.id, step: String(step) });
  };

  // Playback walks the steps in order, one hash change per step, then stops.
  useEffect(() => {
    if (!playing) return;
    let step = 1;
    go(step);
    const tick = () => {
      if (step >= total) {
        timer.current = null;
        setPlaying(false);
        return;
      }
      step += 1;
      go(step);
      timer.current = window.setTimeout(tick, STEP_MS);
    };
    timer.current = window.setTimeout(tick, STEP_MS);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [playing]);

  useEffect(() => {
    if (playing) markBusy(busyKey);
    else clearBusy(busyKey);
    report('data-semantics-playing', playing ? 'true' : null);
  }, [playing]);
  useEffect(
    () => () => {
      clearBusy(busyKey);
      report('data-semantics-playing', null);
    },
    [],
  );
  useEffect(() => {
    if (shown === null) return;
    report('data-semantics-flow', flow.id);
    report('data-semantics-step', shown);
    return () => {
      report('data-semantics-flow', null);
      report('data-semantics-step', null);
    };
  }, [shown, flow.id]);

  const onPlay = () => {
    if (total === 0) return;
    // Reduced motion: no playback; highlight the current step (the first when none).
    if (reduced) {
      go(shown ?? 1);
      return;
    }
    setPlaying(true);
  };

  return (
    <div className="flow" data-flow={flow.id} data-flow-steps={total} data-flow-current={shown ?? ''}>
      <div className="flow-head">
        <strong>{flow.name}</strong>
        {flow.entryPoint && <span className="muted mono">{flow.entryPoint}</span>}
        <button type="button" className="play-button" onClick={onPlay} disabled={total === 0 || playing} data-flow-play={flow.id}>
          {reduced ? 'Highlight step' : playing ? 'Playing…' : 'Play steps'}
        </button>
        {shown !== null && shown > 1 && (
          <a href={sectionHash('semantics', { flow: flow.id, step: String(shown - 1) })} data-flow-prev={flow.id}>
            Previous
          </a>
        )}
        {shown !== null && shown < total && (
          <a href={sectionHash('semantics', { flow: flow.id, step: String(shown + 1) })} data-flow-next={flow.id}>
            Next
          </a>
        )}
      </div>
      {flow.summary && <p className="secondary">{flow.summary}</p>}
      <div className="flow-progress" data-motion="flow" data-motion-state={reduced ? 'static' : 'animated'}>
        <motion.span initial={false} animate={{ width: `${total === 0 || shown === null ? 0 : (shown / total) * 100}%` }} transition={{ duration: reduced ? 0 : 0.35 }} />
      </div>
      {total === 0 ? (
        <p className="muted">This flow lists no steps.</p>
      ) : (
        <ol className="flow-steps">
          {flow.steps.map((step) => (
            <StepItem key={step.id} step={step} current={shown === step.order} showOrder />
          ))}
        </ol>
      )}
    </div>
  );
}
