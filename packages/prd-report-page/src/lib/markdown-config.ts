import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Options as SanitizeSchema } from 'rehype-sanitize';
import type { Options as MarkdownOptions } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Plugins = NonNullable<MarkdownOptions['rehypePlugins']>;

/**
 * The sanitize schema of every Markdown text on the page (design D4):
 * rehype-sanitize's default (GitHub) schema plus the `open` attribute of
 * `details`. The default already keeps `details` and `summary`; `script`
 * (with its text), `iframe`, `style`, event attributes and `style`
 * attributes are not in it, so the raw HTML a chapter carries loses them.
 */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), 'details', 'summary'])],
  attributes: {
    ...defaultSchema.attributes,
    details: [...(defaultSchema.attributes?.details ?? []), 'open'],
  },
};

export const remarkPlugins: NonNullable<MarkdownOptions['remarkPlugins']> = [remarkGfm];
/** Raw HTML is parsed first, then sanitized: the order matters. */
export const rehypePlugins: Plugins = [rehypeRaw, [rehypeSanitize, sanitizeSchema]];
