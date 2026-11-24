import type { ReactNode } from "react";

/** A button that looks like a link. */
export function LinkButton({ onClick, title, children }: { onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className="cursor-pointer border-0 bg-transparent p-0 text-left text-accent transition-colors hover:text-accent-bright hover:underline">
      {children}
    </button>
  );
}
