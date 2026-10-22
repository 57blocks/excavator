import type { NodeSummaryView } from '../lib/node-summary';
import { Badge, type BadgeTone } from './ui/Badge';
import { Pills } from './ui/Controls';

const VERDICT_TONE: Record<string, BadgeTone> = { verified: 'success', unverified: 'warning', contradicted: 'danger', unchecked: 'neutral' };

/** A node's summary with its verdict; a contradicted or missing summary shows its sentence instead of text. */
export function NodeSummary({ view, showTags = true }: { view: NodeSummaryView; showTags?: boolean }) {
  return (
    <div data-xv-summary={view.verdict} className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge tone={VERDICT_TONE[view.verdict] ?? 'neutral'}>{view.verdictLabel}</Badge>
      </div>
      {view.text !== null ? <p className="[overflow-wrap:anywhere]">{view.text}</p> : <p className="text-muted">{view.notice}</p>}
      {showTags && view.tags.length > 0 ? <Pills values={view.tags} /> : null}
    </div>
  );
}
