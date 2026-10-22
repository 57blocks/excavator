import { MODE_LABELS, type Mode } from '../../lib/view-mode';
import type { GraphScene } from '../../state/graph-scene';
import { ProjectOverview } from './ProjectOverview';
import { TourState } from './TourState';

/** The title of the sidebar when nothing is selected, in `mode`. */
export const idleTitle = (mode: Mode) => (mode === 'learn' ? 'Tour' : 'Project overview');

/** What the sidebar shows with nothing selected (design D1): the tour in Learn, the project overview in Overview and Deep dive. */
export function IdleSidebar({ mode, scene, onSelectNode, onOpenLayer, onStartTour }: {
  mode: Mode;
  scene: GraphScene;
  onSelectNode: (nodeId: string) => void;
  onOpenLayer: (path: string) => void;
  onStartTour: () => void;
}) {
  return (
    <div data-xv-idle={mode}>
      {mode === 'learn' ? <TourState /> : <ProjectOverview scene={scene} onSelectNode={onSelectNode} onOpenLayer={onOpenLayer} onStartTour={onStartTour} />}
    </div>
  );
}

/** The line the sidebar carries when a search or a selection switched the mode to show the node. */
export function ModeSwitchNote({ from, to, type }: { from: Mode; to: Mode; type: string }) {
  return (
    <p data-xv-mode-switched={`${from}>${to}`} className="m-0 mb-4 rounded-control border-l-4 border-accent bg-highlight px-3 py-2 text-[13px] text-ink">
      {`Mode switched from ${MODE_LABELS[from]} to ${MODE_LABELS[to]}: ${MODE_LABELS[from]} does not draw ${type} nodes.`}
    </p>
  );
}
