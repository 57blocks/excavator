/**
 * A synthetic multi-module project for the domain skill: 4 sub-projects, 24
 * backend handler modules, scheduled jobs, event consumers, frontend pages, a
 * CLI and a shared library with no entry point. Large enough that a single
 * domain-analyzer asked for "2-6 domains, 2-5 flows per domain" has to leave
 * modules out. Generic business names only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** [module name, a domain action, a business rule the service enforces]. */
export const HANDLERS = Object.freeze([
  ['orders', 'cancel', 'an order can be cancelled only before it ships'],
  ['invoices', 'issue', 'an invoice is issued only for a confirmed order'],
  ['payments', 'capture', 'a payment is captured at most once'],
  ['refunds', 'approve', 'a refund never exceeds the captured amount'],
  ['customers', 'verify', 'a customer email must be unique'],
  ['addresses', 'set-default', 'a customer has exactly one default address'],
  ['products', 'publish', 'a product needs a price before it is published'],
  ['categories', 'reorder', 'category positions are contiguous'],
  ['inventory', 'reserve', 'stock is never reserved below zero'],
  ['warehouses', 'transfer', 'a transfer needs two different warehouses'],
  ['shipments', 'dispatch', 'a shipment is dispatched only when fully packed'],
  ['returns', 'receive', 'a return is accepted within 30 days of delivery'],
  ['coupons', 'redeem', 'a coupon is redeemed once per customer'],
  ['promotions', 'activate', 'promotions of one product never overlap'],
  ['reviews', 'moderate', 'only verified buyers can review a product'],
  ['wishlists', 'share', 'a shared wishlist is read-only for others'],
  ['carts', 'checkout', 'checkout needs every line to be in stock'],
  ['subscriptions', 'renew', 'a renewal charges the stored payment method'],
  ['notifications', 'resend', 'a notification is resent at most three times'],
  ['reports', 'export', 'an export covers at most one year'],
  ['users', 'deactivate', 'the last administrator cannot be deactivated'],
  ['roles', 'grant', 'a role grant needs the granting user to hold the role'],
  ['audit-logs', 'archive', 'audit entries older than a year are archived'],
  ['settings', 'reset', 'a reset restores the documented defaults'],
]);

export const HANDLER_MODULES = Object.freeze(HANDLERS.map(([name]) => `services/api/src/handlers/${name}`));

const camel = (name) => name.replace(/-(\w)/g, (_, c) => c.toUpperCase());

function handlerFiles([name, action, rule]) {
  const dir = `services/api/src/handlers/${name}`;
  const fn = camel(action);
  return {
    [`${dir}/routes.js`]: [
      "const express = require('express');",
      "const service = require('./service');",
      '',
      'const router = express.Router();',
      '',
      `router.get('/${name}', async (req, res) => res.json(await service.list(req.query)));`,
      `router.post('/${name}', async (req, res) => res.status(201).json(await service.create(req.body)));`,
      `router.put('/${name}/:id', async (req, res) => res.json(await service.update(req.params.id, req.body)));`,
      `router.post('/${name}/:id/${action}', async (req, res) => res.json(await service.${fn}(req.params.id, req.user)));`,
      '',
      'module.exports = router;',
      '',
    ].join('\n'),
    [`${dir}/service.js`]: [
      "const db = require('../../lib/db');",
      "const bus = require('../../lib/bus');",
      '',
      `const TABLE = '${name.replace(/-/g, '_')}';`,
      '',
      'async function list(query) {',
      '  return db.select(TABLE, query);',
      '}',
      '',
      'async function create(input) {',
      "  if (!input || typeof input !== 'object') throw new Error('invalid input');",
      '  const row = await db.insert(TABLE, input);',
      `  bus.publish('${name}.created', { id: row.id });`,
      '  return row;',
      '}',
      '',
      'async function update(id, input) {',
      '  return db.update(TABLE, id, input);',
      '}',
      '',
      `// Rule: ${rule}.`,
      `async function ${fn}(id, actor) {`,
      '  const row = await db.get(TABLE, id);',
      "  if (!row) throw new Error('not found');",
      `  if (!row.allowed) throw new Error('${rule}');`,
      `  const next = await db.update(TABLE, id, { status: '${action}', by: actor && actor.id });`,
      `  bus.publish('${name}.${action}', { id });`,
      '  return next;',
      '}',
      '',
      `module.exports = { list, create, update, ${fn} };`,
      '',
    ].join('\n'),
  };
}

