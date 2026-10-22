// localStorage that cannot throw. A page opened from disk, a private window or
// blocked site data can make any access to `localStorage` throw; the dashboard
// then behaves as if it had no storage (openspec: changes/viewer-explorer,
// design D2).

/** The stored text, or null when there is none or storage is unavailable. */
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Store `value`; a storage that is unavailable or full is ignored. */
export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // no storage
  }
}
