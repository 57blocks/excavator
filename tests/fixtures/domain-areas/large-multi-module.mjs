/**
 * A larger, uneven synthetic project for measuring /excavator-domain
 * coverage: 30 backend modules whose controllers expose 2 to 6 actions each,
 * long service files whose actions differ in shape, a frontend with feature
 * handlers, jobs, event consumers, a CLI, and about 1,200 support files with
 * no entry point. The modules are deliberately not uniform, so an analyzer
 * cannot cover them by stamping one template over a list. Deterministic: the
 * same seed writes the same bytes. Generic business names only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MODULES = [
  'orders', 'invoices', 'payments', 'refunds', 'customers', 'addresses', 'products', 'categories',
  'inventory', 'warehouses', 'shipments', 'returns', 'coupons', 'promotions', 'reviews', 'wishlists',
  'carts', 'subscriptions', 'notifications', 'reports', 'users', 'roles', 'audit-logs', 'settings',
  'quotes', 'contracts', 'tickets', 'vendors', 'budgets', 'payouts',
];
const ACTIONS = [
  'approve', 'reject', 'cancel', 'archive', 'restore', 'assign', 'escalate', 'close', 'reopen', 'merge',
  'split', 'schedule', 'publish', 'withdraw', 'verify', 'suspend', 'renew', 'transfer', 'settle', 'audit',
];
const CHECKS = [
  (e, a) => [`  if (${e}.status === 'closed') throw new DomainError('${e} is closed; ${a} is not allowed');`],
  (e) => [`  if (${e}.amount > limits.maxAmount(${e}.currency)) throw new DomainError('amount over the limit');`],
  (e, a) => [`  if (!actor.permissions.includes('${a}:${e}')) throw new ForbiddenError('${a} needs the ${a}:${e} permission');`],
  (e) => [`  const open = await repo.countOpen(${e}.ownerId);`, `  if (open >= 5) throw new DomainError('an owner has at most five open records');`],
  (e) => [`  if (Date.now() - ${e}.createdAt > 30 * DAY) throw new DomainError('older than 30 days');`],
  (e) => [`  if (${e}.lines && ${e}.lines.some((l) => l.quantity <= 0)) throw new DomainError('every line needs a positive quantity');`],
];
const EFFECTS = [
  (e, a) => [`  await ledger.post({ kind: '${e}.${a}', amount: ${e}.amount, ref: ${e}.id });`],
  (e, a) => [`  await mailer.send(${e}.ownerEmail, '${e}-${a}', { id: ${e}.id });`],
  (e, a) => [`  bus.publish('${e}.${a}', { id: ${e}.id, by: actor.id });`],
  (e) => [`  await search.reindex('${e}', ${e}.id);`],
  (e, a) => [`  await audit.record(actor.id, '${a}', '${e}', ${e}.id);`],
];
const PAGES = ['checkout', 'order-history', 'product-detail', 'account', 'admin-users', 'admin-reports', 'vendor-portal', 'budget-planner', 'ticket-desk', 'quote-builder', 'payout-review', 'return-wizard'];
const JOBS = ['expire-carts', 'renew-subscriptions', 'close-stale-tickets', 'settle-payouts', 'rebuild-reports'];
const TOPICS = ['orders.approve', 'payments.settle', 'shipments.schedule', 'returns.verify', 'contracts.renew', 'tickets.escalate'];
const COMMANDS = ['import-products', 'rebuild-search', 'purge-audit', 'export-ledger'];

function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

const camel = (name) => name.replace(/-(\w)/g, (_, c) => c.toUpperCase());
const singular = (name) => camel(name.replace(/ies$/, 'y').replace(/s$/, ''));

function moduleFiles(name, rand) {
  const dir = `services/core/src/modules/${name}`;
  const entity = singular(name);
  const count = 2 + Math.floor(rand() * 5);
  const actions = [];
  while (actions.length < count) {
    const a = ACTIONS[Math.floor(rand() * ACTIONS.length)];
    if (!actions.includes(a)) actions.push(a);
  }
  const verbs = ['post', 'put', 'patch'];
  const controller = [
    "const { Router } = require('express');",
    "const service = require('./service');",
    "const { authorize } = require('../../shared/auth/authorize');",
    '',
    'const router = Router();',
    '',
    `router.get('/${name}', authorize('read:${entity}'), async (req, res) => res.json(await service.search(req.query)));`,
  ];
  for (const a of actions) {
    const verb = verbs[Math.floor(rand() * verbs.length)];
    controller.push(`router.${verb}('/${name}/:id/${a}', authorize('${a}:${entity}'), async (req, res) => res.json(await service.${camel(a)}(req.params.id, req.body, req.user)));`);
  }
  controller.push('', 'module.exports = router;', '');

  const service = [
    "const repo = require('./repository');",
    "const { DomainError, ForbiddenError } = require('../../shared/errors/errors');",
    "const { ledger, mailer, bus, search, audit, limits } = require('../../shared/platform/platform');",
    '',
    'const DAY = 24 * 60 * 60 * 1000;',
    '',
    'async function search(query) {',
    '  return repo.find(query);',
    '}',
    '',
  ];
  for (const a of actions) {
    const checks = 1 + Math.floor(rand() * 3);
    const effects = 1 + Math.floor(rand() * 3);
    service.push(`async function ${camel(a)}(id, input, actor) {`, `  const ${entity} = await repo.get(id);`, `  if (!${entity}) throw new DomainError('${entity} not found');`);
    for (let i = 0; i < checks; i++) service.push(...CHECKS[Math.floor(rand() * CHECKS.length)](entity, a));
    service.push(`  const next = await repo.update(id, { status: '${a}d', note: input && input.note });`);
    for (let i = 0; i < effects; i++) service.push(...EFFECTS[Math.floor(rand() * EFFECTS.length)](entity, a));
    service.push('  return next;', '}', '');
    // An internal helper per action, so files are long and not all functions are entries.
    service.push(`function ${camel(a)}Summary(${entity}) {`);
    for (let i = 0; i < 12; i++) service.push(`  const part${i} = ${entity}.field${i} === undefined ? null : String(${entity}.field${i});`);
    service.push(`  return [${Array.from({ length: 12 }, (_, i) => `part${i}`).join(', ')}].filter(Boolean).join(' / ');`, '}', '');
  }
  service.push(`module.exports = { search, ${actions.map((a) => `${camel(a)}, ${camel(a)}Summary`).join(', ')} };`, '');

  const fields = 15 + Math.floor(rand() * 15);
  const model = [`const ${entity}Schema = {`];
  for (let i = 0; i < fields; i++) model.push(`  field${i}: { type: '${['string', 'number', 'date', 'boolean'][i % 4]}', required: ${i % 3 === 0} },`);
  model.push('};', '', `module.exports = { ${entity}Schema };`, '');

  const repository = [
    "const db = require('../../shared/db/client');",
    `const TABLE = '${name.replace(/-/g, '_')}';`,
    'module.exports = {',
    '  get: (id) => db.one(TABLE, id),',
    '  find: (q) => db.many(TABLE, q),',
    '  update: (id, patch) => db.patch(TABLE, id, patch),',
    '  countOpen: (ownerId) => db.count(TABLE, { ownerId, status: "open" }),',
    '};',
    '',
  ];
  return {
    [`${dir}/controller.js`]: controller.join('\n'),
    [`${dir}/service.js`]: service.join('\n'),
    [`${dir}/model.js`]: model.join('\n'),
    [`${dir}/repository.js`]: repository.join('\n'),
  };
}

function supportFiles(rand) {
  const files = {};
  const groups = ['auth', 'errors', 'platform', 'db', 'format', 'dates', 'money', 'strings', 'http', 'cache', 'queue', 'config', 'i18n', 'pdf', 'csv', 'images', 'geo', 'tax', 'rates', 'flags', 'metrics', 'tracing', 'retry', 'locks', 'ids', 'crypto', 'mime', 'paging', 'sorting', 'filters', 'validation', 'schemas', 'fixtures', 'seeds', 'mappers', 'events', 'clock', 'random', 'text', 'units'];
  for (const group of groups) {
    for (let f = 0; f < 30; f++) {
      const fn = `${camel(group)}Helper${f}`;
      const lines = [`function ${fn}(value) {`];
      const n = 5 + Math.floor(rand() * 20);
      for (let i = 0; i < n; i++) lines.push(`  value = value === null ? ${i} : value;`);
      lines.push('  return value;', '}', '', `module.exports = { ${fn} };`, '');
      files[`services/core/src/shared/${group}/${group}-${String(f).padStart(2, '0')}.js`] = lines.join('\n');
    }
  }
  files['services/core/src/shared/auth/authorize.js'] = 'exports.authorize = (perm) => (req, res, next) => next();\n';
  files['services/core/src/shared/errors/errors.js'] = 'class DomainError extends Error {}\nclass ForbiddenError extends Error {}\nmodule.exports = { DomainError, ForbiddenError };\n';
  files['services/core/src/shared/platform/platform.js'] = 'module.exports = { ledger: {}, mailer: {}, bus: {}, search: {}, audit: {}, limits: {} };\n';
  files['services/core/src/shared/db/client.js'] = 'module.exports = {};\n';
  return files;
}

/** Write the project under `root`; returns the sorted list of written files. */
export function writeLargeMultiModuleProject(root, { seed = 7 } = {}) {
  const rand = rng(seed);
  const files = {
    'package.json': JSON.stringify({ name: 'commerce-platform', private: true, workspaces: ['services/*', 'apps/*', 'tools/*'] }, null, 2),
    'README.md': '# Commerce platform\n\nCatalogue, ordering, billing, fulfilment, support and administration.\n',
    'services/core/package.json': JSON.stringify({ name: 'core', dependencies: { express: '^4.0.0' } }, null, 2),
    'services/core/src/app.js': [
      "const express = require('express');",
      'const app = express();',
      `const modules = ${JSON.stringify(MODULES)};`,
      "for (const name of modules) app.use('/api', require(`./modules/${name}/controller`));",
      'module.exports = app;',
      '',
    ].join('\n'),
  };
  for (const name of MODULES) Object.assign(files, moduleFiles(name, rand));
  Object.assign(files, supportFiles(rand));
  for (const job of JOBS) {
    files[`services/core/src/jobs/${job}.js`] = [
      "const cron = require('node-cron');",
      `cron.schedule('${Math.floor(rand() * 59)} ${Math.floor(rand() * 23)} * * *', async () => {`,
      `  await require('../modules/${MODULES[Math.floor(rand() * MODULES.length)]}/service').search({ job: '${job}' });`,
      '});',
      '',
    ].join('\n');
  }
  for (const topic of TOPICS) {
    files[`services/events/src/consumers/${topic.replace(/\./g, '-')}.js`] = [
      "const bus = require('../bus');",
      `bus.on('${topic}', async (event) => {`,
      '  await bus.ack(event);',
      '});',
      '',
    ].join('\n');
  }
  files['services/events/src/bus.js'] = 'module.exports = { on() {}, ack: async () => {} };\n';
  for (const page of PAGES) {
    files[`apps/portal/src/features/${page}/index.jsx`] = [
      "import { api } from '../../api';",
      '',
      `export function handleSubmit(form) {`,
      `  return api.post('/api/${page}', form);`,
      '}',
      '',
      `export function handleCancel() {`,
      `  return api.post('/api/${page}/cancel', {});`,
      '}',
      '',
    ].join('\n');
  }
  files['apps/portal/src/api.js'] = 'export const api = { post: async () => ({}) };\n';
  files['tools/ops/src/commands.js'] = [
    "const { program } = require('commander');",
    ...COMMANDS.map((c) => `program.command('${c}').action(() => require('./tasks').run('${c}'));`),
    'program.parse();',
    '',
  ].join('\n');
  files['tools/ops/src/tasks.js'] = 'module.exports = { run: async () => {} };\n';

  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return Object.keys(files).sort();
}

export const LARGE_MODULES = Object.freeze(MODULES.map((m) => `services/core/src/modules/${m}`));
