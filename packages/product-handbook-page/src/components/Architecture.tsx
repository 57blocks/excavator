import { jumpToHeading } from '../lib/heading-jump';
import { useLinks } from '../lib/links';
import { useText } from '../lib/text';
import type { SearchItem } from '../lib/types';
import { Markdown } from './Markdown';

/** The level-2 sections of the system chapter, from the search index: the title and the number the heading has among the chapter's `h2` and `h3`. */
export function systemSections(items: SearchItem[]): { title: string; index: number }[] {
  return items.flatMap((item) => (item.kind === 'heading' && item.chapter === 'system' && item.level === 2 && item.heading !== null ? [{ title: item.title, index: item.heading }] : []));
}

/**
 * The system architecture on the technical home page: the system chapter's section with its first diagram at the full width of
 * the page, then one line with a link to each level-2 section of the system chapter, which opens the chapter at that heading.
 */
export function Architecture({ source, sections }: { source: string; sections: { title: string; index: number }[] }) {
  const t = useText();
  const nav = useLinks();
  return (
    <section aria-labelledby="h-architecture" className="sec arch" data-part="architecture">
      <h2 id="h-architecture">{t('page.home.architecture')}</h2>
      <Markdown source={source} idPrefix="home-architecture" />
      {sections.length > 0 && (
        <p className="arch-more">
          <span>{t('page.home.architectureMore')}</span>
          {sections.map((section) => (
            <a
              key={section.index}
              href={nav.chapter('system')}
              data-heading={section.index}
              onClick={(event) => {
                event.preventDefault();
                window.location.hash = nav.chapter('system');
                jumpToHeading('system', section.index);
              }}
            >{section.title}</a>
          ))}
        </p>
      )}
    </section>
  );
}
