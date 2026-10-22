import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { OverlayToggles } from '../src/components/shell/OverlayToggles';
import type { Manifest } from '../src/data/manifest';
import { PayloadReader } from '../src/data/payload';
import { GraphUiProvider } from '../src/state/graph-ui';
import { ViewerProvider } from '../src/state/viewer';

const product = (name: string, label: string, status: string) => ({ name, label, status, payloads: [name] });
const render = (statuses: Record<string, string>) => {
  const manifest = {
    products: [
      product('hotspots', 'Hotspots', statuses.hotspots),
      product('unused-code', 'Unused code', statuses['unused-code']),
      product('doc-map', 'Doc map', statuses['doc-map']),
    ],
  } as unknown as Manifest;
  return renderToStaticMarkup(
    <ViewerProvider manifest={manifest} payloads={new PayloadReader({ getElementById: () => null })}>
      <GraphUiProvider><OverlayToggles /></GraphUiProvider>
    </ViewerProvider>,
  );
};
const button = (html: string, name: string) => new RegExp(`<button[^>]*data-xv-overlay="${name}"[^>]*>[\\s\\S]*?</button>`).exec(html)?.[0] ?? '';

describe('the overlay switches', () => {
  it('enables the overlays whose products are in the page', () => {
    const html = render({ hotspots: 'included', 'unused-code': 'different-revision', 'doc-map': 'included' });
    for (const name of ['hotspots', 'unused', 'doc-map']) {
      expect(button(html, name), name).not.toContain(' disabled=""');
      expect(button(html, name), name).toContain('aria-pressed="false"');
    }
  });

  it('disables the overlay of a product that was not run, and says not run on it', () => {
    const html = render({ hotspots: 'included', 'unused-code': 'included', 'doc-map': 'not-run' });
    const docMap = button(html, 'doc-map');
    expect(docMap).toContain(' disabled=""');
    expect(docMap).toContain('not run');
    expect(docMap).toContain('Doc map: not run');
    expect(button(html, 'hotspots')).not.toContain(' disabled=""');
  });

  it('disables the overlay of a product that cannot be read, and says so', () => {
    const html = render({ hotspots: 'unreadable', 'unused-code': 'included', 'doc-map': 'included' });
    expect(button(html, 'hotspots')).toContain(' disabled=""');
    expect(button(html, 'hotspots')).toContain('unreadable');
  });

  it('has one switch for each overlay', () => {
    const html = render({ hotspots: 'included', 'unused-code': 'included', 'doc-map': 'included' });
    expect([...html.matchAll(/data-xv-overlay="([^"]+)"/g)].map((m) => m[1])).toEqual(['hotspots', 'unused', 'doc-map']);
  });
});
