// The page decodes with the same codec the bake script encodes with: one
// implementation (skills/excavator-view/bundle-codec.mjs), imported by
// relative path and bundled by Vite into both the page and its decode Worker.
import { decodePayload } from './decode/client';
import { toViewData, type ViewData } from './data';

export const DATA_ELEMENT_ID = 'excavator-view-data';

/** The embedded payload text; empty for an unbaked template. */
export function readEmbeddedPayload(): string {
  return document.getElementById(DATA_ELEMENT_ID)?.textContent ?? '';
}

/** Decode the embedded payload; `null` when the placeholder is empty (an unbaked template). */
export async function readEmbeddedBundle(): Promise<ViewData | null> {
  const payload = readEmbeddedPayload();
  if (payload.trim() === '') return null;
  const { segments, mode } = await decodePayload(payload);
  return toViewData(segments, mode);
}
