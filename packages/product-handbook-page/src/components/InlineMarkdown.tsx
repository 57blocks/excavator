import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';

import { remarkPlugins } from '../lib/markdown-config';

const components: Components = {
  p: ({ children }) => <>{children}</>,
  a: ({ node: _node, href, children }) => <a href={href} target={/^https?:/i.test(href ?? '') ? '_blank' : undefined} rel="noopener noreferrer">{children}</a>,
};

/** One line of Markdown as inline content: emphasis, code and links, with the paragraph's own element removed. */
export function InlineMarkdown({ source }: { source: string }) {
  return <ReactMarkdown remarkPlugins={remarkPlugins} components={components} allowedElements={['p', 'em', 'strong', 'code', 'a', 'del']} unwrapDisallowed>{source}</ReactMarkdown>;
}

/** The text of a short Markdown string without its marks (code ticks, emphasis, link targets), for places that take plain text. */
export function plainText(source: string): string {
  return source
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
