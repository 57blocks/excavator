import { useEffect, useState } from 'react';

import { useDarkMode } from '../lib/dark-mode';

type Rendered = { state: 'pending' } | { state: 'done'; svg: string } | { state: 'failed'; reason: string };

/** Mermaid renders one diagram at a time: it builds each in a shared scratch element. */
let queue: Promise<unknown> = Promise.resolve();

/** The violet palette for mermaid's `base` theme, one set per page theme; the diagram box behind it is the page's elevated surface. */
function themeVariables(dark: boolean): Record<string, string | boolean> {
  return dark
    ? {
        darkMode: true, background: '#1c1c21', fontFamily: 'Inter, system-ui, sans-serif',
        primaryColor: '#2b2557', primaryTextColor: '#f3f3f5', primaryBorderColor: '#7c5cff',
        secondaryColor: '#17171b', secondaryTextColor: '#f3f3f5', secondaryBorderColor: '#6c6c73',
        tertiaryColor: '#131316', tertiaryTextColor: '#f3f3f5', tertiaryBorderColor: '#6c6c73',
        lineColor: '#a3a3ad', textColor: '#f3f3f5', mainBkg: '#2b2557', nodeBorder: '#7c5cff',
        clusterBkg: '#131316', clusterBorder: '#6c6c73', titleColor: '#f3f3f5',
        edgeLabelBackground: '#1c1c21', noteBkgColor: '#2b2557', noteTextColor: '#f3f3f5', noteBorderColor: '#7c5cff',
        actorBkg: '#2b2557', actorBorder: '#7c5cff', actorTextColor: '#f3f3f5', actorLineColor: '#a3a3ad',
        signalColor: '#a3a3ad', signalTextColor: '#f3f3f5', labelBoxBkgColor: '#17171b', labelBoxBorderColor: '#7c5cff',
        labelTextColor: '#f3f3f5', loopTextColor: '#f3f3f5', activationBkgColor: '#2b2557', activationBorderColor: '#7c5cff',
        sequenceNumberColor: '#0c0c0e',
      }
    : {
        darkMode: false, background: '#ffffff', fontFamily: 'Inter, system-ui, sans-serif',
        primaryColor: '#e6e1ff', primaryTextColor: '#0c0c0e', primaryBorderColor: '#6a4dff',
        secondaryColor: '#f4f4f6', secondaryTextColor: '#0c0c0e', secondaryBorderColor: '#6c6c73',
        tertiaryColor: '#e2e2e6', tertiaryTextColor: '#0c0c0e', tertiaryBorderColor: '#6c6c73',
        lineColor: '#4a4a52', textColor: '#0c0c0e', mainBkg: '#e6e1ff', nodeBorder: '#6a4dff',
        clusterBkg: '#f4f4f6', clusterBorder: '#6c6c73', titleColor: '#0c0c0e',
        edgeLabelBackground: '#ffffff', noteBkgColor: '#e6e1ff', noteTextColor: '#0c0c0e', noteBorderColor: '#6a4dff',
        actorBkg: '#e6e1ff', actorBorder: '#6a4dff', actorTextColor: '#0c0c0e', actorLineColor: '#4a4a52',
        signalColor: '#4a4a52', signalTextColor: '#0c0c0e', labelBoxBkgColor: '#f4f4f6', labelBoxBorderColor: '#6a4dff',
        labelTextColor: '#0c0c0e', loopTextColor: '#0c0c0e', activationBkgColor: '#e6e1ff', activationBorderColor: '#6a4dff',
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
    fontFamily: 'Inter, system-ui, sans-serif',
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
 * One mermaid block, rendered with `mermaid.render` (design D4). When the
 * render throws, the source stays visible under a "Diagram failed to render"
 * label: a bad diagram is never a blank space.
 */
export function Diagram({ id, source }: { id: string; source: string }) {
  const dark = useDarkMode();
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
      <div className="diagram-failed" role="group" aria-label="Diagram failed to render" data-diagram="failed">
        <div className="label">Diagram failed to render</div>
        <div className="reason">{rendered.reason.split('\n')[0]}</div>
        <pre><code>{source}</code></pre>
      </div>
    );
  }
  if (rendered.state === 'pending') return <div className="diagram diagram-pending" data-diagram="pending">Rendering diagram...</div>;
  return <div className="diagram" data-diagram="done" role="img" aria-label="Diagram" dangerouslySetInnerHTML={{ __html: rendered.svg }} />;
}
