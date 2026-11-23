/**
 * A synthetic project whose business logic partly lives in directories that
 * mix several business areas, for measuring where /excavator-domain homes
 * flows. Six business areas each have a clean module in a modern API and a
 * page in a web app; a legacy service keeps one `routes/` directory and one
 * `services/` directory holding every area side by side (one file per area),
 * and a `cmd/` directory holds the scheduled jobs of every area. Shared
 * libraries, data models and infrastructure have no business entry points;
 * two route files and two jobs are genuinely non-business (health, metrics,
 * log rotation, database maintenance).
 *
 * The ground truth is exported: MIXED_FILE_AREAS maps each file of the mixed
 * directories to the area it serves, NON_BUSINESS_FILES lists the ones that
 * serve none, AREA_MODULES maps each area to its clean API module. Generic
 * business names only. Deterministic: the same call writes the same bytes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const AREAS = [
  { area: 'orders', entity: 'order', actions: ['cancel', 'confirm', 'split'], job: ['expire-unpaid-orders', '0 * * * *', 'expireUnpaid'], event: 'payment.captured' },
  { area: 'invoices', entity: 'invoice', actions: ['issue', 'void', 'remind'], job: ['send-overdue-reminders', '0 8 * * *', 'remindOverdue'], event: null },
  { area: 'inventory', entity: 'stockItem', actions: ['adjust', 'reserve', 'release'], job: ['reorder-low-stock', '30 2 * * *', 'reorderLowStock'], event: 'order.confirmed' },
  { area: 'shipments', entity: 'shipment', actions: ['dispatch', 'deliver', 'reroute'], job: ['sync-carrier-tracking', '*/15 * * * *', 'syncTracking'], event: null },
  { area: 'customers', entity: 'customer', actions: ['register', 'deactivate', 'merge'], job: ['purge-inactive-customers', '0 3 * * 0', 'purgeInactive'], event: null },
  { area: 'tickets', entity: 'ticket', actions: ['open', 'escalate', 'close'], job: ['auto-close-stale-tickets', '0 4 * * *', 'autoCloseStale'], event: 'shipment.delivered' },
];
const RULES = {
  cancel: (e) => [`  if (${e}.status === 'shipped') throw new Error('a shipped order cannot be cancelled');`, `  await refunds.request(${e}.id, ${e}.total);`],
  confirm: (e) => [`  if (!${e}.paidAt) throw new Error('an order is confirmed only after payment');`, `  bus.emit('order.confirmed', { id: ${e}.id, lines: ${e}.lines });`],
  split: (e) => [`  if (${e}.lines.length < 2) throw new Error('an order needs two lines to split');`],
  issue: (e) => [`  ${e}.number = await numbering.next('INV');`, `  ${e}.dueAt = addDays(new Date(), ${e}.terms || 30);`],
  void: (e) => [`  if (${e}.payments.length > 0) throw new Error('a paid invoice cannot be voided');`],
  remind: (e) => [`  if (${e}.remindersSent >= 3) throw new Error('at most three reminders per invoice');`, `  await mailer.send(${e}.billingEmail, 'invoice-reminder', { number: ${e}.number });`],
  adjust: (e) => [`  if (${e}.quantity + input.delta < 0) throw new Error('stock cannot go below zero');`, `  await audit.record(actor.id, 'stock.adjust', ${e}.sku, input.delta);`],
  reserve: (e) => [`  if (${e}.available < input.quantity) throw new Error('not enough stock to reserve');`],
  release: (e) => [`  ${e}.reserved = Math.max(0, ${e}.reserved - input.quantity);`],
  dispatch: (e) => [`  if (!${e}.labelPrinted) throw new Error('print the label before dispatch');`, `  ${e}.trackingCode = await carrier.book(${e});`],
  deliver: (e) => [`  bus.emit('shipment.delivered', { id: ${e}.id, orderId: ${e}.orderId });`],
  reroute: (e) => [`  if (${e}.status === 'delivered') throw new Error('a delivered shipment cannot be rerouted');`],
  register: (e) => [`  if (await repo.findByEmail(input.email)) throw new Error('email already registered');`, `  await mailer.send(input.email, 'welcome', {});`],
  deactivate: (e) => [`  if (${e}.openOrders > 0) throw new Error('close open orders before deactivating');`],
  merge: (e) => [`  if (${e}.id === input.otherId) throw new Error('a customer cannot be merged into itself');`],
  open: (e) => [`  ${e}.priority = input.vip ? 'high' : 'normal';`],
  escalate: (e) => [`  if (${e}.level >= 3) throw new Error('already at the top support level');`, `  await pager.notify('support-lead', ${e}.id);`],
  close: (e) => [`  if (!${e}.resolution) throw new Error('a ticket needs a resolution to close');`],
};
const SHARED = ['db', 'logger', 'http', 'auth', 'errors', 'config', 'queue', 'metrics', 'cache', 'ids'];