const JOBS = [
  ['expire-carts', 'carts left for 7 days are emptied'],
  ['renew-subscriptions', 'subscriptions due today are renewed'],
];
const CONSUMERS = [
  ['orders.created', 'reserve stock for every order line'],
  ['payments.capture', 'mark the order as paid'],
  ['shipments.dispatch', 'email the customer a tracking link'],
];
const PAGES = ['checkout', 'order-history', 'product-detail', 'account', 'admin-users', 'admin-reports'];
const COMMANDS = ['import-products', 'rebuild-search', 'purge-audit'];

/** Write the project under `root`; returns the list of written files. */
export function writeMultiModuleProject(root) {
  const files = {
    'package.json': JSON.stringify({ name: 'shop-suite', private: true, workspaces: ['services/*', 'apps/*', 'tools/*'] }, null, 2),
    'README.md': '# Shop suite\n\nAn online shop: catalogue, orders, payments, fulfilment and administration.\n',
    'services/api/package.json': JSON.stringify({ name: 'api', dependencies: { express: '^4.0.0', 'node-cron': '^3.0.0' } }, null, 2),
    'services/api/src/lib/db.js': 'module.exports = { select: async () => [], insert: async (t, r) => ({ id: 1, ...r }), update: async (t, id, r) => ({ id, ...r }), get: async (t, id) => ({ id, allowed: true }) };\n',
    'services/api/src/lib/bus.js': 'const listeners = [];\nmodule.exports = { publish(topic, payload) { listeners.forEach((l) => l(topic, payload)); } };\n',
    'services/api/src/server.js': [
      "const express = require('express');",
      'const app = express();',
      ...HANDLERS.map(([name]) => `app.use('/api', require('./handlers/${name}/routes'));`),
      'app.listen(8080);',
      '',
    ].join('\n'),
    'services/worker/package.json': JSON.stringify({ name: 'worker' }, null, 2),
    'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0' } }, null, 2),
    'tools/cli/package.json': JSON.stringify({ name: 'cli', dependencies: { commander: '^11.0.0' } }, null, 2),
  };
  for (const handler of HANDLERS) Object.assign(files, handlerFiles(handler));
  for (const [job, rule] of JOBS) {
    files[`services/api/src/jobs/${job}.js`] = [
      "const cron = require('node-cron');",
      "const db = require('../lib/db');",
      '',
      `// Rule: ${rule}.`,
      `cron.schedule('0 3 * * *', async () => {`,
      `  await db.update('jobs', '${job}', { ranAt: Date.now() });`,
      '});',
      '',
    ].join('\n');
  }
  for (const [topic, rule] of CONSUMERS) {
    files[`services/worker/src/consumers/${topic.replace(/\./g, '-')}.js`] = [
      "const bus = require('../bus');",
      '',
      `// Rule: ${rule}.`,
      `bus.on('${topic}', async (event) => {`,
      '  await bus.ack(event);',
      '});',
      '',
    ].join('\n');
  }
  files['services/worker/src/bus.js'] = 'module.exports = { on() {}, ack: async () => {} };\n';
  for (const page of PAGES) {
    files[`apps/web/src/pages/${page}/index.jsx`] = [
      "import { api } from '../../api';",
      '',
      `export function handleSubmit(form) {`,
      `  return api.post('/api/${page}', form);`,
      '}',
      '',
      `export default function ${camel(`x-${page}`).slice(1)}Page() {`,
      '  return null;',
      '}',
      '',
    ].join('\n');
  }
  files['apps/web/src/api.js'] = 'export const api = { post: async () => ({}) };\n';
  files['tools/cli/src/commands.js'] = [
    "const { program } = require('commander');",
    ...COMMANDS.map((c) => `program.command('${c}').action(() => require('./tasks').run('${c}'));`),
    'program.parse();',
    '',
  ].join('\n');
  files['tools/cli/src/tasks.js'] = 'module.exports = { run: async () => {} };\n';

  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return Object.keys(files).sort();
}
