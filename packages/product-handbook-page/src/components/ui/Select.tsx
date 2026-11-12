import * as RadixSelect from '@radix-ui/react-select';
import { useId } from 'react';

export interface SelectOption {
  /** Never empty: the primitive reserves the empty string for "no value". */
  value: string;
  label: string;
}

const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6" /></svg>
);

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" /></svg>
);

/**
 * A labelled select on the Radix primitive: the trigger and the list are styled
 * here (index.css), the keyboard behaviour (open with Enter, Space or the arrows,
 * move, type to jump, confirm, Escape) and the screen-reader roles come from
 * the primitive. The label sits above the control; the trigger is named by it.
 */
export function SelectField({ label, value, onValueChange, options, name }: { label: string; value: string; onValueChange: (value: string) => void; options: SelectOption[]; name: string }) {
  const labelId = useId();
  const current = options.find((option) => option.value === value);
  return (
    <div className="filter-field" data-part="filter-field" data-filter={name}>
      <span className="field-label" id={labelId}>{label}</span>
      <RadixSelect.Root value={value} onValueChange={onValueChange}>
        <RadixSelect.Trigger className="field-control select-trigger" aria-labelledby={labelId}>
          <RadixSelect.Value className="select-value">{current?.label}</RadixSelect.Value>
          <RadixSelect.Icon className="select-icon"><Chevron /></RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content className="select-content" position="popper" sideOffset={4} collisionPadding={8}>
            <RadixSelect.Viewport className="select-viewport">
              {options.map((option) => (
                <RadixSelect.Item className="select-item" value={option.value} key={option.value}>
                  <RadixSelect.ItemIndicator className="select-item-indicator"><Check /></RadixSelect.ItemIndicator>
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}
