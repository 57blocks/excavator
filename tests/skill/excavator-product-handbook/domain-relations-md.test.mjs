// O1 (handbook.md half) of openspec change handbook-domain-page: each domain of handbook.md lists the
// handoffs its verified entries make to, and receive from, other domains, in two lists with fixed texts.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { domainParts, flowDiagram, structureDiagram, systemsSection } from '../../../skills/excavator-product-handbook/lib/render-entities.mjs';

const strings = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;
const t = (key) => {
  if (strings[key] === undefined) throw new Error(`no fixed text ${key}`);
  return strings[key];
};

const map = { features: [{ id: 'F1', name: 'Apply' }, { id: 'F2', name: 'Approve' }, { id: 'F3', name: 'Hours' }] };
const entities = {
  domainBasis: 'domains',
  domains: [
    { id: 'D1', name: 'Leave', features: ['F1'], purposes: [], relations: [
      { direction: 'out', domain: 'D2', from: 'F1', to: 'F2', text: 'The request waits for approval.' },
      { direction: 'in', domain: 'D3', from: 'F3', to: 'F1', text: 'Hours limit the request.' },
    ] },
    { id: 'D2', name: 'Approvals', features: ['F2'], purposes: [], relations: [{ direction: 'in', domain: 'D1', from: 'F1', to: 'F2', text: 'The request waits for approval.' }] },
    { id: 'D3', name: 'Hours', features: ['F3'], purposes: [], relations: [] },
    { id: 'D4', name: 'Quiet', features: [], purposes: [], relations: [] },
  ],
  domainFlows: [{ from: 'D1', to: 'D2', count: 1 }, { from: 'D3', to: 'D1', count: 2 }],
  integrations: [{ system: 'Mail', use: 'Sends mail.', shown: ['svc', 'web'], named: [], namedOutside: 0 }, { system: 'Chat', use: 'Posts.', shown: ['svc'], named: [], namedOutside: 0 }],
  roles: [],
  applications: [],
  relations: { featureApplication: [], unattributed: [] },
  matrices: { roleFeature: { roles: [], features: [], cells: [] } },
};

const sectionOf = (lines, from, to) => {
  const body = lines.join('\n');
  const start = body.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = body.indexOf(to, start + from.length);
  return end === -1 ? body.slice(start) : body.slice(start, end);
};

/** The domains of the domains chapter as render.mjs composes them: the notes, then each domain under its own heading. */
const domainLines = (given) => {
  const parts = domainParts({ map, entities: given, t });
  return [...parts.intro, ...given.domains.flatMap((domain, at) => [`### ${domain.name}`, '', ...parts.domains[at].lines])];
};

describe('handbook.md: the relations of a domain with other domains', () => {
  const lines = domainLines(entities);

  it('lists what the domain gives and what it gets, each with both features, the other domain and the handoff', () => {
    const leave = sectionOf(lines, '### Leave', '### Approvals');
    expect(leave).toContain(`#### ${t('md.entities.domain.relationsHeading')}`);
    const gives = sectionOf(leave.split('\n'), `${t('md.entities.domain.gives')}`, `${t('md.entities.domain.gets')}`);
    expect(gives).toContain('- F1 Apply hands off to F2 Approve (Approvals): The request waits for approval.');
    const gets = leave.slice(leave.indexOf(t('md.entities.domain.gets')));
    expect(gets).toContain('- F3 Hours hands off to F1 Apply (Hours): Hours limit the request.');
  });

  it('writes none for a side with no handoff, and the note once', () => {
    const hours = sectionOf(lines, '### Hours', '\n## ');
    expect(hours).toContain(`${t('md.entities.domain.gives')}\n\n${t('md.none')}`);
    expect(hours).toContain(`${t('md.entities.domain.gets')}\n\n${t('md.none')}`);
    expect(lines.join('\n').split(t('md.entities.domain.relationsNote')).length).toBe(2);
  });
});

describe('handbook.md: the business flow between domains and the technical structure (handbook-domain-page D4, D5)', () => {
  const flowOf = (given) => flowDiagram(given, t).join('\n');
  const diagramOf = (given) => structureDiagram(given, t).join('\n');

  it('draws one node for each domain with a flow and one edge for each flow, labelled with its count', () => {
    const flow = flowOf(entities);
    expect(flow).toContain(t('md.entities.domains.flowNote'));
    expect(flow).toContain('```mermaid\nflowchart LR\n  D0["Leave"]\n  D1["Approvals"]\n  D2["Hours"]\n  D0 -->|"1"| D1\n  D2 -->|"2"| D0\n```');
    expect(flow).not.toContain('Quiet');
  });

  it('draws the applications and the external systems the verified overview shows them calling; the systems section no longer holds the diagram', () => {
    const diagram = diagramOf(entities);
    expect(diagram).toContain(t('md.entities.systems.diagramNote'));
    expect(diagram).toContain('```mermaid\nflowchart LR\n  A0["svc"]\n  A1["web"]\n  S0["Mail"]\n  S1["Chat"]\n  A0 --> S0\n  A1 --> S0\n  A0 --> S1\n```');
    expect(systemsSection({ entities, t }).join('\n')).not.toContain(t('md.entities.systems.diagramHeading'));
  });

  it('writes a fixed text instead of an empty diagram', () => {
    const empty = { ...entities, domainFlows: [], integrations: [{ system: 'Mail', use: 'Sends mail.', shown: [], named: [], namedOutside: 0 }] };
    expect(flowOf(empty)).toContain(`### ${t('md.entities.domains.flowHeading')}\n\n${t('md.entities.domains.flowNone')}`);
    expect(diagramOf(empty)).toContain(`### ${t('md.entities.systems.diagramHeading')}\n\n${t('md.entities.systems.diagramNone')}`);
    expect(flowOf(empty) + diagramOf(empty)).not.toContain('```mermaid');
  });
});
