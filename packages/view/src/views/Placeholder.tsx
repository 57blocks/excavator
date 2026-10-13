import { SECTIONS, type SectionId } from '../routes';

const PLANNED: Partial<Record<SectionId, string>> = {
  semantics: 'Summaries, architecture layers and domain flows, each with its freshness.',
};

export function Placeholder({ section }: { section: SectionId }) {
  const label = SECTIONS.find((s) => s.id === section)?.label ?? section;
  return (
    <div className="content" data-section={section} data-placeholder="true">
      <section className="card placeholder">
        <h2>{label}</h2>
        <p>Available in a later slice.</p>
        {PLANNED[section] && <p className="muted">{PLANNED[section]}</p>}
      </section>
    </div>
  );
}
