import { useChapterTexts, useCoverage } from '../lib/chunks';
import type { Detail } from '../lib/chunks';
import { useView } from '../lib/links';
import type { ChapterData, PageData, ViewTexts } from '../lib/types';
import { ChunkNotice } from './ChunkNotice';
import { Markdown } from './Markdown';
import { NotFound } from './NotFound';

/** One page of Markdown: its text in the reader's view, once the part that holds it is loaded. */
function TextPage({ detail, view: name, id }: { detail: Detail<ViewTexts>; view: string; id: string }) {
  const view = useView();
  if (detail.status !== 'ready') return <article className="page" data-view={name} data-chapter={id}><ChunkNotice state={detail} /></article>;
  const text = detail.value[view];
  if (text === undefined) return <NotFound />;
  return <article className="page" data-view={name} data-chapter={id}><Markdown source={text} idPrefix={id} /></article>;
}

/** A chapter written as Markdown. The chapter's own level-1 heading is the heading of the page. */
export function ChapterPage({ chapter }: { chapter: ChapterData }) {
  return <TextPage detail={useChapterTexts(chapter)} view="chapter" id={chapter.id} />;
}

/** The coverage section, written by the script as Markdown. */
export function CoveragePage({ data }: { data: PageData }) {
  return <TextPage detail={useCoverage(data.coverage)} view="coverage" id="coverage" />;
}
