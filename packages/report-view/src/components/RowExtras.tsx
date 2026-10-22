import { codeHash, rangeText } from '../lib/code';
import type { LocateTarget } from '../lib/locate';
import type { OverlayName } from '../lib/overlay-names';
import { SourcePreview } from './SourcePreview';
import { LocateButton } from './ui/LocateButton';
import { RowSection } from './ui/RowPanel';

/** The two moves of a row panel: "Locate in graph" and "Open code" (the Code page at the row's lines). */
export function RowActions({ target, overlay, path, range }: { target: LocateTarget; overlay: OverlayName | null; path: string | null; range?: unknown }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <LocateButton target={target} overlay={overlay} />
      {path === null ? null : (
        <a href={codeHash(path, range)} data-xv-open-code={path} className="whitespace-nowrap rounded-control border border-line-2 bg-surface px-2 py-px text-xs text-ink hover:border-accent hover:text-accent hover:no-underline">
          Open code
        </a>
      )}
    </div>
  );
}

/** The source of the row's file in the panel, its line range marked; a row without a file says so. */
export function RowSource({ path, range }: { path: string | null; range?: unknown }) {
  return (
    <RowSection title="Source">
      {path === null ? (
        <p className="text-muted">The row names no file.</p>
      ) : (
        <div data-xv-preview={path} className="xv-preview overflow-hidden rounded-control border border-line">
          <SourcePreview path={path} lines={rangeText(range)} />
        </div>
      )}
    </RowSection>
  );
}
