import type { Manifest } from '../../data/manifest';

/** The top bar: the brand, the project and the source snapshot's revision. */
export function TopBar({ manifest }: { manifest: Manifest }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3.5 border-b border-line-2 bg-surface px-6 max-sm:px-4">
      <span className="font-bold tracking-tight text-ink">
        <span aria-hidden="true" className="mr-2 inline-block size-2.5 rounded-[3px] bg-accent" />
        Excavator
      </span>
      <span className="min-w-0 flex-1 truncate text-ink">{manifest.project.name}</span>
      <span title={manifest.snapshot.revision} className="max-w-[46%] shrink truncate rounded-full border border-line-2 px-2.5 py-[3px] font-mono text-xs text-muted">
        {manifest.snapshot.revision}
      </span>
    </header>
  );
}
