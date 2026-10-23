import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The components read the reduced-motion setting through motion's hook; the test sets it.
const motionSetting = vi.hoisted(() => ({ reduce: false }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => motionSetting.reduce,
}));

const { AreaSpark } = await import('../src/components/ui/AreaSpark');
const { BarList } = await import('../src/components/ui/BarList');
const { Histogram } = await import('../src/components/ui/Histogram');
const { PageHeader } = await import('../src/components/ui/PageHeader');
const { StatTile } = await import('../src/components/ui/StatTile');
const { RowFields } = await import('../src/components/ui/RowPanel');

afterEach(() => {
  motionSetting.reduce = false;
});

const bars = (html: string) => Object.fromEntries([...html.matchAll(/<rect[^>]*data-xv-bar="([^"]+)"[^>]*>/g)].map((m) => [m[1], /\swidth="([^"]+)"/.exec(m[0])?.[1]]));
const binCounts = (html: string) => [...html.matchAll(/data-xv-bin-count="(\d+)"/g)].map((m) => Number(m[1]));
const binHeights = (html: string) => [...html.matchAll(/<rect[^>]*data-xv-bin="\d+"[^>]*>/g)].map((m) => Number(/\sheight="([^"]+)"/.exec(m[0])?.[1]));

/** Every mark of an entry that has not run: a bar or column scaled to 0, a shape at opacity 0, a line not yet drawn. */
const UNSTARTED = /scale[XY]\(0\)|opacity="0"|opacity:0[;"]|stroke-dasharray="0 1"/;
/** Any animation or transition written on an element. */
const MOVING = /(animation|transition)\s*:/;

const rows = [
  { key: 'a', label: 'Alpha', value: 40 },
  { key: 'b', label: 'Beta', value: 10 },
  { key: 'c', label: 'Gamma', value: 0 },
  { key: 'd', label: 'Delta', value: 20 },
];

describe('BarList', () => {
  it('draws each bar as long as its value over the largest: the largest is the whole track, 0 is no bar', () => {
    const html = renderToStaticMarkup(<BarList rows={rows} label="Rows" />);
    expect(bars(html)).toEqual({ a: '100%', b: '25%', c: '0%', d: '50%' });
    for (const row of rows) expect(html).toContain(`title="${row.label}"`);
    expect(html).toContain('>40<');
  });

  it('makes each row a button when it can be selected', () => {
    expect(renderToStaticMarkup(<BarList rows={rows} label="Rows" onSelect={() => undefined} />).match(/<button/g)).toHaveLength(rows.length);
  });

  it('grows the bars from 0 on entry, and with reduced motion draws them at their length with nothing moving', () => {
    const moving = renderToStaticMarkup(<BarList rows={rows} label="Rows" />);
    expect(moving).toMatch(/scaleX\(0\)/);
    motionSetting.reduce = true;
    const still = renderToStaticMarkup(<BarList rows={rows} label="Rows" />);
    expect(still).not.toMatch(UNSTARTED);
    expect(still).not.toMatch(MOVING);
    expect(bars(still)).toEqual(bars(moving));
  });
});

describe('Histogram', () => {
  const values = [0.05, 0.1, 0.3, 0.55, 0.6, 0.7, 0.9, 1, 1.4];
  const edges = [0, 0.25, 0.5, 0.75, 1];

  it('counts the values into the bins it is given and draws each column as tall as its count over the largest', () => {
    const html = renderToStaticMarkup(<Histogram values={values} edges={edges} label="Scores" format={(v) => v.toFixed(2)} />);
    expect(binCounts(html)).toEqual([2, 1, 3, 2]);
    expect(binHeights(html)).toEqual([48, 24, 72, 48]);
    expect(html).toContain('1 outside the bins');
    expect(html).toContain('0.25 to 0.50: 1');
  });

  it('grows the columns on entry, and with reduced motion draws them at their height with nothing moving', () => {
    expect(renderToStaticMarkup(<Histogram values={values} edges={edges} label="Scores" />)).toMatch(/scaleY\(0\)/);
    motionSetting.reduce = true;
    const still = renderToStaticMarkup(<Histogram values={values} edges={edges} label="Scores" />);
    expect(still).not.toMatch(UNSTARTED);
    expect(still).not.toMatch(MOVING);
    expect(binHeights(still)).toEqual([48, 24, 72, 48]);
  });
});

describe('AreaSpark', () => {
  const points = [
    { label: '2021', value: 3 },
    { label: '2022', value: 9 },
    { label: '2023', value: 0 },
    { label: '2024', value: 6 },
  ];

  it('draws a dot on every point and runs the line and the area through all of them', () => {
    const html = renderToStaticMarkup(<AreaSpark points={points} label="Commits by year" />);
    const dots = [...html.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => `${m[1]},${m[2]}`);
    expect(dots).toHaveLength(points.length);
    const line = /data-xv-area-line=""[^>]*\sd="([^"]+)"|\sd="([^"]+)"[^>]*data-xv-area-line=""/.exec(html);
    const area = /data-xv-area-fill=""[^>]*\sd="([^"]+)"|\sd="([^"]+)"[^>]*data-xv-area-fill=""/.exec(html);
    const lineD = line?.[1] ?? line?.[2] ?? '';
    const areaD = area?.[1] ?? area?.[2] ?? '';
    for (const dot of dots) {
      expect(lineD).toContain(dot);
      expect(areaD).toContain(dot);
    }
    expect(html).toContain('2021: 3, 2022: 9, 2023: 0, 2024: 6');
    expect(html).toContain('>2021<');
    expect(html).toContain('>2024<');
  });

  it('fades the area in and draws the line on entry, and with reduced motion draws both at once with nothing moving', () => {
    const moving = renderToStaticMarkup(<AreaSpark points={points} label="Commits by year" />);
    expect(moving).toMatch(/opacity="0"/);
    expect(moving).toMatch(/stroke-dasharray="0 1"/);
    motionSetting.reduce = true;
    const still = renderToStaticMarkup(<AreaSpark points={points} label="Commits by year" />);
    expect(still).not.toMatch(UNSTARTED);
    expect(still).not.toMatch(MOVING);
  });

  it('says so when there is nothing to draw', () => {
    expect(renderToStaticMarkup(<AreaSpark points={[]} label="Commits by year" />)).toContain('No values to draw.');
  });
});

describe('PageHeader and StatTile', () => {
  it('heads a page with its title, its line, the product state and the snapshot cut short', () => {
    const html = renderToStaticMarkup(<PageHeader title="Unused code" description="Functions no route reaches." status="included" revision="0123456789abcdef0123" />);
    expect(html).toMatch(/<h1[^>]*>Unused code<\/h1>/);
    expect(html).toContain('Functions no route reaches.');
    expect(html).toContain('>Included<');
    expect(html).toContain('<code>01234567</code>');
    expect(html).toContain('title="0123456789abcdef0123"');
  });

  it('leaves the state and the snapshot out when it has none', () => {
    const html = renderToStaticMarkup(<PageHeader title="Reports" />);
    expect(html).not.toContain('Snapshot');
    expect(html).not.toContain('<p');
  });

  it('shows the label above the number and the line below, and the number at once with reduced motion', () => {
    motionSetting.reduce = true;
    const html = renderToStaticMarkup(<StatTile label="Unreferenced" value={1234} note="no reference at all" />);
    expect(html.indexOf('Unreferenced')).toBeLessThan(html.indexOf('1,234'));
    expect(html.indexOf('1,234')).toBeLessThan(html.indexOf('no reference at all'));
    expect(html).toContain('data-xv-stat-value="1234"');
    expect(html).not.toMatch(UNSTARTED);
  });

  it('shows the empty mark for a value that is not a number', () => {
    expect(renderToStaticMarkup(<StatTile label="Score" value={null} />)).toContain(String.fromCharCode(0x2014));
  });
});

describe('RowFields', () => {
  it('lists the fields that have a value and leaves out the empty ones', () => {
    const html = renderToStaticMarkup(<RowFields fields={[{ label: 'Reason', value: 'unreferenced' }, { label: 'Group', value: null }, { label: 'Note', value: '' }]} />);
    expect(html).toContain('<dt class="text-muted">Reason</dt>');
    expect(html).not.toContain('Group');
    expect(html).not.toContain('Note');
  });
});
