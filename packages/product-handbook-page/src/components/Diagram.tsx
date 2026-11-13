import { useEffect, useState } from 'react';

import { useDarkMode } from '../lib/dark-mode';
import { useText } from '../lib/text';

type Rendered = { state: 'pending' } | { state: 'done'; svg: string } | { state: 'failed'; reason: string };

/** Mermaid renders one diagram at a time: it builds each in a shared scratch element. */
let queue: Promise<unknown> = Promise.resolve();

/** The page's own font family (the same list as --font-sans in index.css), so a CJK label is drawn in a CJK face. */
const FONT_FAMILY = "'Inter', system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans', 'Noto Sans CJK SC', 'Noto Sans CJK JP', 'Noto Sans CJK KR', 'Microsoft YaHei', 'Malgun Gothic', 'Noto Sans', 'Helvetica Neue', Arial, sans-serif";

/** The teal palette for mermaid's `base` theme, one set per page theme; the diagram box behind it is the page's surface. */
export function themeVariables(dark: boolean): Record<string, string | boolean> {
  return dark
    ? {
        darkMode: true, background: '#141d20', fontFamily: FONT_FAMILY,
        primaryColor: '#1f3a3e', primaryTextColor: '#e8eff1', primaryBorderColor: '#5fb4bc',
        secondaryColor: '#1b2629', secondaryTextColor: '#e8eff1', secondaryBorderColor: '#364850',
        tertiaryColor: '#0d1517', tertiaryTextColor: '#e8eff1', tertiaryBorderColor: '#364850',
        lineColor: '#93a3a9', textColor: '#e8eff1', mainBkg: '#1f3a3e', nodeBorder: '#5fb4bc',
        clusterBkg: '#0d1517', clusterBorder: '#364850', titleColor: '#e8eff1',
        edgeLabelBackground: '#141d20', noteBkgColor: '#1f3a3e', noteTextColor: '#e8eff1', noteBorderColor: '#5fb4bc',
        actorBkg: '#1f3a3e', actorBorder: '#5fb4bc', actorTextColor: '#e8eff1', actorLineColor: '#93a3a9',
        signalColor: '#93a3a9', signalTextColor: '#e8eff1', labelBoxBkgColor: '#1b2629', labelBoxBorderColor: '#5fb4bc',
        labelTextColor: '#e8eff1', loopTextColor: '#e8eff1', activationBkgColor: '#1f3a3e', activationBorderColor: '#5fb4bc',
        sequenceNumberColor: '#0d1517',
      }
    : {
        darkMode: false, background: '#ffffff', fontFamily: FONT_FAMILY,
        primaryColor: '#dcebec', primaryTextColor: '#142126', primaryBorderColor: '#1d5c63',
        secondaryColor: '#eaf0f1', secondaryTextColor: '#142126', secondaryBorderColor: '#bccacf',
        tertiaryColor: '#f3f5f6', tertiaryTextColor: '#142126', tertiaryBorderColor: '#bccacf',
        lineColor: '#44555b', textColor: '#142126', mainBkg: '#dcebec', nodeBorder: '#1d5c63',
        clusterBkg: '#f3f5f6', clusterBorder: '#bccacf', titleColor: '#142126',
        edgeLabelBackground: '#ffffff', noteBkgColor: '#dcebec', noteTextColor: '#142126', noteBorderColor: '#1d5c63',
        actorBkg: '#dcebec', actorBorder: '#1d5c63', actorTextColor: '#142126', actorLineColor: '#44555b',
        signalColor: '#44555b', signalTextColor: '#142126', labelBoxBkgColor: '#eaf0f1', labelBoxBorderColor: '#1d5c63',
        labelTextColor: '#142126', loopTextColor: '#142126', activationBkgColor: '#dcebec', activationBorderColor: '#1d5c63',
        sequenceNumberColor: '#ffffff',
      };
}

async function renderMermaid(id: string, source: string, dark: boolean): Promise<string> {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: themeVariables(dark),
    suppressErrorRendering: true,
    fontFamily: FONT_FAMILY,
  });
  try {
    return (await mermaid.render(id, source)).svg;
  } finally {
    // A failed render can leave its scratch element in the body.
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
  }
}

function enqueue(id: string, source: string, dark: boolean): Promise<string> {
  const run = queue.then(() => renderMermaid(id, source, dark));
  queue = run.catch(() => undefined);
  return run;
}

/**
 * One mermaid block, rendered with `mermaid.render`. When the render throws, the source stays visible as text under
 * the fixed note: a bad diagram is never a blank space and never breaks the page.
 */
export function Diagram({ id, source }: { id: string; source: string }) {
  const dark = useDarkMode();
  const t = useText();
  const [rendered, setRendered] = useState<Rendered>({ state: 'pending' });

  useEffect(() => {
    let cancelled = false;
    setRendered({ state: 'pending' });
    enqueue(id, source, dark).then(
      (svg) => { if (!cancelled) setRendered({ state: 'done', svg }); },
      (error: unknown) => { if (!cancelled) setRendered({ state: 'failed', reason: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { cancelled = true; };
  }, [id, source, dark]);

  if (rendered.state === 'failed') {
    return (
      <div className="diagram-failed" data-diagram="failed">
        <p className="muted">{t('page.diagram.failed')}</p>
        <pre><code>{source}</code></pre>
      </div>
    );
  }
  if (rendered.state === 'pending') return <div className="diagram diagram-pending" data-diagram="pending" aria-busy="true" />;
  return <div className="diagram" data-diagram="done" dangerouslySetInnerHTML={{ __html: rendered.svg }} />;
}
