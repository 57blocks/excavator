#!/usr/bin/env node
/**
 * view-smoke.mjs
 *
 * Opens a packed report page in local headless Chrome over the DevTools pipe
 * and reports what the browser saw (openspec: changes/report-viewer, design
 * O3). Zero dependencies; not part of `pnpm test` because it needs a Chrome
 * install.
 *
 *   node scripts/view-smoke.mjs <page.html> [--width N] [--height N] [--dark] [--hash <route>] [--eval <js>] [--screenshot <png>]
 *
 * It waits (in real time, 30 s at most) for `data-xv-ready` on <html>, then
 * collects every console error, uncaught exception, CSP violation, inline event
 * attribute in the DOM (the policy allows inline script, so only the DOM shows
 * those) and network request other than the main document, plus every
 * `data-xv-count-*` value, and prints one JSON result. `--hash` opens a route
 * (for example `/code?path=src%2Fa.js&lines=3-9`); the result then lists the line
 * numbers the Code page highlighted and any notice it showed. `--eval` runs a
 * JavaScript expression in the page once it is ready (to click a filter, say),
 * waits for the page to settle and then collects everything; its value is
 * returned as `evalResult`. The exit status is 1 when any of those errors is
 * present, when the page reports `data-xv-ready="error"`, or on timeout.
 *
 * Chrome: `$CHROME`, else the macOS app, else google-chrome / chromium on PATH.
 * The transport is `--remote-debugging-pipe`: JSON messages ending in a NUL
 * byte, written to fd 3 and read from fd 4 of the child. The browser is closed
 * with `Browser.close` before any kill, and its temporary profile is removed.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const READY_TIMEOUT_MS = 30000;
const COMMAND_TIMEOUT_MS = 15000;
const SETTLE_MS = 300;
const MAX_SCREENSHOT_HEIGHT = 5000;

const USAGE = 'Usage: node scripts/view-smoke.mjs <page.html> [--width N] [--height N] [--dark] [--hash <route>] [--eval <js>] [--screenshot <png>]';

function parseArgs(argv) {
  const options = { html: null, width: 1280, height: 900, dark: false, hash: null, eval: null, screenshot: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dark') options.dark = true;
    else if (arg === '--width' || arg === '--height') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 100 || value > 10000) throw new Error(`${arg} needs an integer between 100 and 10000`);
      options[arg.slice(2)] = value;
    } else if (arg === '--hash') {
      options.hash = argv[++i];
      if (!options.hash) throw new Error('--hash needs a route');
    } else if (arg === '--eval') {
      options.eval = argv[++i];
      if (!options.eval) throw new Error('--eval needs a JavaScript expression');
    } else if (arg === '--screenshot') {
      options.screenshot = argv[++i];
      if (!options.screenshot) throw new Error('--screenshot needs a path');
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}\n${USAGE}`);
    else if (options.html === null) options.html = arg;
    else throw new Error(`unexpected argument ${arg}\n${USAGE}`);
  }
  if (options.html === null) throw new Error(USAGE);
  return options;
}

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  if (process.platform === 'darwin') {
    const app = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (existsSync(app)) return app;
  }
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    const found = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf-8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error('no Chrome found: set CHROME to a Chrome or Chromium executable');
}

/** A DevTools client over the pipe pair: send(method, params, sessionId) resolves with the result; events go to `onEvent`. */
function connect(child, onEvent) {
  const pending = new Map();
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  child.stdio[4].on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (let end = buffer.indexOf(0); end !== -1; end = buffer.indexOf(0)) {
      const message = JSON.parse(buffer.subarray(0, end).toString('utf-8'));
      buffer = buffer.subarray(end + 1);
      if (message.id !== undefined) {
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
        else waiter.resolve(message.result);
      } else {
        onEvent(message);
      }
    }
  });
  child.stdio[3].on('error', () => {});
  return function send(method, params = {}, sessionId) {
    const id = nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: no answer in ${COMMAND_TIMEOUT_MS} ms`));
      }, COMMAND_TIMEOUT_MS);
      pending.set(id, {
        method,
        resolve: (value) => { clearTimeout(timer); resolvePromise(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      child.stdio[3].write(`${JSON.stringify(message)}\0`);
    });
  };
}

// Recorded on every new document before the page's own scripts run.
const VIOLATION_RECORDER = `
  window.__xvViolations = [];
  document.addEventListener('securitypolicyviolation', function (event) {
    window.__xvViolations.push({
      directive: event.violatedDirective,
      blocked: event.blockedURI,
      source: event.sourceFile,
      line: event.lineNumber,
    });
  }, true);
`;

const PAGE_PROBE = `(function () {
  var root = document.documentElement;
  var counts = {};
  Array.prototype.forEach.call(root.attributes, function (attr) {
    if (attr.name.indexOf('data-xv-count-') === 0) counts[attr.name.slice('data-xv-count-'.length)] = attr.value;
  });
  // The policy allows inline script, so it cannot flag an inline event attribute: look for them in the DOM.
  var inlineHandlers = [];
  Array.prototype.forEach.call(document.querySelectorAll('*'), function (el) {
    Array.prototype.forEach.call(el.attributes, function (attr) {
      if (/^on/i.test(attr.name)) inlineHandlers.push(el.tagName.toLowerCase() + '[' + attr.name + ']');
    });
  });
  return JSON.stringify({
    ready: root.getAttribute('data-xv-ready'),
    counts: counts,
    violations: window.__xvViolations || [],
    inlineHandlers: inlineHandlers,
    title: document.title,
    scrollWidth: root.scrollWidth,
    innerWidth: window.innerWidth,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    highlighted: Array.prototype.map.call(document.querySelectorAll('.xv-line-hl'), function (el) { return Number(el.getAttribute('data-n')); }),
    highlightInView: (function () {
      var line = document.querySelector('.xv-line-hl');
      var box = document.querySelector('.xv-code');
      if (!line || !box) return null;
      var l = line.getBoundingClientRect();
      var c = box.getBoundingClientRect();
      return l.top >= c.top && l.bottom <= c.bottom && l.top >= 0 && l.bottom <= window.innerHeight;
    })(),
    notice: (document.querySelector('.xv-notice') || {}).textContent || null,
    codeLines: document.querySelectorAll('.xv-line').length,
    prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
  });
})()`;

function describeException(details) {
  const text = details.exception && details.exception.description ? details.exception.description : details.text;
  return `${text} (line ${details.lineNumber}, column ${details.columnNumber})`;
}

async function run(options) {
  const htmlPath = resolve(options.html);
  if (!existsSync(htmlPath)) throw new Error(`${htmlPath} does not exist`);
  const documentUrl = pathToFileURL(htmlPath).href;
  const pageUrl = options.hash === null ? documentUrl : `${documentUrl}#${options.hash.replace(/^#/, '')}`;
  const profile = mkdtempSync(join(tmpdir(), 'xv-smoke-'));
  const found = { console: [], exceptions: [], log: [], requests: [], loadFailures: [] };

  const child = spawn(findChrome(), [
    '--headless=new',
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    `--window-size=${options.width},${options.height}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.on('error', () => { exited = true; });

  let sessionId;
  const documentRequests = new Set();
  const onEvent = (message) => {
    if (message.sessionId !== sessionId) return;
    const params = message.params || {};
    switch (message.method) {
      case 'Runtime.consoleAPICalled':
        if (params.type === 'error' || params.type === 'assert') {
          found.console.push(params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
        }
        break;
      case 'Runtime.exceptionThrown':
        found.exceptions.push(describeException(params.exceptionDetails));
        break;
      case 'Log.entryAdded':
        if (params.entry.level === 'error') found.log.push(`${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ''}`);
        break;
      case 'Network.requestWillBeSent':
        if (params.type === 'Document' && (params.request.url === pageUrl || params.request.url === documentUrl)) documentRequests.add(params.requestId);
        else if (!/^(data|blob|about):/.test(params.request.url)) found.requests.push(params.request.url);
        break;
      case 'Network.loadingFailed':
        if (!documentRequests.has(params.requestId)) found.loadFailures.push(`${params.errorText}${params.blockedReason ? ` (${params.blockedReason})` : ''}`);
        break;
      default:
    }
  };

  const send = connect(child, onEvent);
  const started = Date.now();
  let probe = null;
  let timedOut = false;
  let screenshotPath = null;
  let evalResult = null;
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
    const call = (method, params) => send(method, params, sessionId);
    for (const domain of ['Runtime', 'Log', 'Network', 'Page']) await call(`${domain}.enable`);
    await call('Page.addScriptToEvaluateOnNewDocument', { source: VIOLATION_RECORDER });
    await call('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, deviceScaleFactor: 1, mobile: false });
    if (options.dark) {
      await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    }
    await call('Page.navigate', { url: pageUrl });

    const evaluate = async () => {
      const { result, exceptionDetails } = await call('Runtime.evaluate', { expression: PAGE_PROBE, returnByValue: true });
      return exceptionDetails ? null : JSON.parse(result.value);
    };
    while (Date.now() - started < READY_TIMEOUT_MS) {
      probe = await evaluate().catch(() => null);
      if (probe && probe.ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    timedOut = !(probe && probe.ready);
    if (!timedOut && options.eval) {
      const { result, exceptionDetails } = await call('Runtime.evaluate', { expression: options.eval, returnByValue: true, awaitPromise: true });
      evalResult = exceptionDetails ? { error: describeException(exceptionDetails) } : result.value;
      if (exceptionDetails) found.exceptions.push(describeException(exceptionDetails));
    }
    if (!timedOut) {
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      probe = (await evaluate()) || probe;
    }
    if (options.screenshot && !timedOut) {
      const { contentSize } = await call('Page.getLayoutMetrics');
      const height = Math.min(Math.max(Math.ceil(contentSize.height), options.height), MAX_SCREENSHOT_HEIGHT);
      const shot = await call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: options.width, height, scale: 1 },
      });
      screenshotPath = resolve(options.screenshot);
      writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
    }
  } finally {
    await send('Browser.close').catch(() => {});
    for (let waited = 0; !exited && waited < 3000; waited += 50) await new Promise((r) => setTimeout(r, 50));
    if (!exited) child.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true });
  }

  const violations = probe ? probe.violations : [];
  const inlineHandlers = probe ? probe.inlineHandlers : [];
  const errors = timedOut || (probe && probe.ready === 'error')
    || found.console.length + found.exceptions.length + found.log.length + found.requests.length
      + found.loadFailures.length + violations.length + inlineHandlers.length > 0;
  return {
    ok: !errors,
    html: htmlPath,
    width: options.width,
    height: options.height,
    dark: options.dark,
    ready: timedOut ? 'timeout' : probe.ready,
    elapsedMs: Date.now() - started,
    title: probe ? probe.title : null,
    counts: probe ? probe.counts : {},
    highlighted: probe ? probe.highlighted : [],
    highlightInView: probe ? probe.highlightInView : null,
    notice: probe ? probe.notice : null,
    codeLines: probe ? probe.codeLines : 0,
    horizontalOverflow: probe ? probe.scrollWidth > probe.innerWidth : null,
    bodyBackground: probe ? probe.bodyBackground : null,
    prefersDark: probe ? probe.prefersDark : null,
    consoleErrors: found.console,
    exceptions: found.exceptions,
    logErrors: found.log,
    cspViolations: violations,
    inlineHandlers,
    extraRequests: found.requests,
    loadFailures: found.loadFailures,
    evalResult,
    screenshot: screenshotPath,
  };
}

try {
  const result = await run(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  process.stderr.write(`view-smoke failed: ${error.message}\n`);
  process.exit(1);
}
