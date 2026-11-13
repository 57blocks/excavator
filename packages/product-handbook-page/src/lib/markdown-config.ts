import type { Options as MarkdownOptions } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { remarkFeatureLinks } from './remark-feature-links';
import type { FeatureLinkOptions } from './remark-feature-links';

/**
 * The plugins of every Markdown text on the page: GitHub tables, task lists and strikethrough. There is no rehype
 * plugin: raw HTML in a chapter is not rendered (react-markdown shows it as text), so a chapter cannot add an element.
 */
export const remarkPlugins: NonNullable<MarkdownOptions['remarkPlugins']> = [remarkGfm];

/** The plugins with the feature links: the page's chapter titles and addresses, and the chapter the text belongs to (not linked from itself). */
export function pluginsWithFeatureLinks(options: FeatureLinkOptions): typeof remarkPlugins {
  return [remarkGfm, [remarkFeatureLinks, options]];
}
