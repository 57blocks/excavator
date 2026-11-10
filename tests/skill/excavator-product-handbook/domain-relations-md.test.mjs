// O1 (handbook.md half) of openspec change handbook-domain-page: each domain of handbook.md lists the
// handoffs its verified entries make to, and receive from, other domains, in two lists with fixed texts.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { entitySections } from '../../../skills/excavator-product-handbook/lib/render-entities.mjs';

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
  ],
  roles: [],
  matrices: { roleFeature: { roles: [], features: [], cells: [] } },
};

const sectionOf = (lines, from, to) => {
  const body = lines.join('\n');
  const start = body.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = body.indexOf(to, start + from.length);
  return end === -1 ? body.slice(start) : body.slice(start, end);
};

describe('handbook.md: the relations of a domain with other domains', () => {
  const lines = entitySections({ view: 'product', map, entities, summary: { jobs: [] }, system: { applications: [] }, t });

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
