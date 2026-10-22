import type { Manifest } from '../../data/manifest';
import { shortRevision } from '../../lib/format';
import { useGraphUi } from '../../state/graph-ui';
import { useRoute } from '../../hooks/use-route';
import { useProduct } from '../../state/viewer';
import { FilterMenu } from './FilterMenu';
import { OverlayToggles } from './OverlayToggles';
import { SearchBox } from './SearchBox';

const BUTTON = 'flex h-9 shrink-0 cursor-pointer whitespace-nowrap items-center rounded-control border border-line-2 bg-surface px-3 text-ink hover:border-accent hover:text-accent';

/**
 * The top bar (design D8): the brand, the project, the search box, the filter
 * and path buttons, the overlay switches, the shortcut list and the source
 * snapshot's revision. The graph's controls are there when the page has a
 * knowledge graph to search; the overlay switches only on the graph page.
 */
export function TopBar({ manifest }: { manifest: Manifest }) {
  const ui = useGraphUi();
  const { route } = useRoute();
  const graph = useProduct('knowledge-graph');
  const hasGraph = graph.status === 'included' || graph.status === 'different-revision';
  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-3.5 border-b border-line-2 bg-surface px-6 max-xl:gap-2.5 max-sm:px-4">
      <span className="shrink-0 whitespace-nowrap font-bold tracking-tight text-ink">
        <span aria-hidden="true" className="mr-2 inline-block size-2.5 rounded-[3px] bg-accent" />
        Excavator
      </span>
      <span title={manifest.project.name} data-xv-project="" className="max-w-[24%] shrink-0 truncate whitespace-nowrap text-ink max-xl:max-w-[7.5rem] max-sm:min-w-0 max-sm:flex-1 max-sm:shrink">{manifest.project.name}</span>
      {hasGraph ? <SearchBox /> : <span className="flex-1" />}
      {hasGraph && route.page === 'graph' ? <OverlayToggles /> : null}
      {hasGraph ? <FilterMenu /> : null}
      {hasGraph && route.page === 'graph' ? <button type="button" data-xv-action="path-dialog" onClick={() => ui.setOverlay(ui.overlay === 'path' ? null : 'path')} className={BUTTON}>Path</button> : null}
      <button type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => ui.setOverlay(ui.overlay === 'shortcuts' ? null : 'shortcuts')} className={`${BUTTON} w-9 justify-center px-0 font-semibold`}>?</button>
      <span title={manifest.snapshot.revision} data-xv-revision="" className="shrink-0 whitespace-nowrap rounded-full border border-line-2 px-2.5 py-[3px] font-mono text-xs text-muted max-lg:hidden">
        {shortRevision(manifest.snapshot.revision)}
      </span>
    </header>
  );
}
