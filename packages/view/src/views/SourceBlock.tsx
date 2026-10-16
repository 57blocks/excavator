// Monospaced source with line numbers and highlighted evidence lines
// (artifact-view task 7.1), or the bake-recorded reason it is not embedded.
import type { SourceText } from '../model/source-text';
import { fmtNumber } from '../format';

/** Lines rendered at most per block (an excerpt can be a whole class). */
export const MAX_SOURCE_LINES = 500;

export function SourceBlock({ source, startLine, highlight, compact = false }: { source: SourceText; startLine: number; highlight?: ReadonlySet<number>; compact?: boolean }) {
  if (source.state === 'not-embedded') {
    return compact ? (
      <span className="source-missing" data-source="not-embedded" data-source-reason={source.reason} title={source.message}>
        Source not embedded
      </span>
    ) : (
      <p className="source-missing" data-source="not-embedded" data-source-reason={source.reason}>
        {source.message}
      </p>
    );
  }
  const lines = source.text.split('\n');
  const shown = lines.slice(0, MAX_SOURCE_LINES);
  const highlighted = shown.filter((_, i) => highlight?.has(startLine + i)).length;
  return (
    <pre className={`code${compact ? ' code-compact' : ''}`} data-source="embedded" data-source-lines={lines.length} data-highlighted={highlighted}>
      {shown.map((text, i) => {
        const n = startLine + i;
        const hot = highlight?.has(n) ?? false;
        return (
          <span key={i} className="code-line" data-line={n} data-highlight={hot ? 'true' : undefined}>
            <span className="ln">{n >= 0 ? n : ''}</span>
            <span className="lt">{text === '' ? ' ' : text}</span>
            {'\n'}
          </span>
        );
      })}
      {lines.length > shown.length && <span className="muted">… {fmtNumber(lines.length - shown.length)} more lines</span>}
    </pre>
  );
}
