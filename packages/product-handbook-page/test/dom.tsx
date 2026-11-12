// DOM helpers for the interaction tests (a test file that uses them runs in happy-dom):
// mount a page into the document, drive a Radix select with the keyboard only, read what it shows.
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Radix reads a few browser APIs the test DOM lacks; stubs keep it running, they decide nothing.
const proto = globalThis.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.scrollIntoView ??= () => undefined;
proto.hasPointerCapture ??= () => false;
proto.releasePointerCapture ??= () => undefined;
proto.setPointerCapture ??= () => undefined;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const mounted: { root: Root; host: HTMLElement }[] = [];

/** Render `element` into a fresh host in the document. */
export function mount(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(element));
  mounted.push({ root, host });
  return host;
}

/** Unmount everything mounted and clear what Radix left in the body. */
export function cleanup(): void {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
}

/** Let the timers of the primitive run (it moves the focus in a zero-delay timer after a key). */
export const settle = (): Promise<void> => act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 20)); });

/** Press `key` on `element` the way a keyboard does: keydown, then keyup, then let the focus move settle. */
export async function press(element: Element, key: string): Promise<void> {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Press `key` on whatever has the focus. */
export const pressActive = (key: string): Promise<void> => press((document.activeElement ?? document.body) as Element, key);

/** The select (combobox) whose visible label is `label`. */
export function selectByLabel(host: HTMLElement, label: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>('[role="combobox"]')).find((box) => {
    const id = box.getAttribute('aria-labelledby');
    return id !== null && (document.getElementById(id)?.textContent ?? '') === label;
  });
  if (found === undefined) throw new Error(`no select labelled ${label}`);
  return found;
}

/** Open a select with the keyboard (focus, then Enter). */
export async function openWithKeyboard(box: HTMLElement): Promise<void> {
  act(() => box.focus());
  await press(box, 'Enter');
}

/** The options of the open list, in order, as their texts. */
export const optionTexts = (): string[] => Array.from(document.querySelectorAll('[role="option"]')).map((option) => option.textContent ?? '');

/** Move the highlight `steps` times (down when positive, up when negative) and confirm with Enter. */
export async function moveAndConfirm(steps: number): Promise<void> {
  for (let step = 0; step < Math.abs(steps); step += 1) await pressActive(steps > 0 ? 'ArrowDown' : 'ArrowUp');
  await pressActive('Enter');
}

/** Choose the option with this text: open the select with the keyboard, move down to it, confirm. */
export async function choose(host: HTMLElement, label: string, option: string): Promise<void> {
  await openWithKeyboard(selectByLabel(host, label));
  const at = optionTexts().indexOf(option);
  if (at < 0) throw new Error(`no option ${option} in ${label}`);
  const selected = Array.from(document.querySelectorAll('[role="option"]')).findIndex((one) => one.getAttribute('aria-selected') === 'true');
  await moveAndConfirm(at - Math.max(selected, 0));
}

/** The status line of the page (the "showing n of m" text). */
export const status = (host: HTMLElement): string => host.querySelector('[role="status"]')?.textContent ?? '';

/** Type `text` into a controlled input the way React sees it: set the value through the native setter, then fire an input event. */
export function typeInto(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