function pascal(name) {
  return name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
}

function serviceBody(entity, actions) {
  const lines = [];
  for (const action of actions) {
    lines.push(`async function ${action}${pascal(entity)}(id, input, actor) {`, `  const ${entity} = await repo.get(id);`, `  if (!${entity}) throw new Error('${entity} not found');`);
    lines.push(...RULES[action](entity));
    lines.push(`  return repo.update(id, { status: '${action}' });`, '}', '');
  }
  return lines;
}

/** Write the project under `root`; returns the sorted list of written files. */
export function writeMixedLegacyProject(root) {
  const files = {
    'package.json': JSON.stringify({ name: 'trade-suite', private: true, workspaces: ['services/*', 'apps/*'] }, null, 2),
    'README.md': '# Trade suite\n\nOrders, invoices, inventory, shipments, customers and support tickets. The legacy service still serves the v1 API and runs the nightly jobs.\n',
  };

  for (const { area, entity, actions } of AREAS) {
    const dir = `services/api/src/modules/${area}`;
    files[`${dir}/controller.js`] = [
      "const { Router } = require('express');",
      "const service = require('./service');",
      'const router = Router();',
      `router.get('/v2/${area}', async (req, res) => res.json(await service.list(req.query)));`,
      `router.post('/v2/${area}/:id/${actions[0]}', async (req, res) => res.json(await service.${actions[0]}${pascal(entity)}(req.params.id, req.body, req.user)));`,
      'module.exports = router;',
      '',
    ].join('\n');
    files[`${dir}/service.js`] = [
      "const repo = require('./repository');",
      "const { bus, mailer, audit, refunds, numbering, carrier, pager, addDays } = require('../../shared/queue/platform');",
      '',
      'async function list(query) {',
      '  return repo.find(query);',
      '}',
      '',
      ...serviceBody(entity, actions.slice(0, 1)),
      `module.exports = { list, ${actions[0]}${pascal(entity)} };`,
      '',
    ].join('\n');
    files[`${dir}/repository.js`] = `const db = require('../../shared/db/client');\nmodule.exports = { get: (id) => db.one('${area}', id), find: (q) => db.many('${area}', q), update: (id, p) => db.patch('${area}', id, p) };\n`;

    files[`apps/web/src/pages/${area}/index.jsx`] = [
      "import { api } from '../../api/client';",
      '',
      `export function handleSearch(filters) {`,
      `  return api.get('/v2/${area}', filters);`,
      '}',
      '',
      `export function handle${pascal(actions[0])}(id) {`,
      `  return api.post(\`/v2/${area}/\${id}/${actions[0]}\`, {});`,
      '}',
      '',
    ].join('\n');

    // The legacy v1 API: one route file per area, all in one directory.
    files[`services/legacy/routes/${area}.js`] = [
      "const express = require('express');",
      `const ${entity}Service = require('../services/${area}-service');`,
      'const router = express.Router();',
      '',
      ...actions.map((a) => `router.post('/v1/${area}/:id/${a}', async (req, res) => res.json(await ${entity}Service.${a}${pascal(entity)}(req.params.id, req.body, req.user)));`),
      '',
      'module.exports = router;',
      '',
    ].join('\n');

    // Legacy services: the business rules of every area, side by side.
    const event = AREAS.find((x) => x.area === area).event;
    files[`services/legacy/services/${area}-service.js`] = [
      `const repo = require('../lib/repo')('${area}');`,
      "const { bus, mailer, audit, refunds, numbering, carrier, pager, addDays } = require('../lib/platform');",
      '',
      ...serviceBody(entity, actions),
      ...(event
        ? [`bus.on('${event}', async (event) => {`, `  const ${entity} = await repo.findByRef(event.id);`, `  if (${entity}) await ${actions[1]}${pascal(entity)}(${entity}.id, event, { id: 'system' });`, '});', '']
        : []),
      `module.exports = { ${actions.map((a) => `${a}${pascal(entity)}`).join(', ')} };`,
      '',
    ].join('\n');

    files[`services/legacy/models/${area}.js`] = `module.exports = { table: '${area}', fields: ['id', 'status', 'createdAt', 'updatedAt', 'ownerId'] };\n`;
  }

  // Scheduled business jobs of every area, in one cmd directory.
  for (const { area, job: [name, schedule, fn] } of AREAS) {
    files[`services/jobs/cmd/${name}.js`] = [
      "const cron = require('node-cron');",
      `const service = require('../../legacy/services/${area}-service');`,
      '',
      `async function ${fn}() {`,
      `  const due = await service.findDue({ job: '${name}' });`,
      `  for (const record of due) await service.${AREAS.find((x) => x.area === area).actions[1]}${pascal(AREAS.find((x) => x.area === area).entity)}(record.id, {}, { id: 'scheduler' });`,
      '}',
      '',
      `cron.schedule('${schedule}', ${fn});`,
      '',
    ].join('\n');
  }

  // Genuinely non-business entries inside the mixed directories.
  files['services/legacy/routes/health.js'] = [
    "const express = require('express');",
    "const { db } = require('../lib/platform');",
    'const router = express.Router();',
    "router.get('/health', async (req, res) => res.json({ ok: await db.ping() }));",
    "router.get('/metrics', (req, res) => res.type('text').send(require('../lib/metrics').render()));",
    'module.exports = router;',
    '',
  ].join('\n');
  files['services/jobs/cmd/rotate-logs.js'] = "const cron = require('node-cron');\nconst fs = require('fs');\ncron.schedule('0 0 * * *', () => fs.renameSync('/var/log/legacy.log', `/var/log/legacy-${Date.now()}.log`));\n";
  files['services/jobs/cmd/vacuum-database.js'] = "const cron = require('node-cron');\nconst { db } = require('../../legacy/lib/platform');\ncron.schedule('0 5 * * 0', () => db.query('VACUUM ANALYZE'));\n";

  files['services/legacy/app.js'] = [
    "const express = require('express');",
    'const app = express();',
    `for (const name of ${JSON.stringify([...AREAS.map((a) => a.area), 'health'])}) app.use(require(\`./routes/\${name}\`));`,
    'module.exports = app;',
    '',
  ].join('\n');
  files['services/legacy/lib/platform.js'] = 'module.exports = { bus: { on() {}, emit() {} }, mailer: {}, audit: {}, refunds: {}, numbering: {}, carrier: {}, pager: {}, addDays: (d, n) => d, db: { ping: async () => true, query: async () => [] } };\n';
  files['services/legacy/lib/repo.js'] = 'module.exports = (table) => ({ get: async () => null, update: async () => null, findByRef: async () => null, findByEmail: async () => null });\n';
  files['services/legacy/lib/metrics.js'] = "module.exports = { render: () => '' };\n";
  files['services/legacy/config/index.js'] = "module.exports = { port: Number(process.env.PORT || 8080), databaseUrl: process.env.DATABASE_URL };\n";
  files['services/legacy/config/logging.js'] = "module.exports = { level: process.env.LOG_LEVEL || 'info' };\n";

  for (const group of SHARED) {
    for (let i = 0; i < 3; i++) {
      files[`services/api/src/shared/${group}/${group}-${i}.js`] = `function ${group}Helper${i}(value) {\n  return value === undefined ? null : value;\n}\nmodule.exports = { ${group}Helper${i} };\n`;
    }
  }
  files['services/api/src/shared/db/client.js'] = 'module.exports = { one: async () => null, many: async () => [], patch: async () => null };\n';
  files['services/api/src/shared/queue/platform.js'] = 'module.exports = { bus: { emit() {} }, mailer: {}, audit: {}, refunds: {}, numbering: {}, carrier: {}, pager: {}, addDays: (d) => d };\n';
  files['services/api/src/app.js'] = `const express = require('express');\nconst app = express();\nfor (const name of ${JSON.stringify(AREAS.map((a) => a.area))}) app.use(require(\`./modules/\${name}/controller\`));\nmodule.exports = app;\n`;
  files['apps/web/src/api/client.js'] = "export const api = { get: async () => ({}), post: async () => ({}) };\n";
  files['apps/web/src/components/table.jsx'] = 'export function Table({ rows }) {\n  return rows.length;\n}\n';
  files['apps/web/src/components/form.jsx'] = 'export function Form({ fields }) {\n  return fields.length;\n}\n';

  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return Object.keys(files).sort();
}

export const MIXED_AREAS = Object.freeze(AREAS.map((a) => a.area));
export const AREA_MODULES = Object.freeze(Object.fromEntries(AREAS.map((a) => [a.area, `services/api/src/modules/${a.area}`])));
export const MIXED_DIRECTORIES = Object.freeze(['services/legacy/routes', 'services/legacy/services', 'services/jobs/cmd']);
export const MIXED_FILE_AREAS = Object.freeze(Object.fromEntries(AREAS.flatMap((a) => [
  [`services/legacy/routes/${a.area}.js`, a.area],
  [`services/legacy/services/${a.area}-service.js`, a.area],
  [`services/jobs/cmd/${a.job[0]}.js`, a.area],
])));
export const NON_BUSINESS_FILES = Object.freeze(['services/legacy/routes/health.js', 'services/jobs/cmd/rotate-logs.js', 'services/jobs/cmd/vacuum-database.js']);
