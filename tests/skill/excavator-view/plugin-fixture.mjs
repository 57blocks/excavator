/**
 * A stand-in for the view template packages/report-view builds, and a plugin
 * root laid out like the real one around it, so the packer tests run without a
 * build (one test of the real template lives in view-template.test.mjs).
 */

import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// A small template with the two markers the packer fills; the script holds replacement-pattern characters on purpose.
export const FIXTURE_TEMPLATE = [
  '<!doctype html>',
  '<html lang="en"><head>',
  '<meta charset="utf-8">',
  '<meta name="color-scheme" content="light">',
  '<!-- xv:csp -->',
  '<title>Fixture template</title>',
  '<script type="module">window.__fixture = "$& $1 $`";</script>',
  '<style>body { margin: 0; }</style>',
  '</head><body><div id="xv-app"></div>',
  '<!-- xv:data -->',
  '</body></html>',
  '',
].join('\n');

/** A directory holding view.html with the given text; returns its path. */
export function writeTemplate(text = FIXTURE_TEMPLATE) {
  const dir = mkdtempSync(join(tmpdir(), 'xv-template-'));
  const path = join(dir, 'view.html');
  writeFileSync(path, text);
  return { dir, path };
}

/**
 * A plugin root with the packer scripts and, when `template` is a string, a built view template under it and
 * an explorer template (the same text, which has the same two markers) next to the real built explorer validator; null leaves it unbuilt.
 */
export function makePluginRoot(template) {
  const root = mkdtempSync(join(tmpdir(), 'xv-plugin-'));
  cpSync(join(repoRoot, 'skills/excavator-view'), join(root, 'skills/excavator-view'), { recursive: true });
  symlinkSync(join(repoRoot, 'skills/excavator'), join(root, 'skills/excavator'));
  symlinkSync(join(repoRoot, 'skills/excavator-domain'), join(root, 'skills/excavator-domain'));
  if (template !== null) {
    mkdirSync(join(root, 'packages/report-view/dist'), { recursive: true });
    writeFileSync(join(root, 'packages/report-view/dist/view.html'), template);
    mkdirSync(join(root, 'packages/explorer/dist'), { recursive: true });
    writeFileSync(join(root, 'packages/explorer/dist/explorer.html'), template);
    symlinkSync(join(repoRoot, 'packages/explorer/dist-node'), join(root, 'packages/explorer/dist-node'));
  }
  return root;
}
