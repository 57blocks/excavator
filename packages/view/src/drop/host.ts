// Who shows a dropped directory's data: the bootstrap (main.tsx) registers
// how to mount view data; the drop zone hands its result here, both on the
// unbaked template and from #/open on a baked page.
import type { ViewData } from '../data';

let mount: ((data: ViewData) => void) | null = null;

export function setDataMount(fn: (data: ViewData) => void): void {
  mount = fn;
}

export function showData(data: ViewData): void {
  if (!mount) throw new Error('the page has no data mount');
  mount(data);
}
