/** A row of buttons of which one is on: the views of a page. Each carries `data-xv-view`. */
export function Segmented<T extends string>({ label, values, labels, value, onChange }: {
  label: string;
  values: readonly T[];
  labels: Readonly<Record<T, string>>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border border-line-2 bg-surface p-0.5">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          data-xv-view={v}
          aria-pressed={v === value}
          onClick={() => v !== value && onChange(v)}
          className={`cursor-pointer rounded-full border-0 px-3.5 py-1 text-[13px] transition-colors duration-200 ease-site ${v === value ? 'bg-accent text-white' : 'bg-transparent text-ink-soft hover:text-accent'}`}
        >
          {labels[v]}
        </button>
      ))}
    </div>
  );
}
