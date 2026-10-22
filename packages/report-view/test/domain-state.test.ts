import { describe, expect, it } from 'vitest';

import { buildDomainIndex, type DomainEdge, type DomainNode } from '../src/data/domain';
import { drillDomainHash, drillFlowHash, domainHash, parentPlaceHash, parseDomainState, resolvePlace, selectInPlaceHash, selectNodeHash } from '../src/lib/domain-state';
import { escapeStep } from '../src/lib/graph-state';
import { parseRoute } from '../src/lib/route';

const node = (id: string, type: string): DomainNode => ({ id, type, name: id });
const edge = (source: string, target: string, type: string): DomainEdge => ({ source, target, type });
const index = buildDomainIndex({
  nodes: [node('domain:a', 'domain'), node('domain:b', 'domain'), node('flow:x', 'flow'), node('flow:y', 'flow'), node('flow:lost', 'flow'), node('step:1', 'step'), node('step:2', 'step')],
  edges: [edge('domain:a', 'flow:x', 'contains_flow'), edge('domain:b', 'flow:y', 'contains_flow'), edge('flow:x', 'step:1', 'flow_step'), edge('flow:y', 'step:1', 'flow_step'), edge('flow:y', 'step:2', 'flow_step')],
  gaps: [],
});
const state = (hash: string) => parseDomainState(parseRoute(hash).params);

describe('the domain view in the address', () => {
  it('writes the domain, the flow and the node, and leaves out what is not set', () => {
    expect(domainHash({})).toBe('#/domain');
    expect(domainHash({ domain: 'domain:a' })).toBe('#/domain?d=domain%3Aa');
    expect(domainHash({ domain: 'domain:a', flow: 'flow:x', node: 'step:1' })).toBe('#/domain?d=domain%3Aa&f=flow%3Ax&node=step%3A1');
  });

  it('reads back what it wrote, ids with separators included', () => {
    const odd = { domain: 'domain:a&b=c', flow: 'flow:x/y?z', node: 'step: 1#2' };
    expect(state(domainHash(odd))).toEqual(odd);
    expect(state('#/domain')).toEqual({ domain: null, flow: null, node: null });
    expect(state('#/domain?d=&f=&node=')).toEqual({ domain: null, flow: null, node: null });
  });
});

describe('the place an address names', () => {
  it('is the top level with no domain and no flow', () => {
    expect(resolvePlace(index, state('#/domain'))).toEqual({ kind: 'top' });
  });

  it('is a domain, and a flow of that domain', () => {
    expect(resolvePlace(index, { domain: 'domain:a', flow: null, node: null })).toMatchObject({ kind: 'domain', domain: { id: 'domain:a' } });
    expect(resolvePlace(index, { domain: 'domain:a', flow: 'flow:x', node: null })).toMatchObject({ kind: 'flow', domain: { id: 'domain:a' }, flow: { id: 'flow:x' } });
  });

  it('takes the domain of a flow named alone', () => {
    expect(resolvePlace(index, { domain: null, flow: 'flow:y', node: null })).toMatchObject({ kind: 'flow', domain: { id: 'domain:b' }, flow: { id: 'flow:y' } });
  });

  it('is nothing for ids the graph does not have, a flow that is not in the named domain, a flow in no domain, and a node of the wrong kind', () => {
    expect(resolvePlace(index, { domain: 'domain:none', flow: null, node: null })).toBeNull();
    expect(resolvePlace(index, { domain: 'domain:a', flow: 'flow:y', node: null })).toBeNull();
    expect(resolvePlace(index, { domain: null, flow: 'flow:lost', node: null })).toBeNull();
    expect(resolvePlace(index, { domain: 'flow:x', flow: null, node: null })).toBeNull();
    expect(resolvePlace(index, { domain: 'domain:a', flow: 'step:1', node: null })).toBeNull();
  });
});

describe('moving between places', () => {
  it('drills into a domain and into a flow, dropping the selection', () => {
    expect(drillDomainHash('domain:a')).toBe('#/domain?d=domain%3Aa');
    expect(drillFlowHash('domain:a', 'flow:x')).toBe('#/domain?d=domain%3Aa&f=flow%3Ax');
  });

  it('goes up one place at a time: flow to its domain, domain to the top', () => {
    const flow = resolvePlace(index, { domain: 'domain:a', flow: 'flow:x', node: null });
    const domain = resolvePlace(index, { domain: 'domain:a', flow: null, node: null });
    expect(parentPlaceHash(flow!)).toBe('#/domain?d=domain%3Aa');
    expect(parentPlaceHash(domain!)).toBe('#/domain');
    expect(parentPlaceHash({ kind: 'top' })).toBeNull();
  });

  it('selects a node where the view is, writing the domain and flow it infers so a reload comes back to the same place', () => {
    const flow = resolvePlace(index, { domain: null, flow: 'flow:y', node: null });
    expect(selectInPlaceHash(flow!, 'step:1')).toBe('#/domain?d=domain%3Ab&f=flow%3Ay&node=step%3A1');
    expect(selectInPlaceHash({ kind: 'top' }, 'domain:a')).toBe('#/domain?node=domain%3Aa');
    expect(selectInPlaceHash({ kind: 'top' }, null)).toBe('#/domain');
  });

  it('closes things from the inside out as the graph page does: dialog, drawer, selection, then a place', () => {
    const idle = { overlay: false, drawer: false, focus: false, path: false, selection: false, canGoUp: true };
    expect(escapeStep({ ...idle, overlay: true, drawer: true, selection: true })).toBe('overlay');
    expect(escapeStep({ ...idle, drawer: true, selection: true })).toBe('drawer');
    expect(escapeStep({ ...idle, selection: true })).toBe('selection');
    expect(escapeStep(idle)).toBe('level');
    expect(escapeStep({ ...idle, canGoUp: false })).toBe('none');
  });
});

