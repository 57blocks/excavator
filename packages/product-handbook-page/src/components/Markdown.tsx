import { useMemo } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';

import { remarkPlugins } from '../lib/markdown-config';
import { Citation, parseCitation } from './Citation';
import { Diagram } from './Diagram';

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
  const components = useMemo<Components>(() => {
    const fences = mermaidFenceLines(source);
    return {
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
  }, [source, idPrefix]);

  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>{source}</ReactMarkdown>
    </div>
  );
}
