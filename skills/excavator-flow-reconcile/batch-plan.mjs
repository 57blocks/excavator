import { posix } from 'node:path';

export const MAX_BATCH_FILES = 128;

export function planBatches(files) {
  const batches = [];
  function split(directory, paths) {
    const children = new Map();
    const direct = [];
    const depth = directory === '.' ? 0 : directory.split('/').length;
    for (const path of paths) {
      const segments = path.split('/');
      if (segments.length === depth + 1) {
        direct.push(path);
      } else {
        const child = posix.join(directory, segments[depth]);
        if (!children.has(child)) children.set(child, []);
        children.get(child).push(path);
      }
    }
    if (directory !== '.' && paths.length <= MAX_BATCH_FILES) {
      batches.push({ module: directory, files: paths });
      return;
    }
    for (let index = 0; index < direct.length; index += MAX_BATCH_FILES) {
      batches.push({ module: directory, files: direct.slice(index, index + MAX_BATCH_FILES) });
    }
    // Keep sibling directories together when they fit, without mixing module roots.
    let group = [];
    function flush() {
      if (group.length) batches.push({ module: directory, files: group });
      group = [];
    }
    for (const [child, paths] of children) {
      if (directory === '.' || paths.length > MAX_BATCH_FILES) {
        flush();
        split(child, paths);
      } else {
        if (group.length + paths.length > MAX_BATCH_FILES) flush();
        group.push(...paths);
      }
    }
    flush();
  }
  split('.', [...files].sort());
  return batches.map((batch, index) => ({ ...batch, id: String(index + 1) }));
}
