import { useChapterTexts, useCoverage } from '../lib/chunks';
import type { Detail } from '../lib/chunks';
import { isFeatureId } from '../lib/groups';
import { splitHead } from '../lib/head-split';
import { useView } from '../lib/links';
import { useModel } from '../lib/model';
import { mentioning } from '../lib/handovers';
import { useText } from '../lib/text';
import type { ChapterData, PageData, ViewTexts } from '../lib/types';
import { ChunkNotice } from './ChunkNotice';
import { HandoverStrip } from './HandoverStrip';
import { FeaturePage } from './FeaturePage';
import { Markdown } from './Markdown';
import { NotFound } from './NotFound';

/** One page of Markdown: its text in the reader's view, once the part that holds it is loaded. */
function TextPage({ detail, view: name, id, strip = false }: { detail: Detail<ViewTexts>; view: string; id: string; strip?: boolean }) {
  const view = useView();
  const t = useText();
  const model = useModel();
  if (detail.status !== 'ready') return <article className="page" data-view={name} data-chapter={id}><ChunkNotice state={detail} /></article>;
  const text = detail.value[view];
  if (text === undefined) return <NotFound />;
  if (strip && isFeatureId(id)) return <FeaturePage id={id} view={name} text={text} />;
  if (!strip || !model.map || mentioning(model.handovers, id).length === 0) return <article className="page" data-view={name} data-chapter={id}><Markdown source={text} idPrefix={id} chapter={id} /></article>;
  // The strip goes after the head (the level-1 heading and its notices); the two blocks of Markdown keep every diagram and heading where it was.
  const { head, rest } = splitHead(text, [t('chapter.notVerified'), t('chapter.notPassed', { count: '{count}' }).split('{')[0]]);
  return (
    <article className="page" data-view={name} data-chapter={id}>
      {head !== '' && <Markdown source={head} idPrefix={id} chapter={id} />}
      <HandoverStrip chapter={id} />
      {rest.trim() !== '' && <Markdown source={rest} idPrefix={id} chapter={id} />}
    </article>
  );
}

/** A chapter written as Markdown. The chapter's own level-1 heading is the heading of the page. */
export function ChapterPage({ chapter }: { chapter: ChapterData }) {
  return <TextPage detail={useChapterTexts(chapter)} view="chapter" id={chapter.id} strip />;
}

/** The coverage section, written by the script as Markdown. */
export function CoveragePage({ data }: { data: PageData }) {
  return <TextPage detail={useCoverage(data.coverage)} view="coverage" id="coverage" />;
}
