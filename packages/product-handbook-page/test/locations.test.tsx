// O1 of openspec change handbook-page-layout: the source locations are one
// component (grouped by item, collapsed, merged per file, breakable paths),
// and the rail is one scroll container.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Chips, Locations, mergePlaces, splitClaim } from '../src/components/Locations';
import { TextContext, makeText } from '../src/lib/text';
import type { UnitLocations } from '../src/lib/types';

const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url)), 'utf-8')) as { strings: Record<string, string> };
const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf-8');
const html = (node: React.ReactNode): string => renderToStaticMarkup(<TextContext.Provider value={makeText(shipped.strings)}>{node}</TextContext.Provider>);

const unit: UnitLocations = {
  id: 'F1',
  items: [
    { claim: 'Fields > Order screen > Total: must be positive', citations: [
      { file: 'src/orders/handler.js', startLine: 12, endLine: 12 },
      { file: 'src/orders/handler.js', startLine: 40, endLine: 45 },
      { file: 'src/lib/money.js', startLine: 3, endLine: 3 },
    ] },
    { claim: 'Plain claim without a path', citations: [{ file: 'src/x.js', startLine: null, endLine: null }] },
  ],
};

describe('source locations', () => {
  it('splits a joined claim on the fixed separator and falls back to the whole string', () => {
    expect(splitClaim('Fields > Order screen > Total: must be positive')).toEqual({ path: 'Fields > Order screen', claim: 'Total: must be positive' });
    expect(splitClaim('Plain claim')).toEqual({ path: null, claim: 'Plain claim' });
  });

  it('merges the places of one file into one entry, in order of first appearance', () => {
    expect(mergePlaces(unit.items[0].citations)).toEqual([
      { file: 'src/orders/handler.js', spans: ['12', '40-45'], unlocated: false },
      { file: 'src/lib/money.js', spans: ['3'], unlocated: false },
    ]);
  });

  it('is a details element, collapsed by default, whose summary counts the items and the citations', () => {
    const out = html(<Locations unit={unit} />);
    expect(out).toMatch(/<details class="loc-details" data-part="locations-details"><summary>/);
    expect(out).not.toContain('<details open');
    expect(out).toContain('2 items, 4 citations');
  });

  it('shows the path, the claim and one code chip for each file, with the places of a file merged', () => {
    const out = html(<Locations unit={unit} />);
    expect(out).toContain('Fields &gt; Order screen');
    expect(out).toContain('Total: must be positive');
    expect(out).toContain('<code class="loc-chip">src/<wbr/>orders/<wbr/>handler.js: 12, 40-45</code>');
    expect(out).toContain('<code class="loc-chip">src/<wbr/>lib/<wbr/>money.js:3</code>');
    expect(out.match(/handler\.js/g)).toHaveLength(1);
  });

  it('writes a range as file:start-end and keeps an unlocated file visible', () => {
    const out = html(<Chips citations={[{ file: 'a/b.js', startLine: 5, endLine: 9 }, { file: 'c.js', startLine: null, endLine: null }]} />);
    expect(out).toContain('a/<wbr/>b.js:5-9');
    expect(out).toContain('c.js, lines not located');
  });
});

describe('the stylesheet', () => {
  const rule = (selector: string): string => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.\\[\]="]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  it('makes .rail-scroll the only scrolling container of the rail', () => {
    expect(rule('.rail-scroll')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.rail')).not.toMatch(/overflow(-y)?:\s*(auto|scroll)/);
    expect(rule('.rail-top')).not.toMatch(/overflow/);
    expect(rule('.rail-key')).not.toMatch(/overflow/);
  });
  it('gives text columns a minimum width and short-value columns no wrapping', () => {
    expect(css).toMatch(/\[data-col="text"\][^{]*\{[^}]*min-width:\s*16em/);
    expect(css).toMatch(/\[data-col="short"\][^{]*\{[^}]*white-space:\s*nowrap/);
  });
});
