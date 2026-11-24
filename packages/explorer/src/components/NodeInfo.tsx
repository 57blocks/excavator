import { useState, type ReactNode } from "react";
import { useDashboardStore, activeTranslations } from "../store";
import { useI18n } from "../contexts/I18nContext";
import type { NodeType, EdgeType, KnowledgeGraph, GraphNode } from "@understand-anything/core/types";
import { evidenceLabel, summaryRemoved, verdictOf, type Verdict } from "../excavator/ourData";
import { nodeTitles } from "../excavator/nodeTitle";
import { displayFlowName, flowTitle } from "../excavator/displayFlowName";
import { domainTitle, translatorOf, type Translate } from "../excavator/nameTranslations";
import { panelFlows } from "../excavator/domainLevels";
import GroupName from "./GroupName";
import { NodeProductFacts } from "../excavator/panel/NodeProductFacts";
import { LIST_CLASS, Section } from "../excavator/panel/Section";
import { NodeCommunication } from "../excavator/views/relations/NodeCommunication";

// Badge color classes keyed by NodeType — must be kept in sync with core NodeType union.
const typeBadgeColors: Record<NodeType, string> = {
  file: "text-node-file border border-node-file/30 bg-node-file/10",
  function: "text-node-function border border-node-function/30 bg-node-function/10",
  class: "text-node-class border border-node-class/30 bg-node-class/10",
  module: "text-node-module border border-node-module/30 bg-node-module/10",
  concept: "text-node-concept border border-node-concept/30 bg-node-concept/10",
  config: "text-node-config border border-node-config/30 bg-node-config/10",
  document: "text-node-document border border-node-document/30 bg-node-document/10",
  service: "text-node-service border border-node-service/30 bg-node-service/10",
  table: "text-node-table border border-node-table/30 bg-node-table/10",
  endpoint: "text-node-endpoint border border-node-endpoint/30 bg-node-endpoint/10",
  pipeline: "text-node-pipeline border border-node-pipeline/30 bg-node-pipeline/10",
  schema: "text-node-schema border border-node-schema/30 bg-node-schema/10",
  resource: "text-node-resource border border-node-resource/30 bg-node-resource/10",
  domain: "text-node-concept border border-node-concept/30 bg-node-concept/10",
  flow: "text-node-pipeline border border-node-pipeline/30 bg-node-pipeline/10",
  step: "text-node-function border border-node-function/30 bg-node-function/10",
  article: "text-node-article border border-node-article/30 bg-node-article/10",
  entity: "text-node-entity border border-node-entity/30 bg-node-entity/10",
  topic: "text-node-topic border border-node-topic/30 bg-node-topic/10",
  claim: "text-node-claim border border-node-claim/30 bg-node-claim/10",
  source: "text-node-source border border-node-source/30 bg-node-source/10",
  page: "text-node-concept border border-node-concept/30 bg-node-concept/10",
  screen: "text-node-service border border-node-service/30 bg-node-service/10",
  component: "text-node-class border border-node-class/30 bg-node-class/10",
  componentSet: "text-node-module border border-node-module/30 bg-node-module/10",
  instance: "text-node-function border border-node-function/30 bg-node-function/10",
  token: "text-node-config border border-node-config/30 bg-node-config/10",
};

const complexityBadgeColors: Record<string, string> = {
  simple: "text-node-function border border-node-function/30 bg-node-function/10",
  moderate: "text-accent-dim border border-accent-dim/30 bg-accent-dim/10",
  complex: "text-[#c97070] border border-[#c97070]/30 bg-[#c97070]/10",
};

// Excavator: the verifier's verdict on the summary, in the complexity badges' colors.
const verdictBadgeColors: Record<Verdict, string> = {
  verified: complexityBadgeColors.simple,
  unverified: complexityBadgeColors.moderate,
  contradicted: complexityBadgeColors.complex,
};

