import type { Options as MarkdownOptions } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * The plugins of every Markdown text on the page: GitHub tables, task lists and strikethrough. There is no rehype
 * plugin: raw HTML in a chapter is not rendered (react-markdown shows it as text), so a chapter cannot add an element.
 */
export const remarkPlugins: NonNullable<MarkdownOptions['remarkPlugins']> = [remarkGfm];
