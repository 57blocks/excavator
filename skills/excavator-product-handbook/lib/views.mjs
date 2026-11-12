/**
 * `--views` (openspec change handbook-entities-and-views, design D1): which
 * views of the handbook assemble, page and reply write about. It decides only
 * what is written, never which phases run, and is not recorded in state.json:
 * a run resumed with other views is only assembled again.
 */

export const VIEWS = Object.freeze(['product', 'technical']);
export const DEFAULT_VIEWS = Object.freeze(['product']);

/**
 * `{ ok: true, views }` with the views in the fixed order (product first),
 * or `{ ok: false, lines }` naming the value that is not a view and the
 * allowed ones. `text` undefined is the default.
 */
export function parseViews(text) {
  if (text === undefined) return { ok: true, views: [...DEFAULT_VIEWS] };
  const parts = String(text).split(',').map((part) => part.trim());
  const bad = parts.filter((part) => !VIEWS.includes(part));
  if (bad.length > 0) {
    return {
      ok: false,
      lines: [
        `--views: ${bad.map((part) => JSON.stringify(part)).join(', ')} is not a view`,
        `--views takes ${VIEWS.join(', ')} or both, separated by a comma (default ${DEFAULT_VIEWS.join(', ')})`,
      ],
    };
  }
  return { ok: true, views: VIEWS.filter((view) => parts.includes(view)) };
}
