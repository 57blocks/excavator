import { useMemo } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';

import { remarkPlugins } from '../lib/markdown-config';
import { useText } from '../lib/text';
import { Citation, parseCitation } from './Citation';
import { Diagram } from './Diagram';
import { InfoIcon } from './Icons';

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
  position?: { start: { line: number } };
}

const textOf = (node: HastNode): string => (node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(textOf).join(''));

/** The line of each ```mermaid fence in `source`, in order: a block's index is its place in this list. */
export function mermaidFenceLines(source: string): number[] {
  const lines: number[] = [];
  source.split('\n').forEach((line, at) => {
    if (/^[ \t>]*(?:[-*+][ \t]+)?(?:```|~~~)mermaid[ \t]*$/.test(line)) lines.push(at + 1);
  });
  return lines;
}

/** The line of the first level-2 heading of `source` (outside fences), or Infinity when it has none. */
export function firstH2Line(source: string): number {
  let fence: string | null = null;
  const lines = source.split('\n');
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at];
    const opened = /^ {0,3}(```|~~~)/.exec(line);
    if (opened !== null) {
      if (fence === null) fence = opened[1];
      else if (opened[1] === fence) fence = null;
      continue;
    }
    if (fence === null && /^ {0,3}##(?!#)(?:[ \t]|$)/.test(line)) return at + 1;
  }
  return Number.POSITIVE_INFINITY;
}

/** The code element of a `pre` node, with its language class, or undefined. */
function codeOf(node: HastNode | undefined): HastNode | undefined {
  return node?.children?.find((child) => child.type === 'element' && child.tagName === 'code');
}

/**
 * Markdown as the page shows it: GitHub tables in a horizontal scroller, mermaid blocks as diagrams (a source that
 * does not render stays visible with a note), and an inline code span that is a whole citation (`path:12` or
 * `path:12-20`) as a citation chip. Raw HTML is not rendered. `idPrefix` makes the ids of the diagrams unique.
 */
export function Markdown({ source, idPrefix }: { source: string; idPrefix: string }) {
  const t = useText();
  const notVerified = t('chapter.notVerified');
  const notPassed = t('chapter.notPassed');
  const components = useMemo<Components>(() => {
    const fences = mermaidFenceLines(source);
    const firstH2 = firstH2Line(source);
    // A missing key reads as the key itself (see makeText): then nothing matches.
    const notPassedPrefix = notPassed.includes('{') ? notPassed.slice(0, notPassed.indexOf('{')) : notPassed;
    const hasVerified = notVerified !== 'chapter.notVerified';
    const hasPassed = notPassedPrefix !== '' && notPassed !== 'chapter.notPassed';
    return {
      // The not-verified and not-passed lines under the chapter's title are quiet notes; the same words after the first h2 stay a paragraph.
      p: ({ node, children, ...props }) => {
        const hast = node as HastNode | undefined;
        const text = hast === undefined ? '' : textOf(hast);
        const line = hast?.position?.start.line ?? Number.POSITIVE_INFINITY;
        const kind = line >= firstH2 ? null
          : hasVerified && text === notVerified ? 'not-verified'
            : hasPassed && text.startsWith(notPassedPrefix) ? 'not-passed' : null;
        if (kind === null) return <p {...props}>{children as ReactNode}</p>;
        return <p className="chapter-note" data-part={kind} {...props}><span className="chapter-note-icon"><InfoIcon /></span><span>{children as ReactNode}</span></p>;
      },
      table: ({ node: _node, ...props }) => <div className="table-scroll"><table {...props} /></div>,
      // The policy allows no image load (img-src data:), so an image is shown as its alt text: nothing is blank and nothing is requested.
      img: ({ node: _node, alt }) => <span className="img-alt">[{alt ?? ''}]</span>,
      a: ({ node: _node, href, children, ...props }) => {
        const external = typeof href === 'string' && /^https?:/i.test(href);
        return <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...props}>{children as ReactNode}</a>;
      },
      // Only inline code reaches here: a fenced block is drawn by `pre`, which reads its text from the tree.
      code: ({ node: _node, className, children, ...props }) => {
        const text = typeof children === 'string' ? children : '';
        const cited = className === undefined ? parseCitation(text) : null;
        return cited === null ? <code className={className} {...props}>{children}</code> : <Citation file={cited.file} start={cited.start} end={cited.end} />;
      },
      pre: ({ node, children: _children, ...props }) => {
        const code = codeOf(node as HastNode | undefined);
        const language = (code?.properties?.className ?? []).find((name) => name.startsWith('language-'));
        const text = code === undefined ? '' : textOf(code).replace(/\n$/, '');
        if (language === 'language-mermaid') {
          const line = (node as HastNode).position?.start.line ?? -1;
          const index = fences.indexOf(line);
          return <Diagram id={`xv-diagram-${idPrefix}-${index === -1 ? `line-${line}` : index}`} source={text} />;
        }
        return <pre {...props}><code className={language}>{text}</code></pre>;
      },
    };
  }, [source, idPrefix, notVerified, notPassed]);

  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>{source}</ReactMarkdown>
    </div>
  );
}