describe('selecting a node from anywhere', () => {
  const at = (domain: string | null, flow: string | null) => resolvePlace(index, { domain, flow, node: null })!;

  it('stays where the node is drawn: a domain at the top, a flow of the domain shown, a step of the flow shown', () => {
    expect(selectNodeHash(index, at(null, null), 'domain:a')).toBe('#/domain?node=domain%3Aa');
    expect(selectNodeHash(index, at('domain:a', null), 'flow:x')).toBe('#/domain?d=domain%3Aa&node=flow%3Ax');
    expect(selectNodeHash(index, at('domain:b', 'flow:y'), 'step:2')).toBe('#/domain?d=domain%3Ab&f=flow%3Ay&node=step%3A2');
    // The place's own domain or flow is shown in the sidebar where it is.
    expect(selectNodeHash(index, at('domain:a', null), 'domain:a')).toBe('#/domain?d=domain%3Aa&node=domain%3Aa');
    expect(selectNodeHash(index, at('domain:a', 'flow:x'), 'flow:x')).toBe('#/domain?d=domain%3Aa&f=flow%3Ax&node=flow%3Ax');
  });

  it('goes to where the node is drawn when the place does not draw it', () => {
    // A domain is drawn at the top; a flow in its domain; a step in a flow that lists it.
    expect(selectNodeHash(index, at('domain:a', 'flow:x'), 'domain:b')).toBe('#/domain?node=domain%3Ab');
    expect(selectNodeHash(index, at(null, null), 'flow:y')).toBe('#/domain?d=domain%3Ab&node=flow%3Ay');
    expect(selectNodeHash(index, at('domain:a', null), 'step:2')).toBe('#/domain?d=domain%3Ab&f=flow%3Ay&node=step%3A2');
  });

  it('prefers the flow the view is in when a step is in more than one', () => {
    expect(index.flowsOfStep.get('step:1')).toEqual(['flow:x', 'flow:y']);
    expect(selectNodeHash(index, at('domain:b', 'flow:y'), 'step:1')).toBe('#/domain?d=domain%3Ab&f=flow%3Ay&node=step%3A1');
    expect(selectNodeHash(index, at(null, null), 'step:1')).toBe('#/domain?d=domain%3Aa&f=flow%3Ax&node=step%3A1');
  });

  it('keeps the place and names the id for a node the graph does not have, and for a flow or step nothing contains', () => {
    expect(selectNodeHash(index, at('domain:a', null), 'nothing')).toBe('#/domain?d=domain%3Aa&node=nothing');
    expect(selectNodeHash(index, at(null, null), 'flow:lost')).toBe('#/domain?node=flow%3Alost');
    expect(selectNodeHash(index, at('domain:a', null), 'step:orphan')).toBe('#/domain?d=domain%3Aa&node=step%3Aorphan');
  });

  it('does not take a step to a flow that no domain contains', () => {
    const odd = buildDomainIndex({
      nodes: [node('domain:a', 'domain'), node('flow:lost', 'flow'), node('flow:x', 'flow'), node('step:s', 'step')],
      edges: [edge('domain:a', 'flow:x', 'contains_flow'), edge('flow:lost', 'step:s', 'flow_step'), edge('flow:x', 'step:s', 'flow_step')],
      gaps: [],
    });
    const top = resolvePlace(odd, { domain: null, flow: null, node: null })!;
    expect(selectNodeHash(odd, top, 'step:s')).toBe('#/domain?d=domain%3Aa&f=flow%3Ax&node=step%3As');
    const onlyLost = buildDomainIndex({ nodes: [node('flow:lost', 'flow'), node('step:s', 'step')], edges: [edge('flow:lost', 'step:s', 'flow_step')], gaps: [] });
    expect(selectNodeHash(onlyLost, { kind: 'top' }, 'step:s')).toBe('#/domain?node=step%3As');
  });
});
