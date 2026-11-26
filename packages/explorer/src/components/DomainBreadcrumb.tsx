import { Fragment } from "react";
import BackButton from "./BackButton";
import GroupName from "./GroupName";

export interface Crumb {
  label: string;
  /** An untranslated suffix shown after the label in mono. */
  qualifier?: string | null;
  /** Absent on the last crumb: the current level. */
  onClick?: () => void;
}

/** The trail of the Domain view, "All domains / domain / group", with a Back button that goes up one level. */
export default function DomainBreadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <div className="absolute top-3 left-3 z-10 flex items-center gap-2" data-excavator-domain-breadcrumb data-excavator-bar>
      <BackButton />
      <nav className="flex items-center gap-1.5 text-xs bg-surface/90 border border-border-subtle rounded-lg px-3 py-1.5 max-w-[60vw] overflow-hidden">
        {crumbs.map((crumb, index) => (
          <Fragment key={index}>
            {index > 0 && <span className="text-text-muted">/</span>}
            {crumb.onClick ? (
              <button type="button" onClick={crumb.onClick} className="text-text-secondary hover:text-text-primary truncate">
                <GroupName label={crumb.label} qualifier={crumb.qualifier} />
              </button>
            ) : (
              <span className="text-text-primary font-semibold truncate">
                <GroupName label={crumb.label} qualifier={crumb.qualifier} />
              </span>
            )}
          </Fragment>
        ))}
      </nav>
    </div>
  );
}
