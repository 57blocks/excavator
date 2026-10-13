// artifact-view task 4.4: the smoke instrument's own parsing and Chrome
// discovery, without launching Chrome.
import { describe, expect, it } from 'vitest';

import { findChrome, rootAttributes, verdict } from '../../scripts/view-smoke.mjs';

describe('view-smoke parsing', () => {
  const ready = '<html><body><div id="root" data-excavator-view="ready" data-errors="0" data-csp-violations="0" '
    + 'data-nodes="9" data-edges="11" data-evidence="11" data-gaps="2" data-header-nodes="9" data-header-edges="11" '
    + 'data-header-gaps="2" data-decode-ms="12" data-ready-ms="80" data-route="overview" data-reduced-motion="false" '
    + 'data-decode-mode="worker"></div></body></html>';

  it('reads the root attributes into a green verdict', () => {
    const v = verdict(rootAttributes(ready));
    expect(v).toMatchObject({ ok: true, ready: true, errors: 0, cspViolations: 0, countsMatchHeader: true, decodeMs: 12, readyMs: 80 });
  });

  it('goes red on errors, CSP violations, count mismatch, a non-ready state or missing attributes', () => {
    expect(verdict(rootAttributes(ready.replace('data-errors="0"', 'data-errors="1"'))).ok).toBe(false);
    expect(verdict(rootAttributes(ready.replace('data-csp-violations="0"', 'data-csp-violations="2"'))).ok).toBe(false);
    expect(verdict(rootAttributes(ready.replace('data-nodes="9"', 'data-nodes="8"'))).ok).toBe(false);
    expect(verdict(rootAttributes(ready.replace('="ready"', '="loading"'))).ok).toBe(false);
    // An attribute the page never wrote is not "zero errors".
    const noCounter = verdict(rootAttributes(ready.replace(' data-errors="0"', '')));
    expect(noCounter.errors).toBeNull();
    expect(noCounter.ok).toBe(false);
    expect(verdict(rootAttributes('<html></html>')).ok).toBe(false);
  });

  it('decodes entities in attribute values', () => {
    expect(rootAttributes('<div id="root" data-error="A &amp; &quot;B&quot;">')['data-error']).toBe('A & "B"');
  });
});

describe('Chrome discovery', () => {
  it('prefers EXCAVATOR_CHROME', () => {
    expect(findChrome({ env: { EXCAVATOR_CHROME: process.execPath, PATH: '' }, platform: 'linux' })).toEqual({ path: process.execPath, source: 'EXCAVATOR_CHROME' });
  });

  it('reports a non-executable EXCAVATOR_CHROME instead of falling through', () => {
    const found = findChrome({ env: { EXCAVATOR_CHROME: '/nonexistent/chrome', PATH: '' }, platform: 'darwin' });
    expect(found.path).toBeNull();
    expect(found.reason).toMatch(/EXCAVATOR_CHROME/);
  });

  it('returns a reason when nothing is found', () => {
    const found = findChrome({ env: { PATH: '' }, platform: 'linux' });
    expect(found.path).toBeNull();
    expect(found.reason).toMatch(/no Chrome found/);
  });
});

