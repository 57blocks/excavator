// `prd.mjs entrypoints`: NestJS decorators and the widened route path hint
// (openspec change handbook-nestjs-entrypoints, oracle O1).
import { afterEach, describe, expect, it } from 'vitest';

import { itemKeys, makeTempDir, runPrd, writeFiles } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
function temp() {
  const dir = makeTempDir();
  cleanups.push(dir.cleanup);
  return dir.root;
}

const CONTROLLER = [
  "import { Controller, Get, Post, Delete } from '@nestjs/common';",
  '',
  "@Controller('orders')",
  'export class OrdersController {',
  '  @Get()',
  '  list() { return []; }',
  '',
  "  @Post(':id')",
  '  create() { return {}; }',
  '',
  "  @Delete(':id')",
  '  remove() { return {}; }',
  '}',
  '',
].join('\n');

const TASKS = [
  "import { Cron, Interval, Timeout } from '@nestjs/schedule';",
  '',
  'export class InvoiceTasks {',
  "  @Cron('0 * * * *')",
  '  hourly() {}',
  '',
  '  @Interval(5000)',
  '  poll() {}',
  '',
  '  @Timeout(1000)',
  '  warmup() {}',
  '}',
  '',
].join('\n');

const LISTENERS = [
  "import { OnEvent } from '@nestjs/event-emitter';",
  '',
  'export class OrderListener {',
  "  @OnEvent('order.created')",
  '  onCreated() {}',
  '',
  "  @OnEvent('order.paid')",
  '  onPaid() {}',
  '}',
  '',
].join('\n');

function sources() {
  return {
    'src/orders.controller.ts': CONTROLLER,
    'src/invoice.tasks.ts': TASKS,
    'src/order.listener.ts': LISTENERS,
  };
}

describe('NestJS entrypoint groups', () => {
  it('lists exactly the handler decorators, with the kinds the groups give, and not the @Controller line', () => {
    const root = temp();
    writeFiles(root, {
      ...sources(),
      'package.json': JSON.stringify({
        dependencies: { '@nestjs/core': '1.0.0', '@nestjs/schedule': '1.0.0', '@nestjs/event-emitter': '1.0.0' },
      }),
    });
    const out = runPrd(['entrypoints', root]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.json.covered).toEqual(expect.arrayContaining(['nestjs', 'nestjs-schedule', 'nestjs-event']));
    expect(itemKeys(out.json.items)).toEqual([
      'src/invoice.tasks.ts:4 job nestjs-schedule',
      'src/invoice.tasks.ts:7 job nestjs-schedule',
      'src/invoice.tasks.ts:10 job nestjs-schedule',
      'src/order.listener.ts:4 job nestjs-event',
      'src/order.listener.ts:7 job nestjs-event',
      'src/orders.controller.ts:5 route nestjs',
      'src/orders.controller.ts:8 route nestjs',
      'src/orders.controller.ts:11 route nestjs',
    ]);
    expect(out.json.items.some((item) => item.text.includes('@Controller'))).toBe(false);
  });

  it('lists nothing for the same decorators in a project without the NestJS dependencies', () => {
    const root = temp();
    writeFiles(root, { ...sources(), 'package.json': JSON.stringify({ dependencies: { express: '1.0.0' } }) });
    const out = runPrd(['entrypoints', root]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.json.frameworks.filter((name) => name.startsWith('nestjs'))).toEqual([]);
    expect(out.json.items).toEqual([]);
  });
});

describe('route path hint "rout"', () => {
  it('lists path: in a route-manifest file and not in an api-config file', () => {
    const root = temp();
    writeFiles(root, {
      'package.json': JSON.stringify({ dependencies: { 'react-router-dom': '6.0.0' } }),
      'src/routes/route-manifest.ts': "export const manifest = [\n  { path: '/orders' },\n  { path: '/invoices' },\n];\n",
      'src/api-config.ts': "export const api = {\n  path: '/v1/orders',\n};\n",
    });
    const out = runPrd(['entrypoints', root]);
    expect(out.status, out.stderr).toBe(0);
    expect(itemKeys(out.json.items)).toEqual([
      'src/routes/route-manifest.ts:2 page react-router',
      'src/routes/route-manifest.ts:3 page react-router',
    ]);
  });
});
