/**
 * What the Learn mode's idle sidebar says about the tour product (openspec:
 * changes/viewer-learn, design D1 and D8) until the learn panel draws the tour
 * itself: not run with its command, unreadable with the packer's reason, a
 * different revision with both digests, or included with its steps' titles.
 * The state is the packer's; nothing here decides one. Pure functions.
 */

import type { ManifestProduct } from '../data/manifest';

export interface TourStep {
  order: number;
  title: string;
}

export type TourIdle =
  | { state: 'not-run'; command: string; file: string }
  | { state: 'unreadable'; reason: string }
  | { state: 'different-revision'; tourDigest: string | null; graphDigest: string | null; reason: string | null }
  | { state: 'included'; steps: number };

/** The tour's state, as the manifest entry has it. */
export function tourIdle(product: Pick<ManifestProduct, 'status' | 'reason' | 'command' | 'file' | 'counts' | 'factDigests'>): TourIdle {
  if (product.status === 'not-run') return { state: 'not-run', command: product.command, file: product.file };
  if (product.status === 'unreadable') return { state: 'unreadable', reason: product.reason || 'The file could not be read.' };
  if (product.status === 'different-revision') {
    return { state: 'different-revision', tourDigest: product.factDigests?.tour ?? null, graphDigest: product.factDigests?.graph ?? null, reason: product.reason };
  }
  return { state: 'included', steps: typeof product.counts?.steps === 'number' ? product.counts.steps : 0 };
}

/** The steps of the tour payload with their order and title, in the payload's order (the packer refuses a tour whose steps lack either). */
export function tourSteps(payload: unknown): TourStep[] {
  const steps = payload !== null && typeof payload === 'object' && Array.isArray((payload as { steps?: unknown }).steps) ? (payload as { steps: unknown[] }).steps : [];
  return steps.map((step, i) => {
    const record = step !== null && typeof step === 'object' ? (step as Record<string, unknown>) : {};
    return { order: typeof record.order === 'number' ? record.order : i + 1, title: typeof record.title === 'string' ? record.title : '' };
  });
}
