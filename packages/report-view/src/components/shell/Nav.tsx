import { buildHash } from '../../lib/route';
import { StatusDot } from '../ui/Badge';

export interface NavItem {
  id: string;
  label: string;
  status: string;
}

/** The left navigation: one link per page, with the state of what it shows. */
export function Nav({ items, current }: { items: readonly NavItem[]; current: string }) {
  return (
    <nav aria-label="Pages" className="flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-line-2 bg-paper-2 px-3 py-4 max-sm:w-auto max-sm:flex-row max-sm:overflow-x-auto max-sm:border-b max-sm:border-r-0 max-sm:py-2">
      {items.map((item) => (
        <a
          key={item.id}
          href={buildHash(item.id)}
          data-xv-nav={item.id}
          aria-current={item.id === current ? 'page' : undefined}
          className={`flex items-center gap-2.5 whitespace-nowrap rounded-control px-3 py-2 text-ink-soft transition-colors duration-200 ease-site hover:bg-surface hover:no-underline aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-accent`}
        >
          <StatusDot status={item.status} />
          <span>{item.label}</span>
        </a>
      ))}
    </nav>
  );
}
