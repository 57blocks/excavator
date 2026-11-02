/**
 * A small Chrome DevTools Protocol client for the page tests: find a Chrome,
 * start it headless with the DevTools pipe (no port, no WebSocket, no npm
 * dependency), open a page in a window of a given size, and give back what the
 * browser saw (requests, console errors) and a way to run script in it.
 * Messages on the pipe are JSON texts ended by a NUL byte.
 */

import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PATH_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

const runnable = (path) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** The Chrome to use: CHROME_PATH, the macOS application, then a name on PATH; null when there is none. */
export function findChrome() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && runnable(fromEnv)) return fromEnv;
  if (runnable(MAC_CHROME)) return MAC_CHROME;
  for (const name of PATH_NAMES) {
    const found = spawnSync('which', [name], { encoding: 'utf-8' });
    const path = found.status === 0 ? found.stdout.trim() : '';
    if (path !== '' && runnable(path)) return path;
  }
  return null;
}

/** A running headless Chrome. */
export class Browser {
  static async launch(executable) {
    const profile = mkdtempSync(join(tmpdir(), 'xhb-chrome-'));
    const args = [
      '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-extensions', '--disable-background-networking', 'about:blank',
    ];
    // A container runs Chrome as root, which refuses to start without this.
    if (process.env.CI || (typeof process.getuid === 'function' && process.getuid() === 0)) args.unshift('--no-sandbox');
    // Its own process group, so close() can stop Chrome's helper processes too.
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], detached: true });
    return new Browser(child, profile);
  }

  constructor(child, profile) {
    this.child = child;
    this.profile = profile;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.buffer = '';
    this.stderr = '';
    this.exited = false;
    child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    child.on('exit', () => {
      this.exited = true;
      for (const { reject } of this.pending.values()) reject(new Error(`Chrome exited: ${this.stderr.slice(-400)}`));
      this.pending.clear();
    });
    child.stdio[4].on('data', (chunk) => {
      this.buffer += chunk.toString('utf-8');
      let at = this.buffer.indexOf('\0');
      while (at !== -1) {
        const text = this.buffer.slice(0, at);
        this.buffer = this.buffer.slice(at + 1);
        this.dispatch(JSON.parse(text));
        at = this.buffer.indexOf('\0');
      }
    });
  }

  dispatch(message) {
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
    } else {
      for (const listener of this.listeners) listener(message);
    }
  }

  /** Send a command (optionally to a session) and wait for its result. */
  send(method, params = {}, sessionId = undefined) {
    if (this.exited) return Promise.reject(new Error(`Chrome is not running: ${this.stderr.slice(-400)}`));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      const message = { id, method, params, ...(sessionId ? { sessionId } : {}) };
      this.child.stdio[3].write(`${JSON.stringify(message)}\0`);
    });
  }

  /**
   * Open a page of `width` x `height` pixels. The window is not emulated as a
   * phone: a phone's layout viewport grows to fit overflowing content, which
   * would hide the horizontal overflow the tests look for.
   * The result records every request,
   * console error and uncaught exception the page raises from now on.
   */
  async openPage({ width, height, dark = false }) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId, targetId);
    await page.setup({ width, height, dark });
    return page;
  }

  // Killing only the browser process leaves its helper processes running, and
  // they keep writing into the profile, so removing it fails with ENOTEMPTY.
  // Ask Chrome to close (it stops its helpers), then kill the whole process
  // group for whatever is left, and only then remove the profile.
  async close() {
    const exited = new Promise((resolve) => {
      if (this.exited) resolve();
      else this.child.once('exit', resolve);
    });
    if (!this.exited) {
      this.send('Browser.close').catch(() => {});
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    try {
      process.kill(-this.child.pid, 'SIGKILL');
    } catch {
      // The group is already gone.
    }
    await exited;
    rmSync(this.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

export class Page {
  constructor(browser, sessionId, targetId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.requests = [];
    this.consoleErrors = [];
    this.loaded = null;
    browser.listeners.add((message) => {
      if (message.sessionId !== this.sessionId) return;
      this.onEvent(message.method, message.params);
    });
  }

  onEvent(method, params) {
    if (method === 'Network.requestWillBeSent') this.requests.push(params.request.url);
    else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') this.consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    else if (method === 'Runtime.exceptionThrown') this.consoleErrors.push(`uncaught: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
    else if (method === 'Log.entryAdded' && params.entry.level === 'error') this.consoleErrors.push(`${params.entry.source}: ${params.entry.text} ${params.entry.url ?? ''}`.trim());
    else if (method === 'Page.loadEventFired' && this.loaded) this.loaded();
  }

  send(method, params) {
    return this.browser.send(method, params, this.sessionId);
  }

  async setup({ width, height, dark }) {
    await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable'].map((method) => this.send(method)));
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  }

  /** Navigate to a URL and wait for its load event. */
  async goto(url) {
    const loaded = new Promise((resolve) => { this.loaded = resolve; });
    await this.send('Page.navigate', { url });
    await loaded;
    this.loaded = null;
  }

  /** Run an expression in the page and return its value (a promise is awaited). */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`in the page: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value;
  }

  /** Wait until `expression` is truthy in the page, polling; fails with `what` after `timeout` ms. */
  async waitFor(expression, what, timeout = 8000) {
    const start = Date.now();
    for (;;) {
      if (await this.evaluate(`Boolean(${expression})`)) return;
      if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** A PNG of the page as it is now, base64 (for looking at, not for asserting). */
  async screenshot({ fullPage = false } = {}) {
    if (fullPage) {
      const height = await this.evaluate('document.documentElement.scrollHeight');
      const width = await this.evaluate('window.innerWidth');
      await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    }
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    return data;
  }
}
