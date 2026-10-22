import type { ComponentProps } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * A report's Markdown (openspec: changes/viewer-app, design D6): GFM, with no
 * rehype-raw, so HTML in a report is text and nothing is parsed or run. A link
 * is a link only when it points at a route of this page (`#/...`); any other is
 * its text followed by the address as plain text, so the page never navigates
 * away. Images stay text too.
 */
export const REPORT_COMPONENTS: Components = {
  a({ href, children }: ComponentProps<'a'>) {
    if (typeof href === 'string' && href.startsWith('#/')) return <a href={href}>{children}</a>;
    return (
      <>
        {children}
        {typeof href === 'string' && href !== '' ? ` (${href})` : null}
      </>
    );
  },
  img({ alt, src }: ComponentProps<'img'>) {
    return <>{`![${alt ?? ''}](${typeof src === 'string' ? src : ''})`}</>;
  },
  table({ children }: ComponentProps<'table'>) {
    return (
      <div className="mb-3 max-w-full overflow-auto">
        <table>{children}</table>
      </div>
    );
  },
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="xv-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={REPORT_COMPONENTS} urlTransform={(url) => url}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
