import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';

import { useLinks } from '../lib/links';
import { pluginsWithFeatureLinks } from '../lib/markdown-config';
import { useModel } from '../lib/model';

const components: Components = {
  p: ({ children }) => <>{children}</>,
  a: ({ node: _node, href, children, ...props }) => <a href={href} data-feature={(props as { 'data-feature'?: string })['data-feature']} target={/^https?:/i.test(href ?? '') ? '_blank' : undefined} rel="noopener noreferrer">{children}</a>,
};

/** One line of Markdown as inline content: emphasis, code and links, with the paragraph's own element removed. */
export function InlineMarkdown({ source }: { source: string }) {
  const nav = useLinks();
  const { titles } = useModel();
  const plugins = useMemo(() => pluginsWithFeatureLinks({ titles, hrefOf: nav.chapter }), [titles, nav]);
  return <ReactMarkdown remarkPlugins={plugins} components={components} allowedElements={['p', 'em', 'strong', 'code', 'a', 'del']} unwrapDisallowed>{source}</ReactMarkdown>;
}

/** The text of a short Markdown string without its marks (code ticks, emphasis, link targets), for places that take plain text. */
export function plainText(source: string): string {
  return source
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
