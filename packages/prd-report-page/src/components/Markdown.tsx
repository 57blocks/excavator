import { useMemo } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';

import { rehypePlugins, remarkPlugins } from '../lib/markdown-config';
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

function mermaidSource(node: HastNode | undefined): string | null {
  const code = node?.children?.find((child) => child.type === 'element' && child.tagName === 'code');
  if (!code || !(code.properties?.className ?? []).includes('language-mermaid')) return null;
  return textOf(code).replace(/\n$/, '');
}

/**
 * Markdown as the page shows it: GFM, raw HTML parsed then sanitized (design
 * D4), tables in a horizontal scroller, mermaid blocks as diagrams whose ids
 * come from `idPrefix` (the feature id) and the block's index.
 */
export function Markdown({ source, idPrefix }: { source: string; idPrefix: string }) {
  const components = useMemo<Components>(() => {
    const fences = mermaidFenceLines(source);
    return {
      table: ({ node: _node, ...props }) => <div className="table-scroll"><table {...props} /></div>,
      // The policy allows no image load (img-src data:), so an image is shown as its alt text: nothing is blank and nothing is requested.
      img: ({ node: _node, alt }) => <span className="img-alt">[image{alt ? `: ${alt}` : ''}]</span>,
      a: ({ node: _node, href, children, ...props }) => {
        const external = typeof href === 'string' && /^https?:/i.test(href);
        return <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...props}>{children as ReactNode}</a>;
      },
      pre: ({ node, children, ...props }) => {
        const diagram = mermaidSource(node as HastNode | undefined);
        if (diagram === null) return <pre {...props}>{children}</pre>;
        const line = (node as HastNode).position?.start.line ?? -1;
        const index = fences.indexOf(line);
        return <Diagram id={`xv-diagram-${idPrefix}-${index === -1 ? `line-${line}` : index}`} source={diagram} />;
      },
    };
  }, [source, idPrefix]);

  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>{source}</ReactMarkdown>
    </div>
  );
}
