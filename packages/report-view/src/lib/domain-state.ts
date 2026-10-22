/**
 * What the domain view keeps in the address (openspec: changes/viewer-app,
 * design D12 and D7): `#/domain?d=<domainId>&f=<flowId>&node=<id>`. `d` and `f`
 * are the place (the top level, a domain's flows, a flow's steps); `node` is the
 * domain, flow or step shown in the sidebar. Each move is a new history entry, so
 * back, forward and a reload come back to the same place. A flow named without a
 * domain is read as a flow of its domain.
 */

import type { DomainIndex, DomainNode } from '../data/domain';
import { buildHash } from './route';

export interface DomainState {
  domain: string | null;
  flow: string | null;
  node: string | null;
}

type Params = Record<string, string | null | undefined>;

export function parseDomainState(params: Params): DomainState {
  return { domain: params.d ? params.d : null, flow: params.f ? params.f : null, node: params.node ? params.node : null };
}

export function domainHash(state: Partial<DomainState> = {}): string {
  return buildHash('domain', { d: state.domain ?? null, f: state.flow ?? null, node: state.node ?? null });
}

export type DomainPlace =
  | { kind: 'top' }
  | { kind: 'domain'; domain: DomainNode }
  | { kind: 'flow'; domain: DomainNode; flow: DomainNode };

/** The place the state names; null when it names a domain or flow the graph does not have, or a flow that is not in that domain. */
export function resolvePlace(index: Pick<DomainIndex, 'nodesById' | 'domainsOfFlow'>, state: DomainState): DomainPlace | null {
  const kindOf = (id: string, type: string) => {
    const found = index.nodesById.get(id);
    return found && found.type === type ? found : null;
  };
  if (state.flow !== null) {
    const flow = kindOf(state.flow, 'flow');
    if (!flow) return null;
    const owners = index.domainsOfFlow.get(flow.id) ?? [];
    const named = state.domain === null ? (owners[0] ?? null) : state.domain;
    const domain = named === null || !owners.includes(named) ? null : kindOf(named, 'domain');
    return domain ? { kind: 'flow', domain, flow } : null;
  }
  if (state.domain !== null) {
    const domain = kindOf(state.domain, 'domain');
    return domain ? { kind: 'domain', domain } : null;
  }
  return { kind: 'top' };
}

const placeState = (place: DomainPlace): Pick<DomainState, 'domain' | 'flow'> => ({
  domain: place.kind === 'top' ? null : place.domain.id,
  flow: place.kind === 'flow' ? place.flow.id : null,
});

export const drillDomainHash = (domainId: string) => domainHash({ domain: domainId });

export const drillFlowHash = (domainId: string, flowId: string) => domainHash({ domain: domainId, flow: flowId });

/** The place one step up (a flow's domain, a domain's top level); null at the top. */
export function parentPlaceHash(place: DomainPlace): string | null {
  if (place.kind === 'top') return null;
  return place.kind === 'flow' ? drillDomainHash(place.domain.id) : domainHash();
}

/** Select `nodeId` (or nothing) in `place`, with the place written out in full. */
export function selectInPlaceHash(place: DomainPlace, nodeId: string | null): string {
  return domainHash({ ...placeState(place), node: nodeId });
}

/**
 * Select `nodeId` where the view draws it: a domain at the top level, a flow at the level of its domain, a step at the
 * level of a flow that lists it. A node the place already draws (or is itself) stays where it is; one that the graph
 * lacks, or that nothing contains, is named in the address and the place stays.
 */
export function selectNodeHash(index: Pick<DomainIndex, 'nodesById' | 'domainsOfFlow' | 'flowsOfStep' | 'flowsOf'>, place: DomainPlace, nodeId: string): string {
  const found = index.nodesById.get(nodeId);
  const here = placeState(place);
  if (!found) return domainHash({ ...here, node: nodeId });
  if (found.type === 'domain') {
    const own = place.kind !== 'top' && place.domain.id === nodeId;
    return domainHash(own ? { ...here, node: nodeId } : { node: nodeId });
  }
  if (found.type === 'flow') {
    const owners = index.domainsOfFlow.get(nodeId) ?? [];
    if (owners.length === 0) return domainHash({ ...here, node: nodeId });
    if (place.kind === 'flow' && place.flow.id === nodeId) return domainHash({ ...here, node: nodeId });
    const domain = place.kind !== 'top' && owners.includes(place.domain.id) ? place.domain.id : owners[0];
    return domainHash({ domain, node: nodeId });
  }
  if (found.type === 'step') {
    // A flow that no domain contains is drawn nowhere, so it cannot be the place of a step.
    const flows = (index.flowsOfStep.get(nodeId) ?? []).filter((flow) => (index.domainsOfFlow.get(flow)?.length ?? 0) > 0);
    if (flows.length === 0) return domainHash({ ...here, node: nodeId });
    const inPlace = place.kind === 'flow' && flows.includes(place.flow.id);
    const flow = inPlace ? place.flow.id : flows[0];
    const domain = place.kind === 'flow' && inPlace ? place.domain.id : (index.domainsOfFlow.get(flow) as string[])[0];
    return domainHash({ domain, flow, node: nodeId });
  }
  return domainHash({ ...here, node: nodeId });
}
