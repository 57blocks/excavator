import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';

import { chainSteps } from '../lib/chain-steps';
import { useLinks } from '../lib/links';
import { pluginsWithFeatureLinks, pluginsWithItemLinks } from '../lib/markdown-config';
import { useModel } from '../lib/model';
import { DEFECT_CATEGORIES, categoryText } from '../lib/problems';
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

/** The button after the first titles on the problem row of a suggestion: "and {count} more", which shows the rest of the titles on the same row on a click. */
function MoreProblems({ count, children }: { count: number; children?: ReactNode }) {
  const t = useText();
  const [open, setOpen] = useState(false);
  if (open) return <>{children}</>;
  return <>{' '}<button type="button" className="remedy-more" data-part="remedy-more" aria-expanded="false" onClick={() => setOpen(true)}>{t('page.remedies.moreTitles', { count })}</button></>;
}

/** How one item of the remedies chapter is rendered alone: its source starts at line `lineOffset + 1` of the chapter, its id starts with `anchorPrefix`, and its problem lines are for `problemIds` (the rows its id groups name when not given). */
export interface RemedyItemOptions { lineOffset: number; anchorPrefix?: string; problemIds?: readonly string[] }

/** The code element of a `pre` node, with its language class, or undefined. */
function codeOf(node: HastNode | undefined): HastNode | undefined {
  return node?.children?.find((child) => child.type === 'element' && child.tagName === 'code');
}

/**
 * Markdown as the page shows it: GitHub tables in a horizontal scroller, mermaid blocks as diagrams (a source that
 * does not render stays visible with a note), and an inline code span that is a whole citation (`path:12` or
 * `path:12-20`) as a citation chip. Raw HTML is not rendered. `idPrefix` makes the ids of the diagrams unique. A feature written as `Title (F12)` links to its page, except `chapter`'s own; in the remedies chapter an item id in an id group links to its row or process and each item names its problems (remark-item-links.ts). `remedyItem` renders one item of that chapter alone, in plain text (no id group, problem lines without ids or links; see remark-item-links.ts).
 */
export function Markdown({ source, idPrefix, chapter, remedyItem }: { source: string; idPrefix: string; chapter?: string; remedyItem?: RemedyItemOptions }) {
  const t = useText();
  const nav = useLinks();
  const { titles, problems, processes } = useModel();
  // The improvement suggestions chapter links its item ids to their rows and processes and puts an anchor on each item.
  const plugins = useMemo(() => {
    const features = { titles, hrefOf: nav.chapter, own: chapter };
    if (chapter !== 'remedies' && remedyItem === undefined) return pluginsWithFeatureLinks(features);
    return pluginsWithItemLinks(features, {
      problems: new Set(problems.rows.map((row) => row.id)),
      processes: remedyItem === undefined ? new Set((processes?.items ?? []).map((item) => item.id)) : new Set<string>(),
      problemHref: (rowId) => nav.problems({ row: rowId }),
      processHref: nav.process,
      ...(remedyItem === undefined ? {} : {
        summaries: new Map(problems.rows.map((row) => [row.id, row.summary])),
        problemLabel: t('page.remedies.problem'),
        suggestionLabel: t('page.remedies.suggestion'),
        separator: t('page.remedies.problemSeparator'),
        plain: true, lineOffset: remedyItem.lineOffset, anchorPrefix: remedyItem.anchorPrefix, problemIds: remedyItem.problemIds,
      }),
    });
  }, [titles, nav, chapter, problems, processes, remedyItem?.lineOffset, remedyItem?.anchorPrefix, remedyItem?.problemIds?.join(','), t]);
  // The fixed notices of a chapter: the not-verified text, and the not-passed text up to its first placeholder.
  const verified = t('chapter.notVerified');
  const notPassed = t('chapter.notPassed', { count: '{count}' }).split('{')[0];
  const remedies = chapter === 'remedies' || remedyItem !== undefined;
  const components = useMemo<Components>(() => {
    const fences = mermaidFenceLines(source);
    return {
      // In the remedies chapter the bold word that starts a defect-fix item is the fixed category word; it is shown as its label.
      strong: ({ node: _node, children, ...props }) => {
        const word = typeof children === 'string' ? children : '';
        const labelled = remedies && DEFECT_CATEGORIES.includes(word);
        return <strong {...props}>{labelled ? categoryText(t, word) : children}</strong>;
      },
      'remedy-more': ({ node: _node, children, ...props }: { node?: unknown; children?: ReactNode; 'data-count'?: number | string }) => <MoreProblems count={Number(props['data-count'])}>{children}</MoreProblems>,
      p: ({ node, children, ...props }) => {
        const text = textOf(node as HastNode).trimStart();
        const note = verified !== '' && text.startsWith(verified) ? 'not-verified' : notPassed !== '' && text.startsWith(notPassed) ? 'not-passed' : null;
        return note === null ? <p {...props}>{children}</p> : <p className="note" data-note={note}><InfoIcon /><span>{children}</span></p>;
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
          const steps = chainSteps(text);
          if (steps !== null) return <ol className="steps">{steps.map((step, at) => <li key={at}>{step}</li>)}</ol>;
          const line = (node as HastNode).position?.start.line ?? -1;
          const index = fences.indexOf(line);
          return <Diagram id={`xv-diagram-${idPrefix}-${index === -1 ? `line-${line}` : index}`} source={text} />;
        }
        return <pre {...props}><code className={language}>{text}</code></pre>;
      },
    } as Components;
  }, [source, idPrefix, verified, notPassed, remedies, t]);

  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={plugins} components={components}>{source}</ReactMarkdown>
    </div>
  );
}
