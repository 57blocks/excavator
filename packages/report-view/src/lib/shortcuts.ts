/** The keyboard shortcuts the viewer has, as the `?` dialog lists them (openspec: changes/viewer-app, spec "Shortcuts and history"). */
export interface Shortcut {
  keys: string;
  description: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: '/', description: 'Focus the search box' },
  { keys: '?', description: 'Show this list' },
  { keys: 'Esc', description: 'Close, from the inside out: a dialog or menu, the code drawer, the focus view, the highlighted path, the selection, then one level of the graph' },
  { keys: 'Enter', description: 'Open the highlighted search result' },
  { keys: 'Up / Down', description: 'Move through the search results' },
];

/** True when the key press comes from a field the user is typing in. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!element || typeof element.tagName !== 'string') return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable === true;
}
