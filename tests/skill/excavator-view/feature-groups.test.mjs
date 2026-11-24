import { describe, expect, it } from 'vitest';

import {
  ENTRY_LABELS,
  FEATURE_GROUPS_FORMAT,
  MAX_GROUPS,
  NO_ROUTE_LABEL,
  OTHER_LABEL,
  addressKey,
  entryRoutes,
  featureGroups,
  featureSegments,
  shownNames,
  splitWords,
  wordKey,
} from '../../../skills/excavator-view/feature-groups.mjs';

const domain = (id) => ({ id, type: 'domain', name: id });
const flow = (id, meta) => ({ id, type: 'flow', name: id, domainMeta: meta });
const backend = (id, entryPoint) => flow(id, { entryType: 'http', entryPoint, module: 'api/handlers/x' });
const page = (id, path, module = 'web/src/pages') => flow(id, { entryType: 'manual', entryPoint: path, module });
const step = (id, filePath, nodeIds = []) => ({ id, type: 'step', name: id, filePath, nodeIds });
const contains = (domainId, ...flowIds) => flowIds.map((target) => ({ source: domainId, target, type: 'contains_flow' }));
const stepOf = (flowId, stepId) => ({ source: flowId, target: stepId, type: 'flow_step', weight: 0.1 });
const call = (file, method, path, receiverNodeId = 'function:api/router.go:Register()') => ({
  kind: 'http',
  bucket: 'linked',
  address: { method, path },
  caller: { unit: 'unit:web', file },
  receiver: { unit: 'unit:api', nodeId: receiverNodeId },
});
const imports = (from, to) => ({ source: `file:${from}`, target: `file:${to}`, type: 'imports' });

describe('word keys and routes', () => {
  it('removes - and _, drops a trailing service or api, then a plural s (not ss, us or is)', () => {
    expect(wordKey('work_logs')).toBe('worklog');
    expect(wordKey('Work-Log')).toBe('worklog');
    expect(wordKey('userService')).toBe('user');
    expect(wordKey('payments-api')).toBe('payment');
    expect(wordKey('status')).toBe('status');
    expect(wordKey('analysis')).toBe('analysis');
    expect(wordKey('service')).toBe('service');
  });

  it('splits names into words at separators and case changes', () => {
    expect(splitWords('workLogReportService')).toEqual(['work', 'log', 'report', 'service']);
    expect(splitWords('hiring-dashboard')).toEqual(['hiring', 'dashboard']);
  });

  it('reads every route of an entry point, bare paths included, and nothing from a name', () => {
    expect(entryRoutes('GET /v2/a/:id, POST /v2/a')).toEqual([{ method: 'GET', segments: ['v2', 'a', ':id'] }, { method: 'POST', segments: ['v2', 'a'] }]);
    expect(entryRoutes('/my/leave?tab=1')).toEqual([{ method: null, segments: ['my', 'leave'] }]);
    expect(entryRoutes('ResetProjectKeys')).toEqual([]);
    expect(entryRoutes(undefined)).toEqual([]);
  });

  it('keeps the segments that can name a feature, and matches addresses with parameters as {}', () => {
    expect(featureSegments(['api', 'v1.1', '{orgId}', 'billing', '<id>', '*rest'])).toEqual(['billing']);
    expect(addressKey('get', ['v2', 'Bills', ':id'])).toBe('GET /v2/bills/{}');
    expect(addressKey('GET', ['v2', 'bills', '{}'])).toBe('GET /v2/bills/{}');
  });
});

