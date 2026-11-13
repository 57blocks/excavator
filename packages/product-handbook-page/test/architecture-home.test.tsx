// @vitest-environment happy-dom
// The system architecture on the technical home page and the full-screen diagram (openspec change handbook-page-reachability,
// step 2): no section on the product home page or when the text is empty, the Markdown and the heading links on the technical one,
// a heading link that opens the system chapter at that heading, and the dialog of a diagram (open, Escape, focus back, scroll lock).
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppView } from '../src/App';
import { parseHash } from '../src/lib/route';
import type { PageData } from '../src/lib/types';
import { cleanup, mount, settle } from './dom';
import { domainData } from './domains-fixture';
import { d, marked } from './page-fixture';

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaid }));

beforeEach(() => {
  window.location.hash = '';
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
  mermaid.render.mockImplementation(async (id: string) => ({ svg: `<svg data-id="${id}" viewBox="0 0 10 10"><text>drawn</text></svg>` }));
});
afterEach(() => { cleanup(); window.location.hash = ''; });

const ARCH = `Apps and stores.\n\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n\n| App | Use |\n| --- | --- |\n| Web | Orders |\n`;
const SYSTEM = `# ${d('System chapter')}\n\nIntro.\n\n## ${d('Applications')}\n\ntext\n\n### ${d('Detail')}\n\ntext\n\n## ${d('External systems')}\n\ntext\n`;

function withArchitecture(text = ARCH): PageData {
  const data = domainData();
  return {
    ...data,
    architecture: { product: text, technical: text },
    chapters: data.chapters.map((one) => (one.id === 'system' ? { id: 'system', texts: { product: SYSTEM, technical: SYSTEM } } : one)),
    search: [
      ...data.search.slice(0, 1),
      { kind: 'heading', title: d('Applications'), chapter: 'system', domain: null, heading: 0, level: 2 },
      { kind: 'heading', title: d('Detail'), chapter: 'system', domain: null, heading: 1, level: 3 },
      { kind: 'heading', title: d('External systems'), chapter: 'system', domain: null, heading: 2, level: 2 },
      ...data.search.slice(1),
    ],
  };
}
const open = async (data: PageData, hash: string): Promise<HTMLElement> => {
  const host = mount(<AppView data={data} route={parseHash(hash)} />);
  await settle();
  await settle();
  return host;
};
const section = (host: HTMLElement): HTMLElement | null => host.querySelector('[data-part="architecture"]');

describe('the architecture section of the home page', () => {
  it('is not on the product home page', async () => {
    expect(section(await open(withArchitecture(), '#/product'))).toBeNull();
  });

  it('is on the technical home page after the map and before the domain table, with its heading, Markdown and drawing', async () => {
    const host = await open(withArchitecture(), '#/technical');
    const arch = section(host) as HTMLElement;
    expect(arch).not.toBeNull();
    expect(arch.querySelector('h2')?.textContent).toBe(marked['page.home.architecture']);
    expect(arch.textContent).toContain('Apps and stores.');
    expect(arch.querySelector('table')).not.toBeNull();
    expect(arch.querySelectorAll('[data-diagram="done"] svg')).toHaveLength(1);
    const order = Array.from(host.querySelectorAll('.atlas-section, [data-part="architecture"], [data-part="domain-table"]')).map((el) => el.getAttribute('data-part') ?? 'atlas');
    expect(order).toEqual(['atlas', 'architecture', 'domain-table']);
  });

  it('is not shown when the text is empty', async () => {
    expect(section(await open(withArchitecture(''), '#/technical'))).toBeNull();
  });

  it('links each level-2 section of the system chapter and no level-3 one, under the fixed line', async () => {
    const arch = section(await open(withArchitecture(), '#/technical')) as HTMLElement;
    expect(arch.querySelector('.arch-more span')?.textContent).toBe(marked['page.home.architectureMore']);
    const links = Array.from(arch.querySelectorAll('.arch-more a'));
    expect(links.map((one) => one.textContent)).toEqual([d('Applications'), d('External systems')]);
    expect(links.map((one) => one.getAttribute('href'))).toEqual(['#/technical/chapter/system', '#/technical/chapter/system']);
  });

  it('a heading link opens the system chapter and focuses that heading', async () => {
    const data = withArchitecture();
    const host = await open(data, '#/technical');
    const proto = globalThis.HTMLElement.prototype as unknown as { scrollIntoView: (options?: unknown) => void };
    const saved = proto.scrollIntoView;
    proto.scrollIntoView = () => undefined;
    try {
      const link = host.querySelector('.arch-more a[data-heading="2"]') as HTMLElement;
      act(() => link.click());
      expect(window.location.hash).toBe('#/technical/chapter/system');
      // The route is a prop in this test: show the chapter page it leads to, and the jump finds its heading.
      await open(data, window.location.hash);
      await settle();
      expect(document.activeElement?.id).toBe('h-2');
      expect(document.activeElement?.textContent).toBe(d('External systems'));
    } finally {
      proto.scrollIntoView = saved;
    }
  });
});

describe('a diagram full screen', () => {
  const chapterWithDiagram = (): PageData => {
    const data = domainData();
    const text = `# ${d('Orders')}\n\nIntro.\n\n\`\`\`mermaid\nflowchart TD\n  A --> B\n\`\`\`\n`;
    return { ...data, chapters: data.chapters.map((one) => (one.id === 'F1' ? { id: 'F1', texts: { product: text, technical: text } } : one)) };
  };
  const key = (name: string): void => { act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })); }); };

  it('has a button at the diagram, the dialog shows the same drawing, Escape closes it and the focus goes back', async () => {
    const host = await open(chapterWithDiagram(), '#/product/chapter/F1');
    const button = host.querySelector('.diagram button.diagram-expand') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe(marked['page.diagram.expand']);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    act(() => button.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe(marked['page.diagram.expand']);
    expect(dialog.querySelector('.diagram-full svg')?.outerHTML).toBe(host.querySelector('.diagram-svg svg')?.outerHTML);
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe('hidden');
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe(marked['page.diagram.close']);
    key('Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(document.body.style.overflow).toBe('');
  });

  it('closes with its close button too', async () => {
    const host = await open(chapterWithDiagram(), '#/product/chapter/F1');
    const button = host.querySelector('.diagram-expand') as HTMLButtonElement;
    act(() => button.click());
    act(() => (document.querySelector('.diagram-close') as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
