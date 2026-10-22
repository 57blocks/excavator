import { useMemo } from 'react';

import { domainCounts, resolveAnchors, type DomainEvidence, type DomainNode } from '../../data/domain';
import type { GraphNode } from '../../data/graph';
import { rangeText } from '../../lib/code';
import { ARROWS_NOTE, evidenceTarget, metaSections, stepTarget } from '../../lib/domain-details';
import type { DomainPlace } from '../../lib/domain-state';
import { formatNumber } from '../../lib/format';
import { NOT_IN_GRAPH } from '../../lib/locate';
import { nodeColor } from '../../lib/node-colors';
import type { DomainScene } from '../../state/domain-scene';
import { Badge } from '../ui/Badge';
import { Facts, Pills } from '../ui/Controls';

const ACTION = 'cursor-pointer rounded-control border border-line-2 bg-surface px-3 py-1.5 text-[13px] text-ink hover:border-accent hover:text-accent';
const ROW = 'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-2 py-1 text-left text-ink hover:bg-highlight';

const KIND_LABEL: Record<string, string> = { domain: 'Domain', flow: 'Flow', step: 'Step' };

export interface DomainDetailActions {
  /** Show a domain, flow or step in the sidebar, drilling to the place that draws it when the current one does not. */
  onSelect: (id: string) => void;
  /** Go into a domain, or into a flow of a domain. */
  onOpen: (domain: string, flow: string | null) => void;
  /** Show a node of the knowledge graph in the structure graph. */
  onGoToGraph: (nodeId: string) => void;
  /** Open this file and these lines in the code drawer. */
  onOpenCode: (target: GraphNode) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Evidence({ items, onOpenCode }: { items: readonly DomainEvidence[]; onOpenCode: (target: GraphNode) => void }) {
  if (items.length === 0) return <p className="m-0 text-muted">No evidence is recorded.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {items.map((item, i) => {
        const target = evidenceTarget(item);
        const label = target ? target.name : String(item.file);
        return (
          <li key={`${label}|${i}`} className="flex min-w-0 items-baseline gap-2">
            {target ? (
              <button type="button" data-xv-evidence={label} title={`Open ${label} in the code drawer`} onClick={() => onOpenCode(target)} className="min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-[12.5px] text-accent underline [overflow-wrap:anywhere] hover:text-violet">
                {label}
              </button>
            ) : (
              <span className="font-mono text-[12.5px] text-muted">{label}</span>
            )}
            {typeof item.source === 'string' ? <span className="shrink-0 text-[11px] text-muted">{item.source}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function NodeRow({ node, text, onClick, attr }: { node: DomainNode; text?: string; onClick: () => void; attr: string }) {
  return (
    <li>
      <button type="button" {...{ [attr]: node.id }} onClick={onClick} title={node.name} className={ROW}>
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {text ? <span className="shrink-0 font-mono text-[11px] text-muted">{text}</span> : null}
      </button>
    </li>
  );
}

function Anchors({ step, scene, onGoToGraph }: { step: DomainNode; scene: DomainScene; onGoToGraph: (nodeId: string) => void }) {
  const anchors = useMemo(() => resolveAnchors(step, scene.graph.model.index), [step, scene]);
  if (anchors.found.length === 0 && anchors.missing.length === 0) return <p className="m-0 text-muted">This step names no node of the knowledge graph.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {anchors.found.map((found) => (
        <li key={found.id}>
          <button type="button" data-xv-anchor={found.id} title={`${found.type} ${found.name}${found.filePath ? ` in ${found.filePath}` : ''}: show in the structure graph`} onClick={() => onGoToGraph(found.id)} className={ROW}>
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: nodeColor(found.type) }} />
            <span className="min-w-0 flex-1 truncate">{found.name}</span>
            <span className="shrink-0 text-[11px] text-muted">{found.type}</span>
          </button>
        </li>
      ))}
      {anchors.missing.map((id) => (
        <li key={id} data-xv-anchor-missing={id} className="px-2 py-1 text-muted">
          <span className="font-mono text-xs [overflow-wrap:anywhere]">{id}</span>
          {` ${NOT_IN_GRAPH}`}
        </li>
      ))}
    </ul>
  );
}

/**
 * The sidebar of the domain view for a selected domain, flow or step: name, summary, `domainMeta` as written, evidence
 * (each line opens the code drawer), provenance, and what the node is joined to; a step lists the nodes of the knowledge graph
 * it names, each leading to the structure graph, and the ones the graph lacks.
 */
export function DomainDetails({ scene, node, place, actions }: { scene: DomainScene; node: DomainNode; place: DomainPlace; actions: DomainDetailActions }) {
  const { index } = scene;
  const sections = useMemo(() => metaSections(node.domainMeta), [node]);
  const tags = Array.isArray(node.tags) ? node.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  const evidence = Array.isArray(node.evidence) ? node.evidence.filter((item) => item !== null && typeof item === 'object') : [];
  const target = node.type === 'step' ? stepTarget(node) : null;
  const lines = rangeText(node.lineRange);
  const facts: (readonly [string, React.ReactNode])[] = [['Name', node.name], ['Kind', KIND_LABEL[node.type] ?? node.type]];
  if (typeof node.complexity === 'string' && node.complexity !== '') facts.push(['Complexity', node.complexity]);
  facts.push(['Provenance', typeof node.provenance === 'string' && node.provenance !== '' ? node.provenance : 'not recorded']);
  if (node.type === 'step') {
    facts.push(['File', typeof node.filePath === 'string' && node.filePath !== '' ? <span className="font-mono text-xs" data-xv-detail="file">{node.filePath}</span> : 'not recorded']);
    facts.push(['Lines', lines ? <span className="font-mono text-xs" data-xv-detail="lines">{lines}</span> : 'not recorded']);
  }
  const summary = typeof node.summary === 'string' ? node.summary : '';
  return (
    <div className="flex flex-col gap-5 text-[13.5px]" data-xv-details={node.id} data-xv-domain-details={node.type}>
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: nodeColor('domain') }} />
        <Badge tone="neutral">{KIND_LABEL[node.type] ?? node.type}</Badge>
      </div>
      <Facts items={facts} />
      {node.type === 'domain' || node.type === 'flow' ? (
        <div className="flex flex-wrap gap-2">
          {node.type === 'domain' && !(place.kind === 'domain' && place.domain.id === node.id) ? <button type="button" data-xv-action="open" onClick={() => actions.onOpen(node.id, null)} className={ACTION}>Open this domain</button> : null}
          {node.type === 'flow' && !(place.kind === 'flow' && place.flow.id === node.id) && (index.domainsOfFlow.get(node.id)?.length ?? 0) > 0
            ? <button type="button" data-xv-action="open" onClick={() => actions.onOpen((index.domainsOfFlow.get(node.id) as string[])[0], node.id)} className={ACTION}>Open this flow</button>
            : null}
        </div>
      ) : null}
      {target ? <div><button type="button" data-xv-action="code" onClick={() => actions.onOpenCode(target)} className={ACTION}>Open code</button></div> : null}
      <Section title="Summary">{summary ? <p className="m-0">{summary}</p> : <p className="m-0 text-muted">No summary is recorded.</p>}</Section>
      {tags.length > 0 ? <Section title="Tags"><Pills values={tags} /></Section> : null}
      {sections.map((section) => (
        <Section key={section.key} title={section.title}>
          {section.empty ? <p className="m-0 text-muted">None listed.</p> : (
            <ul className="m-0 list-disc pl-5">
              {section.items.map((item, i) => <li key={i} className="mb-1 [overflow-wrap:anywhere]">{item}</li>)}
            </ul>
          )}
        </Section>
      ))}
      <Section title="Evidence"><Evidence items={evidence as DomainEvidence[]} onOpenCode={actions.onOpenCode} /></Section>
      {node.type === 'domain' ? <DomainRelations node={node} scene={scene} actions={actions} /> : null}
      {node.type === 'flow' ? <FlowRelations node={node} scene={scene} actions={actions} /> : null}
      {node.type === 'step' ? <StepRelations node={node} scene={scene} actions={actions} /> : null}
    </div>
  );
}

function DomainRelations({ node, scene, actions }: { node: DomainNode; scene: DomainScene; actions: DomainDetailActions }) {
  const { index } = scene;
  const flows = index.flowsOf.get(node.id) ?? [];
  const counts = domainCounts(index, node.id);
  const out = index.crossDomain.filter((edge) => edge.source === node.id);
  const into = index.crossDomain.filter((edge) => edge.target === node.id);
  return (
    <>
      <Section title={`Flows (${formatNumber(flows.length)})`}>
        <p className="m-0 text-xs text-muted">{`${formatNumber(counts.steps)} steps in its flows.`}</p>
        {flows.length === 0 ? <p className="m-0 text-muted">None.</p> : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {flows.map((flow) => <NodeRow key={flow.id} node={flow} attr="data-xv-flow-row" text={`${formatNumber(index.stepsOf.get(flow.id)?.length ?? 0)} steps`} onClick={() => actions.onOpen(node.id, flow.id)} />)}
          </ul>
        )}
      </Section>
      <Section title={`Cross-domain edges (${formatNumber(out.length + into.length)})`}>
        {out.length + into.length === 0 ? <p className="m-0 text-muted">None.</p> : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {[...out.map((edge) => ({ edge, other: edge.target, way: 'to' })), ...into.map((edge) => ({ edge, other: edge.source, way: 'from' }))].map(({ edge, other, way }, i) => {
              const otherNode = index.nodesById.get(other);
              return (
                <li key={`${way}|${other}|${i}`} data-xv-cross={way} className="flex flex-col gap-0.5">
                  <button type="button" onClick={() => actions.onSelect(other)} className="flex min-w-0 cursor-pointer items-baseline gap-2 border-0 bg-transparent p-0 text-left text-ink hover:text-accent">
                    <span className="w-9 shrink-0 text-[11px] uppercase tracking-wider text-muted">{way}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{otherNode?.name ?? other}</span>
                  </button>
                  {typeof edge.description === 'string' && edge.description !== '' ? <p className="m-0 pl-11 text-xs text-ink-soft">{edge.description}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}

function FlowRelations({ node, scene, actions }: { node: DomainNode; scene: DomainScene; actions: DomainDetailActions }) {
  const { index } = scene;
  const steps = index.stepsOf.get(node.id) ?? [];
  const domains = (index.domainsOfFlow.get(node.id) ?? []).map((id) => index.nodesById.get(id)).filter((d): d is DomainNode => d !== undefined);
  return (
    <>
      {domains.length > 0 ? (
        <Section title="Domain">
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{domains.map((domain) => <NodeRow key={domain.id} node={domain} attr="data-xv-domain-row" onClick={() => actions.onSelect(domain.id)} />)}</ul>
        </Section>
      ) : null}
      <Section title={`Steps (${formatNumber(steps.length)})`}>
        <p className="m-0 text-xs text-muted">{ARROWS_NOTE}</p>
        {steps.length === 0 ? <p className="m-0 text-muted">None.</p> : (
          <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
            {steps.map((step) => <NodeRow key={step.node.id} node={step.node} attr="data-xv-step-row" text={step.weight === null ? `${step.position}` : `${step.position} · ${step.weight}`} onClick={() => actions.onSelect(step.node.id)} />)}
          </ol>
        )}
      </Section>
    </>
  );
}

function StepRelations({ node, scene, actions }: { node: DomainNode; scene: DomainScene; actions: DomainDetailActions }) {
  const { index } = scene;
  const flows = (index.flowsOfStep.get(node.id) ?? []).map((id) => index.nodesById.get(id)).filter((f): f is DomainNode => f !== undefined);
  return (
    <>
      <Section title="In flow">
        {flows.length === 0 ? <p className="m-0 text-muted">No flow lists this step.</p> : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {flows.map((flow) => {
              const place = index.stepsOf.get(flow.id)?.find((row) => row.node.id === node.id);
              return <NodeRow key={flow.id} node={flow} attr="data-xv-flow-row" text={place ? `step ${place.position} of ${index.stepsOf.get(flow.id)?.length}` : undefined} onClick={() => actions.onSelect(flow.id)} />;
            })}
          </ul>
        )}
      </Section>
      <Section title="Nodes of the knowledge graph">
        <Anchors step={node} scene={scene} onGoToGraph={actions.onGoToGraph} />
      </Section>
    </>
  );
}
