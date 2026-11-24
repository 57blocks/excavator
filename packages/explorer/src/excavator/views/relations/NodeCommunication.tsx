import { useDashboardStore } from "../../../store";
import { communicationEntries, drawnHome, type CommunicationEntry } from "../../graphRelations";
import type { Translate } from "../../nameTranslations";
import { externalLabel, type UnitInfo } from "../../products/relations";
import { useGraphRelations } from "../../useGraphRelations";
import { LinkButton } from "../shared/Controls";
import { ARROW, SiteLink, Target, Translated, useTranslate } from "./names";
import { Section } from "../../panel/Section";

/**
 * The node panel's Communication section: the relations of the relations product whose caller or receiving end is this
 * node or a node it contains (a file lists the calls its functions make and receive), in any bucket. Each entry gives
 * the kind, the address or external system, the other end's unit and node, and the bucket as a word; it opens this end's code at
 * its line and moves to the other end's node. Nothing is shown for a node
 * with no relation, or while the product is not included (the graph's relations panel says why).
 */

const LEFT_ARROW = String.fromCharCode(0x2190);

export function NodeCommunication({ nodeId }: { nodeId: string }) {
  const data = useGraphRelations();
  const translate = useTranslate();
  const nodesById = useDashboardStore((s) => s.nodesById);
  if (data.status !== "ready") return null;
  const entries = communicationEntries(data.index, nodeId, (id) => nodesById.has(id));
  if (entries.length === 0) return null;
  // A node the layer does not draw is shown through the drawn node that contains it, whose panel lists the relation too.
  const home = (id: string) => drawnHome(id, data.drawn, data.parentOf) ?? id;
  return (
    <div data-excavator-communication={nodeId}>
      <Section title="Communication">
        <ul className="m-0 list-none divide-y divide-border-subtle p-0">
          {entries.map((entry) => (
            <Entry key={entry.key} entry={entry} nodeId={nodeId} units={data.units} home={home} translate={translate} />
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Entry({ entry, nodeId, units, home, translate }: { entry: CommunicationEntry; nodeId: string; units: ReadonlyMap<string, UnitInfo>; home: (id: string) => string; translate?: Translate }) {
  const { row, role, endNodeId, other } = entry;
  const nodesById = useDashboardStore((s) => s.nodesById);
  const navigateToNodeInLayer = useDashboardStore((s) => s.navigateToNodeInLayer);
  const nameOf = (id: string) => nodesById.get(id)?.name ?? id;

  return (
    <li className="space-y-0.5 py-2 text-xs" data-excavator-communication-entry={entry.key}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-gold">{role === "caller" ? ARROW : LEFT_ARROW}</span>
        <span className="text-text-muted">{role === "caller" ? "calls" : "receives"}</span>
        <span className="font-medium text-text-primary">{row.kind ?? "no kind"}</span>
        {row.external !== null ? (
          <span className="text-text-primary"><Translated english={externalLabel(row.external)} translate={translate} /></span>
        ) : row.address === null ? null : (
          <span className="font-mono text-[11px] text-text-primary [overflow-wrap:anywhere]">{row.address}</span>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 pl-4">
        <span className="text-text-muted">{role === "caller" ? "To" : "From"}</span>
        {other.kind === "external" ? (
          <span className="text-text-secondary">external system</span>
        ) : entry.otherUnit === null ? null : (
          <span className="text-text-secondary"><Target id={entry.otherUnit} units={units} translate={translate} /></span>
        )}
        {other.kind === "node" ? (
          <span className="[overflow-wrap:anywhere]" data-excavator-communication-other={other.nodeId}>
            <LinkButton title={`Show ${other.nodeId} in the graph`} onClick={() => navigateToNodeInLayer(home(other.nodeId))}>{nameOf(other.nodeId)}</LinkButton>
            <span className="ml-2"><SiteLink site={other.site} /></span>
          </span>
        ) : other.kind === "not-in-graph" ? (
          <span className="text-text-muted" data-excavator-communication-other="">
            {"node not in the graph, "}
            <SiteLink site={other.site} />
          </span>
        ) : other.kind === "missing" ? (
          <span className="text-text-muted">{other.text}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 pl-4">
        <span className="text-text-muted" data-excavator-communication-bucket={row.bucket}>{row.bucket}</span>
        <SiteLink site={entry.site} />
        {endNodeId === nodeId ? null : <span className="text-text-muted [overflow-wrap:anywhere]">{`in ${nameOf(endNodeId)}`}</span>}
      </div>
    </li>
  );
}
