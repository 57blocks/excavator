import { linkFeatures } from '../lib/feature-links';
import { useLinks, useView } from '../lib/links';
import { useModel } from '../lib/model';
import type { HandoverData } from '../lib/types';

/** The words of a hand-over: its text with the features as links to their chapters, and in the technical view its citations as quiet monospace text. */
export function HandoverText({ handover }: { handover: HandoverData }) {
  const nav = useLinks();
  const view = useView();
  const { titles } = useModel();
  const segments = linkFeatures(handover.what, (id) => titles[id]);
  const cites = view === 'technical' ? handover.cites ?? [] : [];
  return (
    <>
      <span className="ho-text">
        {segments.map((segment, at) => (segment.kind === 'text' ? segment.text : <a key={at} href={nav.chapter(segment.id)} data-feature={segment.id}>{segment.text}</a>))}
      </span>
      {cites.length > 0 && <span className="ho-cites">{cites.map((cite) => <code key={cite}>{cite}</code>)}</span>}
    </>
  );
}