describe('featureGroups', () => {
  // Three domains with routes; `manage` leads routes in all three, so it is a scope.
  // The front end `web` calls and is never called. `web/src/shared/report.ts` calls a billing flow and a people
  // flow (half each): it has no home domain, so neither flow joins its group.
  const nodes = [
    domain('domain:billing'),
    domain('domain:people'),
    domain('domain:projects'),
    domain('domain:empty'),
    backend('flow:list-bills', 'GET /v2/manage/bills'),
    backend('flow:get-bill', 'GET /v2/bills/:id'),
    page('flow:bill-page', '/manage/bills/list'),
    backend('flow:report', 'GET /v2/reports'),
    page('flow:report-page', '/reports'),
    flow('flow:nightly', { entryType: 'cron', entryPoint: 'cron schedule', module: 'api/tasks' }),
    flow('flow:loose', { module: 'api/handlers/invoices' }),
    flow('flow:nothing', { entryType: 'manual' }),
    backend('flow:people', 'GET /manage/people'),
    backend('flow:people-export', 'POST /v2/exports'),
    backend('flow:people-settings', 'GET /v2/settings'),
    backend('flow:people-report', 'GET /v2/people/report'),
    backend('flow:projects', 'GET /manage/projects/list'),
    step('step:bill-page', 'web/src/pages/bills.tsx'),
    step('step:report-page', 'web/src/pages/report.tsx'),
    step('step:projects', 'api/handlers/projects.go', ['function:api/handlers/projects.go:List()']),
  ];
  const edges = [
    ...contains('domain:billing', 'flow:nightly', 'flow:list-bills', 'flow:loose', 'flow:get-bill', 'flow:bill-page', 'flow:report', 'flow:report-page', 'flow:nothing'),
    ...contains('domain:people', 'flow:people', 'flow:people-export', 'flow:people-settings', 'flow:people-report'),
    ...contains('domain:projects', 'flow:projects'),
    stepOf('flow:bill-page', 'step:bill-page'),
    stepOf('flow:report-page', 'step:report-page'),
    stepOf('flow:projects', 'step:projects'),
  ];
  const relations = {
    units: [
      { id: 'unit:web', name: 'web', root: 'web' },
      { id: 'unit:api', name: 'api', root: 'api' },
    ],
    relations: [
      call('web/src/billing/billApi.ts', 'GET', '/v2/manage/bills'),
      call('web/src/billing/billApi.ts', 'GET', '/v2/bills/{}'),
      call('web/src/shared/report.ts', 'GET', '/v2/reports'),
      call('web/src/shared/report.ts', 'GET', '/v2/people/report'),
      call('web/src/people/peopleApi.ts', 'GET', '/manage/people'),
      call('web/src/people/peopleApi.ts', 'POST', '/v2/exports'),
      call('web/src/people/peopleApi.ts', 'GET', '/v2/settings'),
      call('web/src/projects/projectsClient.ts', 'GET', '/somewhere/else', 'function:api/handlers/projects.go:List()'),
      { ...call('web/src/people/peopleApi.ts', 'GET', '/v2/bills/{}'), bucket: 'unlinked' },
    ],
  };
  const knowledgeGraph = {
    edges: [
      imports('web/src/pages/bills.tsx', 'web/src/billing/billApi.ts'),
      imports('web/src/pages/bills.tsx', 'web/src/shared/report.ts'),
      imports('web/src/pages/report.tsx', 'web/src/shared/report.ts'),
    ],
  };
  const result = featureGroups({ nodes, edges }, { relations, knowledgeGraph });
  const summary = (groups) => groups.map((g) => ({ id: g.id, label: g.label, file: g.file, flows: g.flows.map((f) => `${f.id} ${f.rule}${f.scope ? ` @${f.scope}` : ''}`) }));

  it('groups by caller file, page caller, route word, entry type and directory, in that order', () => {
    expect(result.format).toBe(FEATURE_GROUPS_FORMAT);
    expect(summary(result.domains['domain:billing'])).toEqual([
      { id: 'client:web/src/billing/billApi.ts', label: 'bills', file: 'web/src/billing/billApi.ts', flows: ['flow:list-bills client @manage', 'flow:get-bill client', 'flow:bill-page page-client @manage'] },
      { id: 'word:invoice', label: 'invoices', file: null, flows: ['flow:loose directory'] },
      { id: 'word:report', label: 'reports', file: null, flows: ['flow:report route', 'flow:report-page route'] },
      { id: 'entry:manual', label: ENTRY_LABELS.manual, file: null, flows: ['flow:nothing entry'] },
      { id: 'entry:cron', label: ENTRY_LABELS.cron, file: null, flows: ['flow:nightly entry'] },
    ]);
  });

  it('labels a client group with its caller file name when no route word covers half of it', () => {
    expect(summary(result.domains['domain:people'])).toEqual([
      { id: 'word:people', label: 'people', file: null, flows: ['flow:people-report route'] },
      { id: 'client:web/src/people/peopleApi.ts', label: 'people api', file: 'web/src/people/peopleApi.ts', flows: ['flow:people client @manage', 'flow:people-export client', 'flow:people-settings client'] },
    ]);
  });

  it('matches a relation to a flow by the receiver node when the address does not match', () => {
    expect(summary(result.domains['domain:projects'])).toEqual([
      { id: 'client:web/src/projects/projectsClient.ts', label: 'projects', file: 'web/src/projects/projectsClient.ts', flows: ['flow:projects client @manage'] },
    ]);
  });

  it('puts every flow of a domain in exactly one group, and gives a domain without flows no group', () => {
    const grouped = result.domains['domain:billing'].flatMap((g) => g.flows.map((f) => f.id));
    expect(grouped.sort()).toEqual(['flow:bill-page', 'flow:get-bill', 'flow:list-bills', 'flow:loose', 'flow:nightly', 'flow:nothing', 'flow:report', 'flow:report-page']);
    expect(result.domains['domain:empty']).toEqual([]);
  });

  it('still groups every flow by route, entry type and directory without the relations graph', () => {
    const plain = featureGroups({ nodes, edges });
    expect(summary(plain.domains['domain:billing']).map((g) => g.id)).toEqual(['word:bill', 'word:invoice', 'word:report', 'entry:manual', 'entry:cron']);
    expect(Object.values(plain.domains).flat().flatMap((g) => g.flows).every((f) => f.rule !== 'client' && f.rule !== 'page-client')).toBe(true);
  });

  it('keeps a flow with no route, no entry type and no module visible in its own group', () => {
    const lone = featureGroups({ nodes: [domain('d'), { id: 'flow:x', type: 'flow' }], edges: contains('d', 'flow:x') });
    expect(lone.domains.d).toEqual([{ id: 'none', kind: 'none', label: NO_ROUTE_LABEL, file: null, flows: [{ id: 'flow:x', rule: 'none', scope: null, origin: null }] }]);
  });

  it(`folds single-flow groups into "${OTHER_LABEL}", last, when a domain would show more than ${MAX_GROUPS} groups`, () => {
    const many = Array.from({ length: MAX_GROUPS + 1 }, (_, index) => backend(`flow:f${index}`, `GET /feature${String.fromCharCode(97 + index)}`));
    const big = [backend('flow:big1', 'GET /big'), backend('flow:big2', 'GET /big/x')];
    const groups = featureGroups({ nodes: [domain('d'), ...many, ...big], edges: contains('d', ...many.map((f) => f.id), ...big.map((f) => f.id)) }).domains.d;
    expect(groups.map((g) => g.label)).toEqual(['big', OTHER_LABEL]);
    expect(groups[1].flows).toHaveLength(MAX_GROUPS + 1);
    expect(groups[1].flows[0]).toEqual({ id: 'flow:f0', rule: 'route', scope: null, origin: 'featurea' });
  });

  it('tolerates a graph that is not one', () => {
    expect(featureGroups(null).domains).toEqual({});
    expect(featureGroups({ nodes: [], edges: [] }, { relations: { relations: 'x' }, knowledgeGraph: { edges: null } }).domains).toEqual({});
  });

  it('lists every shown name once: labels, scope tags and former labels', () => {
    expect(shownNames(result).sort()).toEqual(
      ['bills', 'invoices', 'reports', ENTRY_LABELS.cron, ENTRY_LABELS.manual, 'people api', 'people', 'projects', 'manage'].sort(),
    );
    expect(shownNames(null)).toEqual([]);
  });
});
