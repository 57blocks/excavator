/**
 * Strings without the project's path. The model writes the text of a handbook
 * and sometimes quotes the project's absolute path; a page holds no local
 * path, so every string of the page data has each known root replaced by the
 * project's directory name.
 */

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `value` with every string (keys stay as they are) having each of `roots`
 * replaced by `name`. A root is replaced only where it is a whole path: not as
 * the end of a longer path, nor as the start of a longer name (`/work/shop-two`,
 * `/work/shop.bak`). The longest root goes first, duplicates and trailing
 * slashes do not matter, and `/` or an empty root is not a root. Order and
 * everything that is not a string are kept.
 */
export function withoutRootPaths(value, roots, name) {
  const wanted = [...new Set(roots.map((root) => root.replace(/\/+$/, '')).filter((root) => root !== ''))].sort((a, b) => b.length - a.length);
  if (wanted.length === 0) return value;
  const pattern = new RegExp(`(?<![\\w.-])(?:${wanted.map(escapeRegExp).join('|')})(?![\\w-]|\\.\\w)`, 'g');
  const walk = (item) => {
    if (typeof item === 'string') return item.replace(pattern, () => name);
    if (Array.isArray(item)) return item.map(walk);
    if (item !== null && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child)]));
    return item;
  };
  return walk(value);
}
