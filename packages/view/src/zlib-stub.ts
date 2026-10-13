// The shared bundle codec loads node:zlib only on its encode path, which the
// page never runs. Aliasing it here keeps Node built-ins out of the page.
export function gzipSync(): never {
  throw new Error('gzip encoding is not available in the view page');
}
