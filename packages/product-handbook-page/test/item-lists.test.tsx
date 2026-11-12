// O5 of openspec change handbook-page-layout: a collection with a free-text column renders as an item list (one
// block per item: the short attributes first, the body at the full width, the secondary text under it, the
// source locations collapsed at the end), a collection whose columns are all short values stays a table, a set
// of terms and definitions is a definition list, and counts are an inline strip of items, not cards.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Cell, TableScroll } from '../src/components/Tables';
import { DefinitionList, Definition, Item, ItemCollapse, ItemField, ItemList } from '../src/components/ui/ItemList';
import { StatChips, StatStrip } from '../src/components/ui/StatStrip';

const html = (node: React.ReactElement): string => renderToStaticMarkup(node);

describe('ItemList', () => {
  const list = html(
    <ItemList part="rules" label="Rules">
      <Item attrs={<span className="chip">P0</span>} note="because" extra={<ItemCollapse summary="Source locations"><code>a.js:1</code></ItemCollapse>}>
        <p>A long statement that needs the full width of the content.</p>
      </Item>
      <Item><p>Second</p></Item>
    </ItemList>,
  );

  it('is a list of blocks and not a table, one block per item', () => {
    expect(list).not.toContain('<table');
    expect(list).toContain('class="item-list"');
    expect(list).toContain('data-part="rules"');
    expect(list).toContain('aria-label="Rules"');
    expect(list.match(/<li class="item"/g)).toHaveLength(2);
  });

  it('writes the attributes first, then the body, then the secondary text, then the collapsed locations', () => {
    const first = list.slice(list.indexOf('<li'), list.indexOf('</li>'));
    const at = (needle: string): number => first.indexOf(needle);
    expect(at('class="item-attrs"')).toBeGreaterThanOrEqual(0);
    expect(at('class="item-attrs"')).toBeLessThan(at('class="item-body"'));
    expect(at('class="item-body"')).toBeLessThan(at('class="item-note'));
    expect(at('class="item-note')).toBeLessThan(at('class="item-extra"'));
    expect(first).toMatch(/<details[^>]*><summary>Source locations<\/summary>/);
  });

  it('leaves out the parts an item does not have', () => {
    const second = list.slice(list.lastIndexOf('<li'));
    expect(second).not.toContain('item-attrs');
    expect(second).not.toContain('item-note');
    expect(second).not.toContain('item-extra');
  });

  it('labels a field of the body', () => {
    expect(html(<ItemField label="Trigger">when it rains</ItemField>)).toBe('<div class="item-field"><span class="inline-label">Trigger</span> when it rains</div>');
  });
});

describe('DefinitionList', () => {
  it('is a definition list of terms and definitions', () => {
    const out = html(<DefinitionList part="states" label="States"><Definition term="Open">Can be edited</Definition></DefinitionList>);
    expect(out).toContain('<dl class="def-list" data-part="states" aria-label="States">');
    expect(out).toContain('<dt>Open</dt><dd>Can be edited</dd>');
    expect(out).not.toContain('<table');
  });
});

describe('a collection with only short values stays a table', () => {
  it('the table component still draws a table', () => {
    const out = html(<TableScroll label="Counts"><thead><tr><th scope="col">Name</th><th scope="col">Count</th></tr></thead><tbody><tr><Cell row>x</Cell><Cell col="short">3</Cell></tr></tbody></TableScroll>);
    expect(out).toContain('<table');
  });
});

describe('the counts', () => {
  const strip = html(<StatStrip part="stats" stats={[{ label: 'Findings', value: 4 }, { label: 'Merged', value: 2 }]} />);

  it('are inline items with the label and the value, not cards', () => {
    expect(strip).toContain('class="stat-strip"');
    expect(strip).toContain('data-part="stats"');
    expect(strip).not.toContain('stat-card');
    expect(strip).not.toContain('stat-grid');
    expect(strip).toContain('<dt>Findings</dt><dd>4</dd>');
    expect(strip.match(/data-part="stat"/g)).toHaveLength(2);
  });

  it('a breakdown is a run of small label-and-number chips with a title', () => {
    const chips = html(<StatChips part="by-level" title="By priority" stats={[{ label: 'P0', value: 1 }, { label: 'P1', value: 0 }]} />);
    expect(chips).toContain('data-part="by-level"');
    expect(chips).toContain('By priority');
    expect(chips.match(/class="stat-chip"/g)).toHaveLength(2);
    expect(chips).not.toContain('stat-card');
  });
});