function getDirectionalLabel(edgeType: string, isSource: boolean, t: ReturnType<typeof useI18n>["t"]): string {
  // edgeLabels only defines the labels that have explicit translations; the new
  // design edge types (instance_of/variant_of/uses_token) intentionally fall back
  // to the generated label below, so index it as a partial map over EdgeType.
  const labels = (t.edgeLabels as Partial<Record<EdgeType, { forward: string; backward: string }>>)[edgeType as EdgeType];
  if (!labels) {
    const formatted = edgeType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return isSource ? formatted : `${formatted} (reverse)`;
  }
  return isSource ? labels.forward : labels.backward;
}

const OPEN_BUTTON = "ml-2 rounded border border-accent/40 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-accent hover:bg-accent/10";

const LINK_ROW = "block w-full py-1.5 text-left text-[11px] text-text-secondary transition-colors hover:text-accent";

function FigmaThumbnail({ node }: { node: GraphNode }) {
  const url = node.figmaMeta?.thumbnailUrl;
  if (!url) return null;
  return (
    <div className="px-5 pb-3">
      <img src={url} alt={node.name} className="block h-auto w-full" loading="lazy" />
    </div>
  );
}

function SubHeading({ children }: { children: string }) {
  return <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{children}</h4>;
}

/** A list of node links, rows separated by divider lines. */
function LinkList({ nodes, onOpen }: { nodes: GraphNode[]; onOpen: (id: string) => void }) {
  return (
    <ul className={LIST_CLASS}>
      {nodes.map((n) => (
        <li key={n.id}>
          <button type="button" onClick={() => onOpen(n.id)} className={`${LINK_ROW} truncate`}>
            {n.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

function KnowledgeNodeDetails({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const navigateToNode = useDashboardStore((s) => s.goToNode);
  const { t } = useI18n();
  const meta = node.knowledgeMeta;

  // Wikilinks (outgoing related edges)
  const wikilinks = graph.edges
    .filter((e) => e.type === "related" && e.source === node.id)
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter((n): n is GraphNode => n !== undefined);

  // Backlinks (incoming related edges)
  const backlinks = graph.edges
    .filter((e) => e.type === "related" && e.target === node.id)
    .map((e) => graph.nodes.find((n) => n.id === e.source))
    .filter((n): n is GraphNode => n !== undefined);

  // Category
  const categoryEdge = graph.edges.find(
    (e) => e.type === "categorized_under" && e.source === node.id
  );
  const categoryNode = categoryEdge
    ? graph.nodes.find((n) => n.id === categoryEdge.target)
    : null;

  return (
    <>
      {categoryNode && (
        <Section title={t.nodeInfo.category}>
          <button type="button" onClick={() => navigateToNode(categoryNode.id)} className="pb-2 text-xs text-accent hover:text-accent-bright">
            {categoryNode.name}
          </button>
        </Section>
      )}
      {meta?.wikilinks && meta.wikilinks.length > 0 && (
        <Section title={t.nodeInfo.wikilinks}>
          <div className="max-h-[200px] overflow-auto">
            <LinkList nodes={wikilinks} onOpen={navigateToNode} />
          </div>
        </Section>
      )}
      {backlinks.length > 0 && (
        <Section title={t.nodeInfo.backlinks}>
          <div className="max-h-[200px] overflow-auto">
            <LinkList nodes={backlinks} onOpen={navigateToNode} />
          </div>
        </Section>
      )}
      {meta?.content && (
        <Section title={t.common.preview}>
          <div className="max-h-[300px] overflow-auto whitespace-pre-wrap pb-2 font-mono text-[11px] leading-relaxed text-text-secondary">
            {meta.content.slice(0, 1500)}
            {meta.content.length > 1500 && (
              <span className="text-text-muted">... {t.common.truncated}</span>
            )}
          </div>
        </Section>
      )}
    </>
  );
}

/** The one place the Domain view shows code: a small muted line with a flow's entry point or a step's file. */
function CodeLine({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 px-5 pt-3 text-[10px] text-text-muted" data-excavator-code-line>
      <span className="mr-2 uppercase tracking-wider">Code</span>
      <span className="font-mono [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}

/** A flow or step name with the English original beside it when the name table translated it. */
function NameWithOriginal({ name, translate }: { name: string; translate?: Translate }) {
  const { label, original } = flowTitle(name, translate);
  return (
    <>
      {label}
      {original !== null && <span className="ml-1 text-text-muted">{original}</span>}
    </>
  );
}

function DomainNodeDetails({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const goToNode = useDashboardStore((s) => s.goToNode);
  const enterNode = useDashboardStore((s) => s.enterNode);
  const selectedGroupId = useDashboardStore((s) => s.selectedGroupId);
  const table = useDashboardStore(activeTranslations);
  const translate = translatorOf(table);
  const featureGroups = useDashboardStore((s) => s.featureGroups);
  const activeDomainId = useDashboardStore((s) => s.activeDomainId);
  const activeGroupId = useDashboardStore((s) => s.activeGroupId);
  const { t } = useI18n();
  const meta = node.domainMeta;

  if (node.type === "domain") {
    // The open group's flows, in group order, when a group of this domain is open; else every flow of the domain.
    const listed = panelFlows(featureGroups, graph, node.id, activeDomainId, activeGroupId ?? selectedGroupId);
    const flows = listed.flowIds
      .map((id) => graph.nodes.find((n) => n.id === id))
      .filter((n): n is GraphNode => n !== undefined);
    const groupName = listed.group ? domainTitle(listed.group.label, translate).label : null;

    return (
      <>
        {Array.isArray(meta?.entities) && meta.entities.length > 0 ? (
          <Section title={t.nodeInfo.entities}>
            <p className="m-0 pb-2 text-[11px] text-text-secondary">{meta.entities.join(", ")}</p>
          </Section>
        ) : null}
        {Array.isArray(meta?.businessRules) && meta.businessRules.length > 0 ? (
          <Section title={t.nodeInfo.businessRules}>
            <ul className={`${LIST_CLASS} text-[11px] text-text-secondary`}>
              {meta.businessRules.map((r, i) => (
                <li key={i} className="py-1.5">{r}</li>
              ))}
            </ul>
          </Section>
        ) : null}
        {Array.isArray(meta?.crossDomainInteractions) && meta.crossDomainInteractions.length > 0 ? (
          <Section title={t.nodeInfo.crossDomain}>
            <ul className={`${LIST_CLASS} text-[11px] text-text-secondary`}>
              {meta.crossDomainInteractions.map((c, i) => (
                <li key={i} className="py-1.5">{c}</li>
              ))}
            </ul>
          </Section>
        ) : null}
        {flows.length > 0 && (
          <Section
            title={t.nodeInfo.flows}
            note={
              listed.group && groupName !== null ? (
                <>
                  <GroupName label={groupName} qualifier={listed.group.qualifier} />
                  {activeGroupId === null && (
                    <button type="button" data-excavator-open="group" onClick={() => enterNode("group", listed.group!.id)} className={OPEN_BUTTON}>
                      Open
                    </button>
                  )}
                </>
              ) : undefined
            }
          >
            <ul className={LIST_CLASS}>
              {flows.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => goToNode(f.id)} className={LINK_ROW}>
                    <NameWithOriginal name={f.name} translate={translate} />
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </>
    );
  }

  if (node.type === "flow") {
    const steps = graph.edges
      .filter((e) => e.type === "flow_step" && e.source === node.id)
      .sort((a, b) => a.weight - b.weight)
      .map((e) => graph.nodes.find((n) => n.id === e.target))
      .filter((n): n is GraphNode => n !== undefined);

    return (
      <>
        {meta?.entryPoint ? <CodeLine>{meta.entryPoint}</CodeLine> : null}
        {steps.length > 0 && (
          <Section title={t.nodeInfo.steps}>
            <ol className={LIST_CLASS}>
              {steps.map((s, i) => (
                <li key={s.id}>
                  <button type="button" onClick={() => goToNode(s.id)} className={LINK_ROW}>
                    <span className="mr-1.5 text-accent/60">{i + 1}.</span>
                    <NameWithOriginal name={s.name} translate={translate} />
                  </button>
                </li>
              ))}
            </ol>
          </Section>
        )}
      </>
    );
  }

  if (node.type === "step") {
    if (!node.filePath) return null;
    return (
      <CodeLine>
        {node.filePath}
        {node.lineRange ? `:${node.lineRange[0]}-${node.lineRange[1]}` : ""}
      </CodeLine>
    );
  }

  return null;
}

/** The panel of one node: `nodeId` shows that node instead of the selected one (the open domain). */
export default function NodeInfo({ nodeId }: { nodeId?: string } = {}) {
  const graph = useDashboardStore((s) => s.graph);
  const storeSelectedId = useDashboardStore((s) => s.selectedNodeId);
  const selectedNodeId = nodeId ?? storeSelectedId;
  const nodeHistory = useDashboardStore((s) => s.nodeHistory);
  const goBackNode = useDashboardStore((s) => s.goBackNode);
  const [languageExpanded, setLanguageExpanded] = useState(true);
  const { t } = useI18n();

  const navigateToNode = useDashboardStore((s) => s.goToNode);
  const navigateToHistoryIndex = useDashboardStore((s) => s.navigateToHistoryIndex);
  const setFocusNode = useDashboardStore((s) => s.setFocusNode);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  const focusNodeId = useDashboardStore((s) => s.focusNodeId);
  const viewMode = useDashboardStore((s) => s.viewMode);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const nameTranslations = useDashboardStore(activeTranslations);
  const panelDomainId = useDashboardStore((s) => s.activeDomainId);
  const panelGroupId = useDashboardStore((s) => s.activeGroupId);
  const enterNodeAction = useDashboardStore((s) => s.enterNode);

  const activeGraph = viewMode === "domain" && domainGraph ? domainGraph : graph;
  const node = activeGraph?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  // Resolve history node names for the breadcrumb trail
  const historyNodes = nodeHistory.map((id) => {
    const n = activeGraph?.nodes.find((gn) => gn.id === id);
    return { id, name: n?.name ?? id };
  });

  if (!node) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface">
        <p className="text-text-muted text-sm">{t.common.selectNode}</p>
      </div>
    );
  }

  // Excavator: the title, with the English original when the name table translated it.
  const rawTitles = nodeTitles(node, translatorOf(nameTranslations));
  // The Domain view shows names, not code: a flow's route in parentheses is left out of its title.
  const titles = viewMode === "domain" ? { ...rawTitles, title: displayFlowName(rawTitles.title), original: rawTitles.original === null ? null : displayFlowName(rawTitles.original) } : rawTitles;

  const allEdges = activeGraph?.edges ?? [];
  const connections = allEdges.filter(
    (e) => e.source === node.id || e.target === node.id,
  );

  // Separate child nodes (contained IN this file) from other connections
  const childEdges = connections.filter(
    (e) => e.type === "contains" && e.source === node.id,
  );
  // A domain lists its flows under Flows; its contains_flow edges are not repeated as connections.
  const otherConnections = connections.filter(
    (e) => !(e.type === "contains" && e.source === node.id) && !(node.type === "domain" && e.type === "contains_flow" && e.source === node.id),
  );

  // Resolve child nodes
  const childNodes = childEdges
    .map((e) => activeGraph?.nodes.find((n) => n.id === e.target))
    .filter((n): n is GraphNode => n !== undefined);

  const knownType = node.type as NodeType;
  const typeBadge = typeBadgeColors[knownType] ?? typeBadgeColors.file;
  const complexityBadge =
    complexityBadgeColors[node.complexity] ?? complexityBadgeColors.simple;
  const verdict = verdictOf(node);

  // Open enters a domain's groups (a double click on its card does the same); a list item never navigates by itself:
  // it goes to the node's own level. No other node has a next level in this panel.
  const canOpen = viewMode === "domain" && node.type === "domain" && node.id !== panelDomainId;

  if (import.meta.env.DEV && !(knownType in typeBadgeColors)) {
    console.warn(`[NodeInfo] Unknown node type "${node.type}" — using "file" badge colors`);
  }

  return (
    <div className="w-full animate-fade-slide-in pb-3">
      <div className="px-5 pt-5">
        {/* Navigation history trail */}
        {historyNodes.length > 0 && viewMode !== "domain" && (
          <div className="mb-3 flex flex-wrap items-center gap-1" data-excavator-panel-breadcrumb>
            <button
              onClick={goBackNode}
              className="flex items-center gap-1 text-[10px] font-semibold text-gold transition-colors hover:text-gold-bright"
            >
              <span>{"\u2190"}</span>
              <span>{t.common.back}</span>
            </button>
            <span className="text-[10px] text-text-muted">{"\u2502"}</span>
            {historyNodes.slice(-3).map((h, i, arr) => (
              <span key={`${h.id}-${i}`} className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const fullIdx = historyNodes.length - arr.length + i;
                    navigateToHistoryIndex(fullIdx);
                  }}
                  className="max-w-[80px] truncate text-[10px] text-text-muted transition-colors hover:text-gold"
                  title={h.name}
                >
                  {h.name}
                </button>
                {i < arr.length - 1 && <span className="text-[10px] text-text-muted">{"\u203a"}</span>}
              </span>
            ))}
            <span className="text-[10px] text-text-muted">{"\u203a"}</span>
            <span className="max-w-[80px] truncate text-[10px] font-medium text-text-primary">{node.name}</span>
          </div>
        )}

        <div className="mb-3 flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${typeBadge}`}>{node.type}</span>
          <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${complexityBadge}`}>{node.complexity}</span>
        </div>

        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-heading text-lg text-text-primary">{titles.title}</h2>
            {titles.original !== null && (
              <div className="text-[11px] text-text-muted">English: {titles.original} {"\u00b7"} machine translation</div>
            )}
            {titles.subtitle !== null && (
              <div className="truncate font-mono text-[11px] text-text-muted" title={node.name}>
                {titles.subtitle}
              </div>
            )}
          </div>
          {canOpen && (
            <button type="button" data-excavator-open="node" onClick={() => enterNodeAction("domain", node.id)} className={`shrink-0 ${OPEN_BUTTON}`}>
              Open
            </button>
          )}
          <button
            onClick={() => setFocusNode(focusNodeId === node.id ? null : node.id)}
            className={`shrink-0 rounded px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              focusNodeId === node.id
                ? "border border-gold/40 bg-gold/20 text-gold"
                : "border border-border-subtle text-text-muted hover:border-gold/30 hover:text-gold"
            }`}
          >
            {focusNodeId === node.id ? t.common.unfocus : t.common.focus}
          </button>
        </div>
      </div>

      <FigmaThumbnail node={node} />

      <div className="px-5 pb-2">
        <p className="mb-3 text-sm leading-relaxed text-text-secondary">
          {summaryRemoved(node) ? <span className="italic text-text-muted">{t.nodeInfo.summaryRemoved}</span> : node.summary}
        </p>

        {verdict && (
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${verdictBadgeColors[verdict]}`}>{t.nodeInfo[verdict]}</span>
            <span className="text-[10px] text-text-muted">{t.nodeInfo.verdictTitle}</span>
          </div>
        )}
      </div>

      {node.filePath && viewMode !== "domain" && (
        <Section title={t.common.file}>
          <div className="flex items-start justify-between gap-3 pb-2 text-xs text-text-secondary">
            <div className="min-w-0 truncate font-mono" title={node.filePath}>
              {node.filePath}
              {node.lineRange && <span className="ml-2 text-text-muted">L{node.lineRange[0]}-{node.lineRange[1]}</span>}
            </div>
            <button
              type="button"
              onClick={() => openCodeViewer(node.id)}
              className="shrink-0 rounded border border-accent/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent transition-colors hover:border-accent/60 hover:text-accent-bright"
            >
              {t.common.openCode}
            </button>
          </div>
        </Section>
      )}

      {node.languageNotes && (
        <Section title={t.nodeInfo.languageConcepts}>
          <button
            onClick={() => setLanguageExpanded(!languageExpanded)}
            className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted hover:text-accent"
            aria-expanded={languageExpanded}
          >
            {languageExpanded ? "Hide" : "Show"}
          </button>
          {languageExpanded && <p className="m-0 pb-2 text-sm leading-relaxed text-text-secondary">{node.languageNotes}</p>}
        </Section>
      )}

      {node.tags.length > 0 && (
        <Section title={t.common.tags}>
          <p className="m-0 pb-2 text-[11px] text-text-secondary">{node.tags.join(", ")}</p>
        </Section>
      )}

      {/* Knowledge-specific details */}
      {activeGraph && node && (node.type === "article" || node.type === "entity" || node.type === "topic" || node.type === "claim" || node.type === "source") && (
        <KnowledgeNodeDetails node={node} graph={activeGraph} />
      )}

      {/* Domain-specific details */}
      {activeGraph && node && (node.type === "domain" || node.type === "flow" || node.type === "step") && (
        <DomainNodeDetails node={node} graph={activeGraph} />
      )}

      {/* Excavator: the relations product's calls this node makes and receives (excavator/views/relations/NodeCommunication.tsx). */}
      {viewMode !== "domain" && <NodeCommunication nodeId={node.id} />}

      {/* Excavator: the node's file history, unused-code and document facts, for products the page holds. */}
      {viewMode !== "domain" && <NodeProductFacts node={{ id: node.id, type: node.type, filePath: node.filePath }} />}

      {/* Child classes/functions within this file */}
      {childNodes.length > 0 && (
        <Section title={t.nodeInfo.definedInThisFile}>
          <ul className={LIST_CLASS}>
            {childNodes.map((child) => {
              const childTypeBadge = typeBadgeColors[child.type as NodeType] ?? typeBadgeColors.file;
              return (
                <li key={child.id}>
                  <button type="button" className="block w-full py-2 text-left text-xs transition-colors hover:text-accent" onClick={() => navigateToNode(child.id)}>
                    <span className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${childTypeBadge}`}>{child.type}</span>
                      <span className="truncate text-text-primary">{child.name}</span>
                    </span>
                    {child.summary && <span className="mt-1 line-clamp-1 block text-[11px] text-text-muted">{child.summary}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* Other connections (excluding "contains" children) */}
      {otherConnections.length > 0 && (
        <Section title={t.common.connections}>
          <ul className={LIST_CLASS}>
            {otherConnections.map((edge, i) => {
              const isSource = edge.source === node.id;
              const otherId = isSource ? edge.target : edge.source;
              const otherNode = activeGraph?.nodes.find((n) => n.id === otherId);
              const dirLabel = getDirectionalLabel(edge.type, isSource, t);
              const arrow = isSource ? "\u2192" : "\u2190";
              const evidence = evidenceLabel(edge);

              return (
                <li key={i}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 py-2 text-left text-xs transition-colors hover:text-accent"
                    onClick={() => navigateToNode(otherId)}
                  >
                    <span className="font-mono text-gold">{arrow}</span>
                    <span className="text-text-muted">{dirLabel}</span>
                    <span className="truncate text-text-primary">
                      {otherNode ? (viewMode === "domain" ? flowTitle(otherNode.name, translatorOf(nameTranslations)).label : otherNode.name) : otherId}
                    </span>
                    {evidence && viewMode !== "domain" && (
                      <span className="basis-full truncate pl-5 font-mono text-[10px] text-text-muted" title={evidence}>
                        {evidence}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
