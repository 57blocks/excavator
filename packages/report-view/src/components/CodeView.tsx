import { Highlight, type PrismTheme } from 'prism-react-renderer';
import { useEffect, useMemo, useRef } from 'react';

import { formatNumber } from '../lib/format';
import { splitLines, type LineStatus } from '../lib/code';
import { languageOf, MAX_HIGHLIGHTED_LINES } from '../lib/syntax';

/** Token colours: the page's ink, with the node kinds' colours (each at least 3:1 on white) for the code. */
const THEME: PrismTheme = {
  plain: { color: '#26262b', backgroundColor: 'transparent' },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: '#6c6c73', fontStyle: 'italic' } },
    { types: ['keyword', 'atrule', 'selector', 'tag'], style: { color: '#6a4dff' } },
    { types: ['string', 'char', 'attr-value', 'inserted'], style: { color: '#25984d' } },
    { types: ['number', 'boolean', 'constant', 'symbol'], style: { color: '#d25030' } },
    { types: ['function', 'class-name', 'builtin'], style: { color: '#0090c3' } },
    { types: ['operator', 'punctuation'], style: { color: '#6c6c73' } },
    { types: ['regex', 'important', 'variable'], style: { color: '#b46e00' } },
  ],
};

/**
 * The source of one file with line numbers and, when `status` is a valid range
 * inside the file, the lines of it marked and scrolled into view. The marks are
 * the `.xv-line-hl` lines and the `data-xv-highlight` attribute the smoke and
 * acceptance scripts read. Every line is text; nothing is parsed as markup.
 */
export function CodeView({ path, text, status }: { path: string; text: string; status: LineStatus }) {
  const lines = useMemo(() => splitLines(text), [text]);
  const language = languageOf(path);
  const colour = language !== null && lines.length <= MAX_HIGHLIGHTED_LINES;
  const first = useRef<HTMLDivElement | null>(null);
  const start = status.state === 'ok' ? status.start : null;

  useEffect(() => {
    first.current?.scrollIntoView({ block: 'center' });
  }, [path, start]);

  const marked = (n: number) => status.state === 'ok' && n >= status.start && n <= status.end;
  const row = (index: number, content: React.ReactNode) => {
    const n = index + 1;
    return (
      <div key={n} ref={status.state === 'ok' && n === status.start ? first : undefined} className={marked(n) ? 'xv-line xv-line-hl' : 'xv-line'} data-n={n}>
        {content}
      </div>
    );
  };

  return (
    <>
      {language !== null && !colour ? <p className="px-4 py-2 text-muted">{`Syntax colours are off for files over ${formatNumber(MAX_HIGHLIGHTED_LINES)} lines.`}</p> : null}
      <div
        className="xv-code"
        role="region"
        aria-label={`Source of ${path}`}
        tabIndex={0}
        data-xv-highlight={status.state === 'ok' ? `${status.start}-${status.end}` : undefined}
      >
        {colour ? (
          <Highlight theme={THEME} code={lines.join('\n')} language={language}>
            {({ tokens, getTokenProps }) =>
              lines.map((_line, index) => row(index, (tokens[index] ?? []).map((token, i) => <span key={i} {...getTokenProps({ token })} />)))
            }
          </Highlight>
        ) : (
          lines.map((line, index) => row(index, line))
        )}
      </div>
    </>
  );
}
