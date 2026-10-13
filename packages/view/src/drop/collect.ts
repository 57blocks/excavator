// Turn what the user dropped or picked into `{ path, file }` pairs (task
// 9.2). A picked directory (`<input webkitdirectory>`) gives each File a
// `webkitRelativePath`; a dropped directory is walked through the entries
// API (`webkitGetAsEntry`). Nothing is read here and nothing leaves the
// browser: the files are handed to the data Worker as they are.
import type { DroppedFile } from '../decode/protocol';

/** Files from a `webkitdirectory` input. */
export function pickedFiles(list: FileList | null): DroppedFile[] {
  return Array.from(list ?? [], (file) => ({ path: file.webkitRelativePath || file.name, file }));
}

async function walk(entry: FileSystemEntry, out: DroppedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ path: entry.fullPath.replace(/^\/+/, ''), file });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns a batch at a time; an empty batch ends the listing.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    for (const child of batch) await walk(child, out);
  }
}

/** Files from a drop: whole directories when the browser exposes entries, else the plain file list. */
export async function droppedFiles(transfer: DataTransfer): Promise<DroppedFile[]> {
  const entries = Array.from(transfer.items ?? [])
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (entries.length === 0) return Array.from(transfer.files, (file) => ({ path: file.name, file }));
  const out: DroppedFile[] = [];
  for (const entry of entries) await walk(entry, out);
  return out;
}
