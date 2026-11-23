/**
 * A small multi-unit project for the relations scripts' tests: a browser app
 * calling a Node server through a wrapped HTTP client, the server publishing
 * on a message channel a Go worker subscribes to, realtime events, an
 * external mail SDK, a library, a test file, configuration with an address
 * line and a secret line, and a same-unit bundle (a browser file inside the
 * server unit, a different language family from nothing else there).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SCRIPTS = resolve(repoRoot, 'skills/excavator-relations');

export const FILES = {
  'package.json': JSON.stringify({ name: 'suite', private: true, workspaces: ['web', 'server', 'lib'] }, null, 2),
  'tools/release.js': "const axios = require('axios');\naxios.post('/release');\n",
  'web/package.json': JSON.stringify({ name: 'web', scripts: { dev: 'vite' } }, null, 2),
  'web/.env': 'VITE_API_URL=http://localhost:3000\nVITE_SECRET_TOKEN=http://not-shown\n',
  'web/src/http.js': "import axios from 'axios';\nexport const api = axios.create({ baseURL: '/api' });\n",
  'web/src/users.js': [
    "import { api } from './http';",
    'export function loadUser(id) {',
    '  return api.get(`/api/users/${id}`);',
    '}',
    'export function createOrder(order) {',
    "  return api.post('/api/orders', order);",
    '}',
    'export function ping() {',
    "  return api.get('/api/ping');",
    '}',
    'export function item(id) {',
    '  return api.get(`/api/items/${id}`);',
    '}',
  ].join('\n'),
  'web/src/live.js': [
    "import { io } from 'socket.io-client';",
    "const socket = io('/');",
    "socket.on('order:created', (o) => console.log(o));",
  ].join('\n'),
  'web/src/admin.js': "import { api } from './http';\nexport const stats = () => api.get('/api/admin/stats');\n",
  'web/src/plain.js': 'export const two = 1 + 1;\n',
  'web/src/users.test.js': "import axios from 'axios';\n",
  'server/package.json': JSON.stringify({ name: 'server', scripts: { start: 'node app.js' } }, null, 2),
  'server/app.js': [
    "const express = require('express');",
    "const redis = require('redis');",
    "const nodemailer = require('nodemailer');",
    'const app = express();',
    "app.get('/api/users/:id', (req, res) => res.json({}));",
    "app.post('/api/orders', (req, res) => {",
    "  pub.publish('orders.created', JSON.stringify(req.body));",
    "  io.emit('order:created', req.body);",
    "  mailer.sendMail({ to: 'a@b.c' });",
    '  res.json({});',
    '});',
    "app.get('/api/users/me', (req, res) => res.json({}));",
    "app.get('/api/items/:id', (req, res) => res.json({}));",
  ].join('\n'),
  'server/public/widget.js': "fetch('/api/ping').then((r) => r.json());\n",
  'worker/go.mod': 'module example.com/worker\n\ngo 1.21\n',
  'worker/main.go': [
    'package main',
    '',
    'import "github.com/redis/go-redis/v9"',
    '',
    'func main() {',
    '\tsub := rdb.Subscribe(ctx, "orders.created")',
    '\t_ = sub',
    '\thttp.HandleFunc("/api/items/{key}", h)',
    '}',
  ].join('\n'),
  'lib/package.json': JSON.stringify({ name: 'lib' }, null, 2),
  'lib/index.js': 'export const x = 1;\n',
};

export function makeProject(files = FILES) {
  const root = mkdtempSync(join(tmpdir(), 'relations-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

export function removeProject(root) {
  rmSync(root, { recursive: true, force: true });
}

export function run(script, args) {
  const result = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf-8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** One knowledge-graph line per record, header first. */
export function writeGraph(path, { factsDigest = 'facts-1', nodes = [], edges = [], entryPoints = [] } = {}) {
  const lines = [
    JSON.stringify({ record: 'header', fields: { project: { factsDigest } } }),
    ...nodes.map((node) => JSON.stringify({ record: 'node', node })),
    ...edges.map((edge) => JSON.stringify({ record: 'edge', edge })),
    ...entryPoints.map((entryPoint) => JSON.stringify({ record: 'entryPoint', entryPoint })),
  ];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join('\n')}\n`);
}
