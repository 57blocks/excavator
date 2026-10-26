import { useEffect, useState } from 'react';

import { useDarkMode } from '../lib/dark-mode';

type Rendered = { state: 'pending' } | { state: 'done'; svg: string } | { state: 'failed'; reason: string };

/** Mermaid renders one diagram at a time: it builds each in a shared scratch element. */
let queue: Promise<unknown> = Promise.resolve();

async function renderMermaid(id: string, source: string, dark: boolean): Promise<string> {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
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
